# Home-screen app icon and seasonal logos
- Agent: Claude
- Time: 2026-11-23 08:38 (local)
- Ask: Make "Add to Home Screen" on iPhone show the knight instead of a "C" tile, then make the app logo change with the date for Christmas, Valentine's Day, New Year, Halloween and similar holidays. Finally: commit it to main.

## Tasks
- [x] Add an opaque 180x180 apple-touch-icon and link it in index.html
- [x] Holiday calendar (src/ui/seasons.ts): New Year, Valentine's, St. Patrick's, Easter, Halloween, Christmas; `?season=` preview
- [x] Seasonal knight artwork (src/ui/seasonArt.ts) and live logo swap, favicon and touch-icon link (src/ui/brandIcon.ts), re-checked at midnight
- [x] `npm run icons` renders the touch-icon PNGs (scripts/make-touch-icons.mjs); `sharp` added as a dev dependency
- [x] Tests for the calendar and the logo swap; typecheck and the full suite passed when written; checked in the browser with `?season=halloween` (not tried on a real iPhone)
- [x] Commit to main: the code was already committed and pushed on 2026-11-20 inside "fixes" (3790b30), so only this log is committed now
- [ ] Not mine, left alone: `npx tsc --noEmit` now reports `Cannot find module 'tesseract.js'` in src/vision/boardLabels.ts (listed in package.json, missing from node_modules here; `npm install` should fix it)
