# Windows-style menu bar (File, Edit, View, Tools)
- Agent: Claude
- Time: 2026-11-19 21:55 (local)
- Ask: User had asked for the top menu to be redone like Windows with a File menu, but the app still only has the Office-style ribbon tabs.

## Tasks
- [x] Found: only Home/View/Tools ribbon tabs exist, no File menu
- [x] Add src/ui/menus/menuBar.ts (File, Edit, View, Tools, Help dropdowns that drive existing buttons)
- [x] Wire into app.ts header, hide ribbon tabs/panes via CSS
- [x] Type-check and test, checked in the browser
