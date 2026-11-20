"""Train the masked-view board reader and export it for src/vision/viewCnn.ts.

    python -I ml/train_view.py 30 all      # reads ml/data/view-{train,val,real,realaug}.{x,y}, writes src/vision/viewCnn.weights.json

Input: the board as the camera sees it (perspective kept), turned so a8 -> h8 runs left to right, cropped to the board plus
padding with everything outside the outline blacked out, 160x160 greyscale (src/vision/boardView.ts). The training views come
from random camera positions all the way round the board, so the net learns what a full board looks like from any angle.
Output: for each of the 64 squares, 3 classes (empty, white piece, black piece).
Net: five 3x3 conv stages (four stride 2) down to a 10x10 map, a 1x1 squeeze, then two dense layers, because without
straightening the net has to decide for itself which part of the picture is which square. Batch norm is folded on export.
"""
import base64, copy, json, os, sys, time
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

SIDE = 160
EPOCHS = int(sys.argv[1]) if len(sys.argv) > 1 else 30
REAL = sys.argv[2] if len(sys.argv) > 2 else "none"
OUT = os.environ.get("OUT", "src/vision/viewCnn.weights.json")
CHECK = os.environ.get("CHECK", "src/vision/viewCnn.check.json")
DEV = torch.device("cuda" if torch.cuda.is_available() else "cpu")
torch.manual_seed(0)
np.random.seed(0)


def load(name):
    x = np.fromfile(f"ml/data/view-{name}.x", dtype=np.uint8).reshape(-1, 1, SIDE, SIDE)
    y = np.fromfile(f"ml/data/view-{name}.y", dtype=np.uint8).astype(np.int64).reshape(-1, 64)
    return torch.from_numpy(x).to(DEV), torch.from_numpy(y).to(DEV)


def f32(x):
    return x.float() / 127.5


class Net(nn.Module):
    SPEC = [(1, 16, 2), (16, 32, 2), (32, 64, 2), (64, 64, 2), (64, 64, 1)]
    SQUEEZE = 8
    HIDDEN = int(os.environ.get("HIDDEN", 512))

    def __init__(self):
        super().__init__()
        self.convs = nn.ModuleList([nn.Conv2d(i, o, 3, stride=s, padding=1) for i, o, s in self.SPEC])
        self.bns = nn.ModuleList([nn.BatchNorm2d(o) for _, o, _ in self.SPEC])
        self.squeeze = nn.Conv2d(64, self.SQUEEZE, 1)
        self.fc1 = nn.Linear(self.SQUEEZE * 10 * 10, self.HIDDEN)
        self.fc2 = nn.Linear(self.HIDDEN, 3 * 64)
        self.drop = nn.Dropout(0.25)

    def forward(self, x):
        for c, b in zip(self.convs, self.bns):
            x = F.relu(b(c(x)))
        x = F.relu(self.squeeze(x)).flatten(1)
        x = self.fc2(self.drop(F.relu(self.fc1(x))))
        return x.view(-1, 3, 64)             # class-major, like the other readers


def augment(x):
    n = x.shape[0]
    x = x * (0.85 + 0.3 * torch.rand(n, 1, 1, 1, device=x.device)) + 0.06 * torch.randn(n, 1, 1, 1, device=x.device)
    x = x + 0.03 * torch.randn_like(x)
    dx, dy = np.random.randint(-3, 4, 2)    # the outline is never placed exactly
    return torch.roll(x, shifts=(int(dy), int(dx)), dims=(2, 3))


def evaluate(net, x, y):
    net.eval()
    with torch.no_grad():
        pred = torch.cat([net(f32(x[i:i + 256])).argmax(1) for i in range(0, len(x), 256)])
    ok = pred == y
    occ = y > 0
    return {"square": ok.float().mean().item(), "colour": ok.float().mean().item(), "boards": ok.all(1).float().mean().item(),
            "piece": ok[occ].float().mean().item(), "empty": ok[~occ].float().mean().item()}


def line(st):
    return f"squares {st['square']:.4f} boards {st['boards']:.3f} pieces {st['piece']:.3f} empty {st['empty']:.3f}"


def fold(conv, bn):
    s = bn.weight / torch.sqrt(bn.running_var + bn.eps)
    return conv.weight * s.view(-1, 1, 1, 1), (conv.bias - bn.running_mean) * s + bn.bias


def pack(t):
    return base64.b64encode(t.detach().cpu().numpy().astype("<f4").tobytes()).decode()


xt, yt = load("train")
xv, yv = load("val")
xr, yr = load("real")
if REAL != "none":
    xa, ya = load("realaug")
    xt, yt = torch.cat([xt] + [xa] * 3), torch.cat([yt] + [ya] * 3)
print(f"train {len(xt)} val {len(xv)} real {len(xr)}")
net = Net().to(DEV)
print("device", DEV, "params", sum(p.numel() for p in net.parameters()), flush=True)
BATCH = 64
opt = torch.optim.AdamW(net.parameters(), 2e-3, weight_decay=1e-4)
sched = torch.optim.lr_scheduler.OneCycleLR(opt, float(os.environ.get("MAX_LR", "0.003")), total_steps=EPOCHS * (len(xt) // BATCH))
best = -1.0; best_state = None; best_epoch = 0
t0 = time.time()
for ep in range(EPOCHS):
    net.train()
    perm = torch.randperm(len(xt), device=DEV)
    for i in range(0, len(perm) - BATCH + 1, BATCH):
        idx = perm[i:i + BATCH]
        loss = F.cross_entropy(net(augment(f32(xt[idx]))), yt[idx], label_smoothing=0.05)
        opt.zero_grad(); loss.backward(); opt.step(); sched.step()
    vs = evaluate(net, xv, yv)
    rs = evaluate(net, xr, yr)
    if vs["square"] > best:
        best = vs["square"]; best_state = copy.deepcopy(net.state_dict()); best_epoch = ep + 1
    print(f"epoch {ep + 1:2d} loss {loss.item():.3f} val {line(vs)} | real {line(rs)} ({time.time() - t0:.0f}s)", flush=True)

net.load_state_dict(best_state)
print("Selected best validation epoch", best_epoch)
vs = evaluate(net, xv, yv); rs = evaluate(net, xr, yr)
print("val", line(vs)); print("real", line(rs))
net.eval()
layers = []
for c, b in zip(net.convs, net.bns):
    w, bias = fold(c, b)
    layers.append({"k": 3, "in": c.in_channels, "out": c.out_channels, "stride": c.stride[0], "relu": True, "w": pack(w), "b": pack(bias)})
layers.append({"k": 1, "in": net.squeeze.in_channels, "out": net.squeeze.out_channels, "stride": 1, "relu": True, "w": pack(net.squeeze.weight), "b": pack(net.squeeze.bias)})
layers.append({"k": 0, "in": net.fc1.in_features, "out": net.fc1.out_features, "stride": 1, "relu": True, "w": pack(net.fc1.weight), "b": pack(net.fc1.bias)})
layers.append({"k": 0, "in": net.fc2.in_features, "out": net.fc2.out_features, "stride": 1, "relu": False, "w": pack(net.fc2.weight), "b": pack(net.fc2.bias)})
sample = f32(xv[:2])
torch.backends.cudnn.allow_tf32 = False
with torch.no_grad():
    logits = net(sample)
json.dump({"side": SIDE, "classes": 3, "layers": layers, "val": vs["square"], "real": rs["square"]}, open(OUT, "w"))
json.dump({"x": sample.flatten().tolist(), "logits": logits.flatten().tolist()}, open(CHECK, "w"))
print("wrote", OUT)
