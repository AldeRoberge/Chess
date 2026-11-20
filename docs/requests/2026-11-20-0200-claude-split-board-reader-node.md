# Split Board Reader's neural checkboxes into separate nodes
- Agent: Claude
- Time: 2026-11-20 02:00 (local)
- Ask: The Board Reader node still shows "Neural square reader" / "Neural whole-board reader" checkboxes; make them real separate nodes in the user's graph.

## Tasks
- [ ] Find how to rebuild/migrate a Board Reader into the detector chain
- [ ] Implement and wire into app load + setup build
- [ ] Tests
- [x] Board Reader gets a "Split into separate detector nodes" button; src/workflows/splitReader.ts does the swap
- [x] Phone remote camera frames also read Flatten Board
- [ ] Not auto-applied on load: the Calibrate training wizard still needs the Board Reader node
