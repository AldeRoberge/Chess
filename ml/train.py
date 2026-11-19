"""Train the square classifier and export it for src/vision/squareCnn.ts.

    python -I ml/train.py            # reads ml/data/{train,val,real}.{x,y}, writes src/vision/squareCnn.weights.json

Input: 32x32 exposure-normalised crop of one square (src/vision/squareCrops.ts).
Output: 3 classes - 0 empty, 1 white piece, 2 black piece.
Batch norm is folded into the convolutions on export, so the TypeScript side is plain conv + relu + pool + dense.
"""
import base64, json, sys, time
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

CROP = 32
EPOCHS = int(sys.argv[1]) if len(sys.argv) > 1 else 24
OUT = "src/vision/squareCnn.weights.json"
DEV = torch.device("cuda" if torch.cuda.is_available() else "cpu")
torch.manual_seed(0)
np.random.seed(0)


def load(name):
    x = np.fromfile(f"ml/data/{name}.x", dtype=np.uint8).reshape(-1, 1, CROP, CROP)
    y = np.fromfile(f"ml/data/{name}.y", dtype=np.uint8).astype(np.int64)
    return torch.from_numpy(x.astype(np.float32) / 127.5).to(DEV), torch.from_numpy(y).to(DEV)


class Net(nn.Module):
    def __init__(self):
        super().__init__()
        self.c1, self.b1 = nn.Conv2d(1, 16, 3, padding=1), nn.BatchNorm2d(16)
        self.c2, self.b2 = nn.Conv2d(16, 32, 3, padding=1), nn.BatchNorm2d(32)
        self.c3, self.b3 = nn.Conv2d(32, 48, 3, padding=1), nn.BatchNorm2d(48)
        self.f1 = nn.Linear(48 * 4 * 4, 64)
        self.f2 = nn.Linear(64, 3)
        self.drop = nn.Dropout(0.25)

    def forward(self, x):
        x = F.max_pool2d(F.relu(self.b1(self.c1(x))), 2)  # 16
        x = F.max_pool2d(F.relu(self.b2(self.c2(x))), 2)  # 8
        x = F.max_pool2d(F.relu(self.b3(self.c3(x))), 2)  # 4
        x = self.drop(F.relu(self.f1(x.flatten(1))))
        return self.f2(x)


def augment(x):
    n = x.shape[0]
    # board symmetries: a mirrored or flipped view is just another camera position
    if np.random.rand() < 0.5: x = x.flip(3)
    if np.random.rand() < 0.5: x = x.flip(2)
    # contrast / brightness drift the exposure normalisation does not remove, plus a little noise
    x = x * (0.85 + 0.3 * torch.rand(n, 1, 1, 1, device=x.device)) + 0.06 * torch.randn(n, 1, 1, 1, device=x.device)
    x = x + 0.03 * torch.randn_like(x)
    # +-1 px shift (corner placement is never exact)
    dx, dy = np.random.randint(-1, 2, 2)
    return torch.roll(x, shifts=(int(dy), int(dx)), dims=(2, 3))


def evaluate(net, x, y):
    net.eval()
    with torch.no_grad():
        pred = torch.cat([net(x[i:i + 4096]).argmax(1) for i in range(0, len(x), 4096)])
    conf = torch.bincount(y * 3 + pred, minlength=9).view(3, 3).cpu()
    return (pred == y).float().mean().item(), conf


def fold(conv, bn):
    s = bn.weight / torch.sqrt(bn.running_var + bn.eps)
    return conv.weight * s.view(-1, 1, 1, 1), (conv.bias - bn.running_mean) * s + bn.bias


def pack(t):
    return base64.b64encode(t.detach().cpu().numpy().astype("<f4").tobytes()).decode()


xt, yt = load("train")
xv, yv = load("val")
xr, yr = load("real")
# Fine-tune on augmented copies of the real frame. "holdout" trains on files a-d only and judges the model
# on files e-h of the untouched frame; "all" uses every square (the shipped model), so its real score is optimistic.
REAL = sys.argv[2] if len(sys.argv) > 2 else "none"
if REAL != "none":
    xa, ya = load("realaug")
    col = torch.arange(len(xa), device=DEV) % 8
    keep = col < 4 if REAL == "holdout" else col >= 0
    xt, yt = torch.cat([xt] + [xa[keep]] * 3), torch.cat([yt] + [ya[keep]] * 3)
    if REAL == "holdout":
        hold = (torch.arange(64, device=DEV) % 8) >= 4
        xr, yr = xr[hold], yr[hold]
print(f"train {len(xt)} val {len(xv)} real {len(xr)}; classes {torch.bincount(yt).tolist()}")
net = Net().to(DEV)
print("device", DEV)
opt = torch.optim.AdamW(net.parameters(), 2e-3, weight_decay=1e-4)
steps = EPOCHS * (len(xt) // 256)
sched = torch.optim.lr_scheduler.OneCycleLR(opt, 4e-3, total_steps=steps)
t0 = time.time()
for ep in range(EPOCHS):
    net.train()
    perm = torch.randperm(len(xt), device=DEV)
    for i in range(0, len(xt) - 255, 256):
        idx = perm[i:i + 256]
        loss = F.cross_entropy(net(augment(xt[idx])), yt[idx], label_smoothing=0.05)
        opt.zero_grad(); loss.backward(); opt.step(); sched.step()
    va, _ = evaluate(net, xv, yv)
    ra, _ = evaluate(net, xr, yr)
    print(f"epoch {ep + 1:2d} loss {loss.item():.3f} val {va:.4f} real-start {ra:.3f} ({time.time() - t0:.0f}s)")

va, conf = evaluate(net, xv, yv)
ra, rconf = evaluate(net, xr, yr)
print("val accuracy", va, "\nconfusion (rows truth, cols pred: empty/white/black)\n", conf.tolist())
print("real start frame accuracy", ra, "\n", rconf.tolist())

net.eval()
w1, b1 = fold(net.c1, net.b1); w2, b2 = fold(net.c2, net.b2); w3, b3 = fold(net.c3, net.b3)
layers = [
    {"type": "conv", "in": 1, "out": 16, "w": pack(w1), "b": pack(b1)},
    {"type": "conv", "in": 16, "out": 32, "w": pack(w2), "b": pack(b2)},
    {"type": "conv", "in": 32, "out": 48, "w": pack(w3), "b": pack(b3)},
    {"type": "dense", "in": 768, "out": 64, "w": pack(net.f1.weight), "b": pack(net.f1.bias)},
    {"type": "dense", "in": 64, "out": 3, "w": pack(net.f2.weight), "b": pack(net.f2.bias), "last": True},
]
sample = xv[:3]
with torch.no_grad():
    logits = net(sample)
json.dump({"crop": CROP, "layers": layers, "val": va, "real": ra}, open(OUT, "w"))
# a few crops with the logits PyTorch gives them, so the TypeScript forward pass can be checked against them
json.dump({"x": sample.flatten().tolist(), "logits": logits.flatten().tolist()}, open("src/vision/squareCnn.check.json", "w"))
print("wrote", OUT)
