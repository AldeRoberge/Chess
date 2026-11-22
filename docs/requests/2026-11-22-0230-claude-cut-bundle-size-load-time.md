# Cut bundle size and load time
- Agent: Claude
- Time: 2026-11-22 02:30 (UTC, from session clock)
- Ask: Alex asked for a swarm of 3 Haiku agents to make the app faster, focused on startup: bundle size, lazy loading, asset sizes, engine/model loading, and state persistence cost. Rendering and camera/vision processing are covered by other threads and are out of scope.

## Tasks
- [x] Survey repo, heavy imports, and branch setup
- [ ] Baseline build and chunk sizes
- [ ] Worker 1: lazy-load heavy libraries (three, tesseract, mediapipe, stockfish)
- [ ] Worker 2: asset and public-folder size reductions
- [ ] Worker 3: startup state persistence cost
- [ ] Verify tsc, vitest, and vite build; commit and push
