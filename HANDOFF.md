# Handoff (updated 2026-11-19)

For the next AI continuing this project.

Owner: Alex. Hardware: a single webcam. Standing rules: use sensible defaults, don't ask unless dangerous; commit small, pull first, push to `main`; keep CI green. Run the long test suite on GitHub CI, not locally. See `CLAUDE.md` (shared working tree: never reset/stash/clean, stage only your own files).

## Done on main
- Simple Setup/Play view with "Show nodes" toggle; phone game-end text.
- Perf: median filter, Move Tracker, node layout, Board Reader in a Web Worker (46 to 60 fps).
- Board corners page fits small screens; 3D camera view remembered, higher/closer default.
- Ribbon collapses on tab click; splash shows build age.
- Default workflow is one camera / one reader; resume ongoing game + New game button.
- Tabs renamed: Table -> Game, 3D / Mapping -> World.
- Phone join screen at site root; join code shown in a large badge on desktop.
- Move Tracker accepts the single legal move matching changed squares; "Can't read the board" message; auto-learn start position retry.
- Desktop Game view layout fixed (board sized to window, no scrolling).
- Portrait layout work merged.
- Alignment page: piece ring further out on light discs, corner markers green when aligned.
- Board reader more precise under bright/dim/noisy light; optional neural square reader behind a Board Reader switch.
- Calibration uses four simple boards (at most five pieces after start position).

## Unfinished / to verify
1. **CI/deploy**: Alex says changes don't show on their phone (alderoberge.com/chess). Check latest GitHub Actions runs and the deploy job; decouple deploy from the known failing tests or fix them (findBoard x2, e2e "overexposed" and "three cameras"; app.test.ts failures; old type error in worker/bridge.ts). Check phone caching / service worker.
2. **Join code**: verify it is very visible on desktop (big badge, Phone ribbon button with big code + QR/link, phone URL shown).
3. **Portrait mode**: simplify, iconified, horizontal scrollable menus, smooth node map pan/zoom, nothing crammed. Verify what landed.
4. **Auto-start calibration** with a "Calibration in progress..." window when board confidence is very low (was in progress; verify).
5. **Alignment page**: verify piece icons readable (black pieces visible) and corner colors consistent.
6. **Perf ideas not done**: redraw Game board only when it changes; cache node-view wire end positions (measured every 400 ms); Move Tracker pair-of-moves spikes up to 190 ms.
7. **Simplified view** should fit with no scrolling, nothing huge; landscape phone (844x390) still scrolls a little.
8. **Phone remote**: play a full game end to end on a real phone (never done), then fix gaps.
9. **Move detection**: smarter via frame differences, plausible-move reasoning, explain red squares in UI (partly done; verify with real webcam).
10. **Local dev**: http://localhost:5173/ (`npm run dev`), phone remote code shown in app. Alex's local checkout was behind main: `git pull --ff-only`.

Check `git log` before starting; some items may have landed since.
