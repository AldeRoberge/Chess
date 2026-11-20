# App gets slower over time: is it the Performance tab?
- Agent: Claude
- Time: 2026-11-19 23:00 (local)
- Ask: The user feels the app gets slower the longer it is used and asks whether the Performance tab is the cause. Follow-up: hunt for the real cause.

## Tasks
- [x] Read the profiler and Performance panel code (bounded: 240 frames, 120-sample rings, only recording on the Perf tab)
- [x] Check what is bounded and when profiling is on
- [x] Scan the frame loop, editor, logs and worker pools for unbounded growth (logs capped at 60, pools gated by inflight)
- [x] Run the app in the preview: idle and page-cycling heap/DOM/canvas counts stay flat (no camera available)
- [ ] Frame-time drift over a long session: not measurable, the preview pane was hidden so rAF paused
- [x] Report findings (no code changes)
