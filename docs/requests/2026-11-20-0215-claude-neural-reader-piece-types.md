# Show piece types in the neural reader of Modular detection
- Agent: Claude
- Time: 2026-11-20 02:15 (local)
- Ask: In "Modular detection -> bot" the piece-detection ML node only showed black and white discs; show what the ML detects.

## Tasks
- [x] Found: the 13-class model's piece types were dropped by the worker/pool/node
- [x] Pass types through netWorker/netPool/neuralBoard, draw letters on the discs
- [x] Tests, type-check, commit
- [x] Follow-up: draw the piece icon (current piece set) instead of a letter; letter disc only while the image loads
