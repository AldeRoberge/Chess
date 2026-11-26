# Mobile UI polish: gradient, hidden menus, black start, iPhone-only use, less text
- Agent: Claude
- Time: 2026-11-25 23:05 (local)
- Ask: Fix UI issues on mobile: a weird top gradient, top menus rendering behind content, a black screen with no indicator while the app reloads, make it work on just an iPhone with its camera, and remove redundant or verbose text. Make it the best it can be.

## Tasks
- [x] Rebase the menu-bar commit onto latest main (approved by the user)
- [ ] Reproduce each issue at iPhone size
- [ ] Fix the top gradient and menu stacking
- [ ] Add a loading state so reopening never shows a blank black screen
- [ ] Make the app work on a lone iPhone with its camera
- [ ] Trim redundant, verbose or useless text
- [ ] Type-check, test, commit and push to main
