# Blend Readings knows piece positions and types
- Agent: Claude
- Time: 2026-11-20 04:30 (local)
- Ask: Blend Readings should not only mix white/black occupancy but also use the actual piece positions: the tracked game position as a prior, and the piece types from the neural board reader.

## Tasks
- [x] Reading.types carried from the neural board reader
- [x] blendReadings mixes types and takes the game position (FEN) as a gentle prior vote
- [x] Blend node: "Weight of the game position" param (default 0.3), uses bus.game when synced/moved
- [x] Tests (typecheck and plugin/vision/workflow suites pass)
