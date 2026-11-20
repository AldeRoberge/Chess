# Speed up the app: stop re-reading and repainting unchanged camera frames
- Agent: Claude
- Time: 2026-11-19 21:25 (local)
- Ask: Find why the app is slow and optimize it, e.g. do not re-read/re-convert the webcam image every time; keep it in memory per node.

## Tasks
- [x] Find hot spots (previews repaint every 66 ms even when the frame is unchanged; brightness/neural nodes rebuild identical readings every tick)
- [ ] Editor: skip repainting a node preview whose outputs, params, size and hover are unchanged
- [ ] Brightness / neural readers: reuse the reading object until the input actually changes
- [ ] Type-check and run tests
