# Speed up board rendering
- Agent: Claude
- Time: 2026-11-22 02:30 (UTC)
- Ask: Alex asked for a swarm of 3 haiku agents to make the app's performance better, focused on rendering (3D scene, board/overlay drawing, per-frame DOM work and animation loops). Commit as we go, keep CI green.

## Tasks
- [x] Inspect rendering hot spots (3D view, 2D overlays, app frame loop)
- [x] Haiku worker A: 3D board view (src/world/view.ts, src/sim/render3d.ts)
- [x] Haiku worker B: 2D overlay drawing (src/world/overlay*.ts, clock/piece/chevrons, src/fx, src/outputPage.ts)
- [x] Haiku worker C: per-frame DOM and animation loops (src/app.ts step, src/ui/perfPanel.ts, tooltip, editor, moveGuide)
- [x] Typecheck and targeted tests pass (tsc clean; 24 files, 284 tests pass)
- [x] Commit and push to alderoberge/chess branch claude/project-thread-9ivh9a
- [x] Report results in thread
