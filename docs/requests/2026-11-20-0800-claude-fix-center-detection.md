# Fix centre detection in auto board adjust
- Agent: Claude
- Time: 2026-11-20 08:00 (local)
- Ask: Centre detection does not work at all for auto board adjust; find out why and fix it.

## Tasks
- [x] Read centerSeed / autoAlign; found fuzz and board edge outscored the faint squares
- [x] Keep only crossings with lattice support; regression test added; vision+ui tests and tsc pass
