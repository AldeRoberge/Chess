# Agent board

- **grove** (done): table play, graph spacing, setup focus, HUD, bot-play narration language. Files are free again.
- **birch** (done): auto-detect board corners from the checkerboard, printed labels, and AI. Files are free again.
- **lens** (done): splash skips Vite hot reload. src/ui/splash.ts, src/ui/splash.test.ts, src/main.ts are free.
- **flint** (done): CI type errors were already overtaken on origin. Files are free again.
- **cedar** (done): simple table UX — flip, PGN/FEN copy, piece set, game-over, phone promotion, English dwell menu, color-blind theme. Files are free again.
- **elm** (done): takeback/resign/draw, drag snap, clickable scoresheet, camera status on the table, phone resign/draw/takeback. Files are free again.
- **ivy** (working): download PGN, rematch on the banner, hints/legal-dots on the table, clocks on the phone, announced legal squares. Claiming src/ui/panels.ts, src/ui/panels.test.ts, src/style.css, src/remote/protocol.ts, src/remote/host.ts, src/remote/host.test.ts, src/remote/client.ts, src/remote/client.test.ts, src/remote/remote.css, src/remote/relay.test.ts.
- **ash** (working): quad-editor Auto detect grabs the table and the lamp, and names corners as if white sat at the bottom. Editing src/vision/findBoard.ts, src/vision/findBoard.test.ts, src/ui/quadEditor.ts, src/ui/quadEditor.test.ts.
- **reed** (done): CI type errors in src/remote/client.test.ts and src/ui/panels.test.ts are on main. Those files are free; leftover unstaged lines in panels.test.ts were left in place.
- **brook** (done): a flat lamp no longer keeps a vacated square occupied, and a soft extra square no longer blocks a clear move. src/vision/sampler.ts, src/chess/tracker.ts are free again.
- **wren** (done): a stepped king is no longer wiped for not matching the learned piece tone, and a soft but exact king step is accepted. Files are free again.
- **quill** (working): remember past alignments and try them on the next auto-detect. src/ui/autoAlign.ts, src/ui/autoAlign.test.ts, and the auto-detect start in src/ui/quadEditor.ts.
- **pixel** (done): camera picture stays at capture resolution and the webcam default is 4 fps. Files are free again.
- **lark** (working): a false colour-flip warning becomes a diagram of the pieces sliding home. Editing src/ui/boardGuide.ts, src/ui/boardGuide.test.ts, src/ui/pieceCoach.ts, src/ui/pieceCoach.test.ts, and the meter line in src/ui/quadEditor.ts. Auto-detect in that file stays with ash.
