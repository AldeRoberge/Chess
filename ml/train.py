"""Train the square classifier and export it for src/vision/squareCnn.ts.

    python -I ml/train.py            # reads ml/data/{train,val,real}.{x,y}, writes src/vision/squareCnn.weights.json

Input: 32x32 exposure-normalised crop of one square (src/vision/squareCrops.ts).
Output: 3 classes - 0 empty, 1 white piece, 2 black piece.
Batch norm is folded into the convolutions on export, so the TypeScript side is plain conv + relu + pool + dense.
"""
import base64, copy, json, math, os, sys, time
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

CROP = 32
EPOCHS = int(sys.argv[1]) if len(sys.argv) > 1 else 24
OUT = os.environ.get("OUT", "src/vision/squareCnn.weights.json")
CHECK = os.environ.get("CHECK", "src/vision/squareCnn.check.json")
STATS = os.environ.get("STATS", "ml/data/square-stats.json")
DEV = torch.device("cuda" if torch.cuda.is_available() else "cpu")
torch.manual_seed(0)
np.random.seed(0)


def load(name):
    x = np.fromfile(f"ml/data/{name}.x", dtype=np.uint8).reshape(-1, 1, CROP, CROP)
    y = np.fromfile(f"ml/data/{name}.y", dtype=np.uint8).astype(np.int64)
    return torch.from_numpy(x.astype(np.float32) / 127.5).to(DEV), torch.from_numpy(y).to(DEV)


class Net(nn.Module):
    """Three stride-2 convolutions (32 -> 16 -> 8 -> 4 px) and two dense layers: about 200k multiply-adds per square."""

    def __init__(self):
        super().__init__()
        self.c1, self.b1 = nn.Conv2d(1, 8, 3, stride=2, padding=1), nn.BatchNorm2d(8)
        self.c2, self.b2 = nn.Conv2d(8, 16, 3, stride=2, padding=1), nn.BatchNorm2d(16)
        self.c3, self.b3 = nn.Conv2d(16, 32, 3, stride=2, padding=1), nn.BatchNorm2d(32)
        self.f1 = nn.Linear(32 * 4 * 4, 64)
        self.f2 = nn.Linear(64, 3)
        self.drop = nn.Dropout(0.25)

    def forward(self, x):
        x = F.relu(self.b1(self.c1(x)))
        x = F.relu(self.b2(self.c2(x)))
        x = F.relu(self.b3(self.c3(x)))
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


parts = [load(name.strip()) for name in os.environ.get("TRAIN", "train").split(",")]
source_weights = [float(w) for w in os.environ.get("TRAIN_WEIGHTS", "").split(",")] if os.environ.get("TRAIN_WEIGHTS") else None
if source_weights and (len(source_weights) != len(parts) or min(source_weights) <= 0):
    raise ValueError("TRAIN_WEIGHTS must give one positive weight per TRAIN dataset")
sample_weights = torch.cat([torch.full((len(p[0]),),w/len(p[0]),device=DEV) for p,w in zip(parts,source_weights)]) if source_weights else None
xt, yt = torch.cat([x for x, _ in parts]), torch.cat([y for _, y in parts])
del parts
xv, yv = load(os.environ.get("VAL", "val"))
xr, yr = load("real")
# Fine-tune on augmented copies of the real frame. "holdout" trains on files a-d only and judges the model
# on files e-h of the untouched frame; "all" uses every square (the shipped model), so its real score is optimistic.
REAL = sys.argv[2] if len(sys.argv) > 2 else "none"
if REAL != "none":
    if sample_weights is not None: raise ValueError("Include realaug explicitly in TRAIN when using TRAIN_WEIGHTS")
    xa, ya = load("realaug")
    col = torch.arange(len(xa), device=DEV) % 8
    keep = col < 4 if REAL == "holdout" else col >= 0
    xt, yt = torch.cat([xt] + [xa[keep]] * 3), torch.cat([yt] + [ya[keep]] * 3)
    if REAL == "holdout":
        hold = (torch.arange(64, device=DEV) % 8) >= 4
        xr, yr = xr[hold], yr[hold]
print(f"train {len(xt)} val {len(xv)} real {len(xr)}; classes {torch.bincount(yt).tolist()}")
net = Net().to(DEV)
if os.environ.get("INIT"):
    old=json.load(open(os.environ['INIT']))
    def decoded(value,shape):
        return torch.from_numpy(np.frombuffer(base64.b64decode(value),dtype='<f4').copy().reshape(shape)).to(DEV)
    with torch.no_grad():
        for conv,bn,layer in zip([net.c1,net.c2,net.c3],[net.b1,net.b2,net.b3],old['layers']):
            conv.weight.copy_(decoded(layer['w'],tuple(conv.weight.shape))); conv.bias.copy_(decoded(layer['b'],tuple(conv.bias.shape)))
            bn.weight.fill_(math.sqrt(1+bn.eps)); bn.bias.zero_(); bn.running_mean.zero_(); bn.running_var.fill_(1)
        for dense,layer in zip([net.f1,net.f2],old['layers'][3:]):
            dense.weight.copy_(decoded(layer['w'],tuple(dense.weight.shape))); dense.bias.copy_(decoded(layer['b'],tuple(dense.bias.shape)))
    print('Initialized from',os.environ['INIT'],flush=True)
print("device", DEV)
opt = torch.optim.AdamW(net.parameters(), 2e-3, weight_decay=1e-4)
epoch_samples = int(os.environ.get('EPOCH_SAMPLES',len(xt)))
steps = EPOCHS * (epoch_samples // 256)
sched = torch.optim.lr_scheduler.OneCycleLR(opt, float(os.environ.get('MAX_LR','0.004')), total_steps=steps)
best_score=-1; best_state=None; best_epoch=0
t0 = time.time()
for ep in range(EPOCHS):
    net.train()
    perm = torch.multinomial(sample_weights,epoch_samples,replacement=True) if sample_weights is not None else torch.randperm(len(xt),device=DEV)[:epoch_samples]
    for i in range(0, len(perm) - 255, 256):
        idx = perm[i:i + 256]
        loss = F.cross_entropy(net(augment(xt[idx])), yt[idx], label_smoothing=0.05)
        opt.zero_grad(); loss.backward(); opt.step(); sched.step()
    va, _ = evaluate(net, xv, yv)
    ra, _ = evaluate(net, xr, yr)
    if va > best_score:
        best_score=va; best_state=copy.deepcopy(net.state_dict()); best_epoch=ep+1
    print(f"epoch {ep + 1:2d} loss {loss.item():.3f} val {va:.4f} real-start {ra:.3f} ({time.time() - t0:.0f}s)",flush=True)

net.load_state_dict(best_state)
print('Selected best validation epoch',best_epoch,flush=True)
va, conf = evaluate(net, xv, yv)
ra, rconf = evaluate(net, xr, yr)
print("val accuracy", va, "\nconfusion (rows truth, cols pred: empty/white/black)\n", conf.tolist())
print("real start frame accuracy", ra, "\n", rconf.tolist())
json.dump({'val':va,'real':ra,'bestEpoch':best_epoch,'conf3':conf.tolist(),'realConf3':rconf.tolist()},open(STATS,'w'))

net.eval()
w1, b1 = fold(net.c1, net.b1); w2, b2 = fold(net.c2, net.b2); w3, b3 = fold(net.c3, net.b3)
layers = [
    {"type": "conv", "in": 1, "out": 8, "stride": 2, "w": pack(w1), "b": pack(b1)},
    {"type": "conv", "in": 8, "out": 16, "stride": 2, "w": pack(w2), "b": pack(b2)},
    {"type": "conv", "in": 16, "out": 32, "stride": 2, "w": pack(w3), "b": pack(b3)},
    {"type": "dense", "in": 512, "out": 64, "w": pack(net.f1.weight), "b": pack(net.f1.bias)},
    {"type": "dense", "in": 64, "out": 3, "w": pack(net.f2.weight), "b": pack(net.f2.bias), "last": True},
]
sample = xv[:3]
with torch.no_grad():
    logits = net(sample)
json.dump({"crop": CROP, "layers": layers, "val": va, "real": ra}, open(OUT, "w"))
# a few crops with the logits PyTorch gives them, so the TypeScript forward pass can be checked against them
json.dump({"x": sample.flatten().tolist(), "logits": logits.flatten().tolist()}, open(CHECK, "w"))
print("wrote", OUT)
