"""Train the whole-board reader and export it for src/vision/boardCnn.ts.

    python -I ml/train_board.py 30 all      # reads ml/data/board-{train,val,real,realaug}.{x,y}, writes src/vision/boardCnn.weights.json

Input: the whole board flattened to one 160x160 greyscale image with a square of margin all round (src/vision/boardImage.ts).
Output: an 8x8 grid of 13 classes per square: 0 empty, 1-6 white pawn/knight/bishop/rook/queen/king, 7-12 black ones.
It is fully convolutional: four stride-2 stages bring the image down to one cell per square (10x10 with the margin),
two more 3x3 layers let every cell look at its neighbours, then a 1x1 layer classifies. Batch norm is folded on export.
"""
import base64, json, os, sys, time
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

SIDE = 160
NC = 13
NAMES = ["empty"] + [c + t for c in "wb" for t in "PNBRQK"]
EPOCHS = int(sys.argv[1]) if len(sys.argv) > 1 else 30
REAL = sys.argv[2] if len(sys.argv) > 2 else "none"
OUT = "src/vision/boardCnn.weights.json"
DEV = torch.device("cuda" if torch.cuda.is_available() else "cpu")
torch.manual_seed(0)
np.random.seed(0)


def load(name):
    x = np.fromfile(f"ml/data/board-{name}.x", dtype=np.uint8).reshape(-1, 1, SIDE, SIDE)
    y = np.fromfile(f"ml/data/board-{name}.y", dtype=np.uint8).astype(np.int64).reshape(-1, 8, 8)
    return torch.from_numpy(x).to(DEV), torch.from_numpy(y).to(DEV)  # pixels stay uint8 on the GPU


def f32(x):
    return x.float() / 127.5


class Net(nn.Module):
    WIDTH = int(sys.argv[3]) if len(sys.argv) > 3 else 48   # channels of the last stages; 48 = about 8M multiply-adds, 64 = about 19M
    _w = WIDTH / 48
    _c = [1, round(8 * _w), round(16 * _w), round(32 * _w), WIDTH, WIDTH, WIDTH]
    SPEC = [(_c[0], _c[1], 2), (_c[1], _c[2], 2), (_c[2], _c[3], 2), (_c[3], _c[4], 2), (_c[4], _c[5], 1), (_c[5], _c[6], 1)]

    def __init__(self):
        super().__init__()
        self.convs = nn.ModuleList([nn.Conv2d(i, o, 3, stride=s, padding=1) for i, o, s in self.SPEC])
        self.bns = nn.ModuleList([nn.BatchNorm2d(o) for _, o, _ in self.SPEC])
        self.head = nn.Conv2d(self.SPEC[-1][1], NC, 1)
        self.drop = nn.Dropout2d(0.1)

    def forward(self, x):
        for c, b in zip(self.convs, self.bns):
            x = F.relu(b(c(x)))
        x = self.head(self.drop(x))          # B x NC x 10 x 10
        return x[:, :, 1:9, 1:9]             # drop the margin cells: B x NC x 8 x 8


def augment(x, y):
    n = x.shape[0]
    # board symmetries: a mirrored or flipped view is just another camera position
    if np.random.rand() < 0.5: x, y = x.flip(3), y.flip(2)
    if np.random.rand() < 0.5: x, y = x.flip(2), y.flip(1)
    x = x * (0.85 + 0.3 * torch.rand(n, 1, 1, 1, device=x.device)) + 0.06 * torch.randn(n, 1, 1, 1, device=x.device)
    x = x + 0.03 * torch.randn_like(x)
    # a few pixels of shift (the corners are never placed exactly), well under half a square
    dx, dy = np.random.randint(-3, 4, 2)
    return torch.roll(x, shifts=(int(dy), int(dx)), dims=(2, 3)), y


def evaluate(net, x, y):
    net.eval()
    with torch.no_grad():
        pred = torch.cat([net(f32(x[i:i + 256])).argmax(1) for i in range(0, len(x), 256)])
    ok = pred == y
    colour = lambda c: (c > 0).long() + (c > 6).long()   # 0 empty, 1 white, 2 black
    occ = y > 0
    stats = {
        "square": ok.float().mean().item(),
        "boards": ok.flatten(1).all(1).float().mean().item(),
        "colour": (colour(pred) == colour(y)).float().mean().item(),
        # of the squares that really hold a piece of the right colour, how often is the type right
        "type": (ok & occ)[occ & (colour(pred) == colour(y))].float().mean().item() if (occ & (colour(pred) == colour(y))).any() else 0.0,
    }
    conf13 = torch.bincount((y * NC + pred).flatten(), minlength=NC * NC).view(NC, NC).cpu()
    conf3 = torch.bincount((colour(y) * 3 + colour(pred)).flatten(), minlength=9).view(3, 3).cpu()
    return stats, conf3, conf13


def line(st):
    return f"squares {st['square']:.4f} colour {st['colour']:.4f} type {st['type']:.3f} boards {st['boards']:.3f}"


def fold(conv, bn):
    s = bn.weight / torch.sqrt(bn.running_var + bn.eps)
    return conv.weight * s.view(-1, 1, 1, 1), (conv.bias - bn.running_mean) * s + bn.bias


def pack(t):
    return base64.b64encode(t.detach().cpu().numpy().astype("<f4").tobytes()).decode()


_parts = [load(n) for n in os.environ.get("TRAIN", "train").split(",")]   # e.g. TRAIN=train,train2
xt, yt = torch.cat([p[0] for p in _parts]), torch.cat([p[1] for p in _parts])
del _parts
xv, yv = load("val")
xr, yr = load("real")
if REAL != "none":
    xa, ya = load("realaug")
    xt, yt = torch.cat([xt] + [xa] * 3), torch.cat([yt] + [ya] * 3)
print(f"train {len(xt)} val {len(xv)} real {len(xr)}; classes {torch.bincount(yt.flatten(), minlength=NC).tolist()}")
net = Net().to(DEV)
print("device", DEV, "params", sum(p.numel() for p in net.parameters()))
BATCH = 48
opt = torch.optim.AdamW(net.parameters(), 2e-3, weight_decay=1e-4)
sched = torch.optim.lr_scheduler.OneCycleLR(opt, 4e-3, total_steps=EPOCHS * (len(xt) // BATCH))
t0 = time.time()
for ep in range(EPOCHS):
    net.train()
    perm = torch.randperm(len(xt), device=DEV)
    for i in range(0, len(xt) - BATCH + 1, BATCH):
        idx = perm[i:i + BATCH]
        xb, yb = augment(f32(xt[idx]), yt[idx])
        loss = F.cross_entropy(net(xb), yb, label_smoothing=0.05)
        opt.zero_grad(); loss.backward(); opt.step(); sched.step()
    vs, _, _ = evaluate(net, xv, yv)
    rs, _, _ = evaluate(net, xr, yr)
    print(f"epoch {ep + 1:2d} loss {loss.item():.3f} val {line(vs)} | real {line(rs)} ({time.time() - t0:.0f}s)", flush=True)

vs, vconf3, vconf13 = evaluate(net, xv, yv)
rs, rconf3, _ = evaluate(net, xr, yr)
recall = [vconf13[i, i].item() / max(1, vconf13[i].sum().item()) for i in range(NC)]
print("val", line(vs))
print("confusion by colour (rows truth, cols pred: empty/white/black)", vconf3.tolist())
print("recall per class", {n: round(r, 3) for n, r in zip(NAMES, recall)})
print("real", line(rs))
json.dump({"names": NAMES, "val": vs, "real": rs, "conf3": vconf3.tolist(), "conf13": vconf13.tolist(), "recall": recall}, open("ml/data/board-stats.json", "w"))

net.eval()
layers = []
for c, b in zip(net.convs, net.bns):
    w, bias = fold(c, b)
    layers.append({"k": 3, "in": c.in_channels, "out": c.out_channels, "stride": c.stride[0], "relu": True, "w": pack(w), "b": pack(bias)})
layers.append({"k": 1, "in": net.head.in_channels, "out": NC, "stride": 1, "relu": False, "w": pack(net.head.weight), "b": pack(net.head.bias)})
sample = f32(xv[:2])
with torch.no_grad():
    logits = net(sample)  # 2 x 3 x 8 x 8
json.dump({"side": SIDE, "classes": NC, "layers": layers, "val": vs["square"], "real": rs["square"]}, open(OUT, "w"))
# two boards with the logits PyTorch gives them (class-major, then row, then column; 13 x 8 x 8 each) so the TypeScript forward pass can be checked
json.dump({"x": sample.flatten().tolist(), "logits": logits.flatten().tolist()}, open("src/vision/boardCnn.check.json", "w"))
print("wrote", OUT)
