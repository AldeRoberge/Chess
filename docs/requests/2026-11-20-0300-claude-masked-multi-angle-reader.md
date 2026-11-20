# Neural reader on masked raw views from many angles (no flattening)
- Agent: Claude
- Time: 2026-11-20 03:00 (local)
- Ask: Instead of flattening, train a net on boards seen from many angles and feed it the camera picture with everything outside the board blacked out (with padding).

## Tasks
- [ ] Read how the current board net is trained and what data exists
- [ ] Mask node (outside board blacked out, padded crop)
- [ ] Multi-angle training data + trainer + weights
- [ ] Neural reader node for it, wired into Blend
- [ ] Tests

## Result
- [x] boardView.ts (masked, un-straightened view), Mask Board + Neural View Reader nodes, 4th Blend input, ml/train_view.py, viewCnn.ts + weights
- [x] Trained on 6000 random-angle renders (5 min to render, ~1.5 min to train): val 86.8% squares (colour+occupancy), vs 98.1% for the straightened board reader
- [ ] NOT wired into the Split chain or default: it is weaker than the straightened reader
