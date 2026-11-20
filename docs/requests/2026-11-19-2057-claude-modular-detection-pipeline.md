# Modular detection pipeline: finish and verify
- Agent: Claude
- Time: 2026-11-19 20:57 (local)
- Ask: Make the camera-to-board detection a chain of separate nodes (heuristic, ML, blend) that each show what they do, with piece presence only. The user said "keep going" after the first version.

## Tasks
- [x] Nodes: Clean Picture, Flatten Board, Brightness Reader, Neural Board Reader, Neural Square Reader, Blend Readings, Camera Reading
- [x] "Modular detection -> bot" workflow, presence-only previews on the old nodes
- [ ] Look at the corrected workflow layout and per-node cost in the running app
- [ ] Hook auto-calibration ("suggest when lost") into the new chain
- [ ] Run the full test suite and type-check
