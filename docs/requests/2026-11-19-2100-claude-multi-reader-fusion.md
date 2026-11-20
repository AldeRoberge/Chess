# Split board reader into several readers and fuse them
- Agent: Claude
- Time: 2026-11-19 21:00 (local)
- Ask: Separate readers (heuristic, neural per-square, neural whole-board), each showing its confidence, merged into one detection system.

## Tasks
- [x] Check what already exists: an earlier session built it (src/plugins/pipeline.ts, "Modular detection -> bot" workflow); pipeline/readings/workflow tests pass (31)
- [ ] Waiting on the user: what is still missing from their point of view
