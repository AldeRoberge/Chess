# Auto corners: start from the middle of the board
- Agent: Claude
- Time: 2026-11-19 23:30 (local)
- Ask: Find the board's middle from the empty centre's two-light-two-dark crossings with simple math and use it as a starting guess; also asked whether the ML piece reader could guide it.

## Tasks
- [x] findCenterSeed (rotation-invariant crossing lattice -> centre, size, turn, corners)
- [x] Added to candidateLayouts and as a trace seed
- [x] Tests (0/20/35/70 degrees, plain picture); tsc and UI/vision tests pass
- [x] ML piece guide: user said yes, rank candidates
- [x] ML ranking: netFit scores each candidate layout with the board reader; candidateLayouts puts the most believed first (reorder only)
