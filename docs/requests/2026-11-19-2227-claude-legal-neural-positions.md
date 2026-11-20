# Neural reader: no impossible positions
- Agent: Claude
- Time: 2026-11-19 22:27 (local)
- Ask: Make sure the neural net's piece reading never shows nonsense (too many pawns, kings, etc.).

## Tasks
- [x] legalLetters() in vision/readings.ts (1 king, 8 pawns, none on back rows, extras only via promotion)
- [x] Use it when drawing the neural board / blend piece icons
- [x] Test
