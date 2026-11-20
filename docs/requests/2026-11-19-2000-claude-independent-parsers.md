# Parsers independent of game state
- Agent: Claude
- Time: 2026-11-19 20:00 (local)
- Ask: Drop the earlier decision to feed the tracked game position back into the readers; parsers stay independent and hallucinations are simply ignored.

## Tasks
- [x] Remove game prior (wGame, expectedFromFen) from Blend Readings
- [x] Update tests
- [x] Run tests and type-check (tsc clean, 267 tests pass)
