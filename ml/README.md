# Neural square reader: training

The model classifies one 32x32 crop of a square as empty / white / black (`src/vision/squareCnn.ts`). It is trained on
simulator renders plus real camera frames, and shipped as `src/vision/squareCnn.weights.json`.

## Real frames come in by themselves

While `npm run dev` runs, every Board Reader node with **Save training frames** on (the default) sends a picture to the dev
server when the tracker's confirmed position and that camera agree on all 64 squares, the board is settled and no hand is
over it (`src/vision/collect.ts`). They land in `ml/real/` (git-ignored: they are pictures of your room) as a `.gray` file
(raw 8-bit pixels) and a `.json` (position, corners, size). Nothing is sent from a production build, and only this computer
may post.

## Retrain

```powershell
# 1. crops from the simulator (about 6 minutes for 4000 positions) and the validation set
$env:CNN_GEN=1; $env:CNN_N=4000; $env:CNN_SEED=1; $env:CNN_OUT="ml/data/train"; npx vitest run src/vision/cnnData.gen.test.ts
$env:CNN_N=400; $env:CNN_SEED=2; $env:CNN_OUT="ml/data/val"; npx vitest run src/vision/cnnData.gen.test.ts -t "renders positions"

# 2. real frames, with every 5th saved frame held out of training (the score the trainer prints is on those)
$env:CNN_HOLDOUT=1; npx vitest run src/vision/cnnData.gen.test.ts -t "augments"

# 3. train (about 4 minutes on a GPU; needs the CUDA build of torch) and read the "real start frame accuracy" line
python -I ml/train.py 24 all
```

For the shipped model, rerun step 2 without `CNN_HOLDOUT` so every saved frame is used, then train again.
