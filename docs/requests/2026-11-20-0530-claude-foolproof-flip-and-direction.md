# Foolproof flip check and show direction
- Agent: Claude
- Time: 2026-11-20 05:30 (local)
- Ask: Make the "pieces look turned" check foolproof and show which direction (white's side) the corners imply.

## Tasks
- [x] Replace the brightness check with the neural reader: read the board in both corner orders, offer the flip only when exactly one reads as the start position (fit >= 0.7, lead >= 0.2, three reads in a row, grid good)
- [x] Direction arrow on the grid: BLACK -> WHITE, green when the pieces agree, amber "WHITE?" when they say the other way
- [x] Tests, type-check, commit
