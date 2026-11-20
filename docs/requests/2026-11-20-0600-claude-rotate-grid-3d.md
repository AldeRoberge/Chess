# Rotate the grid in 3D, with the perspective
- Agent: Claude
- Time: 2026-11-20 06:00 (local)
- Ask: The rotate handle should turn the board as in 3D (through the perspective matrix) when that perspective is believable, otherwise a plain rotation; use the perspective found from the square edges when available.

## Tasks
- [x] quadMap: depth + inverse; quadTurn.ts: turnQuadPlane, planeTurnable, pickTurnBase (grid fit >= 0.5, or the traced square-edge perspective, else flat)
- [x] Editor: drag angle measured in board coordinates, readout says "3D" or "flat"
- [x] Tests, type-check, commit
