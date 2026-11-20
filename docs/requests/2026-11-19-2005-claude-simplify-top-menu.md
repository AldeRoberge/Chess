# Replace the ribbon with a File / Edit / View / Tools menu bar
- Agent: Claude
- Time: 2026-11-19 20:05 (local)
- Ask: Simplify the top menu into a traditional menu bar. Remove the Align boards button, move Restore/Backup/Demos/Build with AI under File > Open and New, treat Play bot as a suggested ready-made workflow, rename demos to ready-made workflows for a purpose, hide selection actions when nothing is selected, and fill View and Tools with useful items.

## Tasks
- [x] Read the current ribbon, its CSS and everything else that references it
- [x] Build the menu bar component (menus, submenus, keyboard, outside click)
- [x] Wire File, Edit, View and Tools items to the existing actions
- [x] Remove the ribbon markup and CSS, fix header layout and small screens
- [x] Update tests, type-check, run the suite
- [x] Commit to main
