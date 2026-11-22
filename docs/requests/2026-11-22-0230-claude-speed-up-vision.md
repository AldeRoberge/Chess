# Speed up camera and vision processing
- Agent: Claude
- Time: 2026-11-22 02:30 (UTC; local zone not known)
- Ask: Alex asked for a swarm of 3 haiku agents to make the app faster, focused on the webcam, board detection and piece recognition pipeline (frame cost, per-frame work, allocations, throttling, workers). Changes go to branch claude/project-thread-98c0yh, with CI green. Rendering and bundle/load time are out of scope.

## Tasks
- [x] Create work branch and install dependencies
- [x] Baseline: typecheck and vision tests
- [x] Agent 1: capture path (src/plugins/sources.ts) allocations and grayscale loop
- [x] Agent 2: board sampling and CNN path (src/vision/sampler.ts, squareCrops, boardImage, boardCnn, squareCnn, viewCnn) allocations
- [x] Agent 3: detection and cleaning (src/vision/findBoard.ts, centerSeed, stabilizer, cleaner, clean.worker) work per frame
- [x] Verify typecheck and tests, push branch, report to the thread
