# Fewer node sections, remember camera corners
- Agent: Claude
- Time: 2026-11-19 20:10 (local)
- Ask: Never collapse a single property into a section, name sections after the action, keep the collapsed line to one short summary, and remember board corners per camera across runs and workflows.

## Tasks
- [x] Flatten sections with fewer than two settings
- [x] Rename section headers as actions
- [x] One-line "N settings · M changed" summary
- [x] Remember corners per camera (src/vision/cornerMemory.ts) and restore on a known camera
- [x] Tests and type-check (full-suite run: a CNN weights test fails because of another session's uncommitted model files)
