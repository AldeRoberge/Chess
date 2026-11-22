# Performance swarm, worker 3: startup persistence cost
- Agent: Claude
- Time: 2026-11-22 02:32 (local)
- Ask: Cut the startup and per-tick cost of state persistence (localStorage writes, JSON parse/stringify) without changing what is saved, as part of a 3-worker performance swarm.

## Tasks
- [x] Find localStorage / JSON hot spots in src (outside the files owned by other teams)
- [x] Share one serialization between the graph autosave and the undo history; skip unchanged graph writes (src/app.ts, src/core/history.ts)
- [x] Throttle the top-bar storage-size scan (src/app.ts)
- [x] Type-check, build to scratchpad, run affected tests
- [x] Report to the coordinator (no commit: the swarm lead commits)
