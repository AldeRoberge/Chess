# Speed up the app: stop re-reading and repainting unchanged camera frames
- Agent: Claude
- Time: 2026-11-19 21:25 (local)
- Ask: Find why the app is slow and optimize it, e.g. do not re-read/re-convert the webcam image every time; keep it in memory per node.

## Tasks
- [x] Find hot spots (previews repaint every 66 ms even when the frame is unchanged; brightness/neural nodes rebuild identical readings every tick)
- [x] Editor: skip repainting a node preview whose outputs, params, size and hover are unchanged
- [x] Brightness / neural readers: reuse the reading object until the input actually changes
- [x] Type-check and run tests

## Follow-up: hide expensive previews (flame graph timings)
- [x] Time each preview paint (same data as the "<node> preview" flame-graph spans) and hide the costliest ones past a 6 ms budget with "Hidden to preserve performance"
- [x] Unit tests for the choice (src/ui/previewBudget.test.ts); editor and perf panel tests pass
- [ ] Could not capture a real flame graph: the Browser pane could not reach the dev server (pane hidden)
