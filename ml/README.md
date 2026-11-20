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

## Whole-board reader

`src/vision/boardCnn.ts` reads the whole board in one pass instead of 64 crops: the board is flattened to one 160x160 image
with a square of margin (`boardImage.ts`) and a small fully convolutional net outputs all 64 squares. Same data pipeline with
`CNN_BOARD=1` (files are written as `ml/data/board-*`), trained by `ml/train_board.py` (about 2.5 minutes on a GPU):

```powershell
$env:CNN_GEN=1; $env:CNN_BOARD=1; $env:CNN_N=4000; $env:CNN_SEED=1; $env:CNN_OUT="ml/data/board-train"; npx vitest run src/vision/cnnData.gen.test.ts -t "renders positions"
$env:CNN_N=400; $env:CNN_SEED=2; $env:CNN_OUT="ml/data/board-val"; npx vitest run src/vision/cnnData.gen.test.ts -t "renders positions"
$env:CNN_HOLDOUT=1; npx vitest run src/vision/cnnData.gen.test.ts -t "augments"   # drop CNN_HOLDOUT for the shipped model
TRAIN=train,train2 python -I ml/train_board.py 45 all 72   # more boards: a second set with CNN_N=14000 CNN_SEED=5 CNN_OUT=ml/data/board-train2
```

The model outputs 13 classes per square (empty, then pawn to king for white and for black); the tracker uses the colours, and `BoardSampler.pieceTypes` exposes the piece types (not used by the tracker yet). Turn it on with the Board Reader node's "Neural whole-board reader (beta)" switch.

## Training from the supplied glTF chess sets

`render_gltf.py` renders the actual piece meshes with Blender Cycles, soft lighting,
original textures where supplied, randomized legal positions, camera angles, board
colours, and exposure. It writes ordinary colour PNG previews plus grayscale frames
and exact FEN/corner metadata. It does not add artificial sensor noise. This is a
separate data source from the old software renderer; existing datasets are preserved.

The three Desktop ZIPs are CC-BY-4.0 assets. Credits are in
`ml/assets/ATTRIBUTION.md`; imported mesh/texture files, renders and the Python
environment stay local and are git-ignored. `chess_kit` has no textures: its six
assembled pieces receive ivory/dark wood materials. Other packs keep their textures.

```powershell
python -m venv --system-site-packages ml/.venv-render
ml/.venv-render/Scripts/python.exe -m pip install -r ml/requirements-render.txt
python ml/import_chess_assets.py --source C:/Users/rotmg/Desktop

# Quick visual check: one PNG and labeled frame from each of the three sets.
ml/.venv-render/Scripts/python.exe ml/render_gltf.py --count 3 --samples 24 --out ml/renders/preview

# Independent generation runs for training and validation. These are deliberately
# separate folders/seeds; do not import validation renders into a training dataset.
ml/.venv-render/Scripts/python.exe ml/render_gltf.py --count 3000 --seed 11 --out ml/renders/train
ml/.venv-render/Scripts/python.exe ml/render_gltf.py --count 300 --seed 97 --out ml/renders/val

# Use the same crop/normalization code as the live app.
$env:CNN_GEN=1; $env:CNN_BOARD=1; $env:CNN_GLTF='ml/renders/train'; $env:CNN_OUT='ml/data/board-gltf-train'
npx vitest run src/vision/cnnData.gen.test.ts -t 'imports labeled glTF'
$env:CNN_GLTF='ml/renders/val'; $env:CNN_OUT='ml/data/board-gltf-val'
npx vitest run src/vision/cnnData.gen.test.ts -t 'imports labeled glTF'

# Train the whole-board model with both existing and glTF data.
# This writes the shipped model weights and reference logits: evaluate before committing.
$env:TRAIN='train,train2,gltf-train'
$env:VAL='gltf-val'
python -I ml/train_board.py 45 none 72
```

For square-model crops, remove `CNN_BOARD`, set `CNN_OUT=ml/data/gltf-train`
(or `ml/data/gltf-val` for the validation run), and repeat the import. `train.py` also
accepts `TRAIN=train,gltf-train` and `VAL=gltf-val`. Clear `CNN_GLTF`, `CNN_OUT`, `CNN_BOARD`, `VAL` and `TRAIN`
when switching back to the old generation commands.

PNG brightness differs from normalized training tensors. Inspect the colour PNGs
for geometry/lighting; do not judge physical exposure from raw `.x` bytes.
These synthetic validation scores are not real-camera accuracy. Test on separate,
manually checked real sessions; the current saved real frames contain only one
position. A further model-set holdout (e.g. train on two sets, evaluate the third)
can measure transfer to an unseen piece design.
