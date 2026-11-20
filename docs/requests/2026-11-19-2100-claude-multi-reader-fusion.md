# Split board reader into several readers and fuse them
- Agent: Claude
- Time: 2026-11-19 21:00 (local)
- Ask: Separate readers (heuristic, neural per-square, neural whole-board), each showing its confidence, merged into one detection system.

## Tasks
- [x] Check what already exists: an earlier session built it (src/plugins/pipeline.ts, "Modular detection -> bot" workflow); pipeline/readings/workflow tests pass (31)
- [ ] Waiting on the user: what is still missing from their point of view
- [x] Adaptive reader weights in Blend Readings ("Learn which detector to trust")
- [x] Combined confidence readout (per-detector sureness and share, detectors agree %)
- [x] Auto-calibration hook on Flatten Board ("Suggest auto-calibration when lost")
- [ ] Make modular chain the default graph: NOT done, many tests and assistant tools assume the single Board Reader node
- [ ] Look at it in the running app (preview was refused)
