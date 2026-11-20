# Stop redoing setup on every test
- Agent: Claude
- Time: 2026-11-20 04:00 (local)
- Ask: Load the modular workflow by default and restore the last open workflow on reload (autosave); list it higher among the demos; remember board corners across workflow changes and reloads; make "Learn board now" unnecessary.

## Tasks
- [ ] Default/restore workflow + autosave
- [ ] Modular demo higher in the list
- [ ] Corner memory in Flatten Board (across workflow loads and reloads)
- [ ] Auto-learn the empty-square reference (no button needed), remembered too
- [ ] Tests
- [x] First run opens the modular demo (one webcam); the open workflow was already autosaved and restored on reload
- [x] Modular demo listed first in the workflow panel
- [x] Flatten Board remembers and recalls corners per camera (across workflows and reloads)
- [x] Auto-learn of empty squares no longer gives up after 8 tries; keeps retrying (every 5 s) until the start position is on the board; the button is now "Re-learn now (normally automatic)"
- [ ] Not checked with a real camera
