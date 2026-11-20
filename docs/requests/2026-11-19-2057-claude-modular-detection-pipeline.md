# Modular detection pipeline: finish and verify
- Agent: Claude
- Time: 2026-11-19 20:57 (local)
- Ask: Make the camera-to-board detection a chain of separate nodes (heuristic, ML, blend) that each show what they do, with piece presence only. The user said "keep going" after the first version.

## Tasks
- [x] Nodes: Clean Picture, Flatten Board, Brightness Reader, Neural Board Reader, Neural Square Reader, Blend Readings, Camera Reading
- [x] "Modular detection -> bot" workflow, presence-only previews on the old nodes
- [x] Per-node cost in the running app: the neural reader was ~16 ms per camera on the main thread, so it now runs in a worker (graph tick 48 ms -> 4.5 ms with 3 cameras). The editor re-organises the layout on load, so my own layout is overridden.
- [x] Headless check: the modular chain syncs the tracker the same way the old Board Reader does
- [ ] Hook auto-calibration ("suggest when lost") into the new chain
- [x] Type-check clean; full suite 1174 passed, 1 e2e failure (src/e2e.test.ts) being re-run alone
