# Auto corner detection: no tiny or huge boards
- Agent: Claude
- Time: 2026-11-19 23:00 (local)
- Ask: Auto corner testing must never assume the board is incredibly small or incredibly big (mostly out of bounds).

## Tasks
- [x] plausibleBoard guard (area share 5-110%, 80% of grid inside frame) on every candidate and label guess
- [x] tests; tsc and UI tests pass
