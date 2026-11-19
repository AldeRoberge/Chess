# Agent board

- **grove** (done): table play, graph spacing, setup focus, HUD, bot-play narration language. Files are free again.
- **birch** (done): auto-detect board corners from the checkerboard, printed labels, and AI. Files are free again.
- **lens** (done): splash skips Vite hot reload. src/ui/splash.ts, src/ui/splash.test.ts, src/main.ts are free.
- **flint** (done): CI type errors were already overtaken on origin. Files are free again.
- **cedar** (done): simple table UX — flip, PGN/FEN copy, piece set, game-over, phone promotion, English dwell menu, color-blind theme. Files are free again.
- **elm** (done): takeback/resign/draw, drag snap, clickable scoresheet, camera status on the table, phone resign/draw/takeback. Files are free again.
- **ivy** (done): download PGN, rematch on the banner, hints/legal-dots on the table, clocks on the phone, announced legal squares. Files are free again.
- **ash** (working): quad-editor Auto detect grabs the table and the lamp, and names corners as if white sat at the bottom. Editing src/vision/findBoard.ts, src/vision/findBoard.test.ts, src/ui/quadEditor.ts, src/ui/quadEditor.test.ts.
- **reed** (done): CI type errors in src/remote/client.test.ts and src/ui/panels.test.ts are on main. Those files are free; leftover unstaged lines in panels.test.ts were left in place.
- **brook** (done): a flat lamp no longer keeps a vacated square occupied, and a soft extra square no longer blocks a clear move. src/vision/sampler.ts, src/chess/tracker.ts are free again.
- **wren** (done): a stepped king is no longer wiped for not matching the learned piece tone, and a soft but exact king step is accepted. Files are free again.
- **quill** (done): auto-detect guesses come from the checkerboard, the corners on screen, their perspective, and past alignments. src/ui/autoAlign.ts and src/ui/autoAlign.test.ts are free.
- **pixel** (done): camera picture stays at capture resolution and the webcam default is 4 fps. Files are free again.
- **lark** (done): pieces off their home squares show a sliding diagram instead of a false colour-flip warning. src/ui/boardGuide.ts, src/ui/boardGuide.test.ts, src/ui/pieceCoach.ts, src/ui/pieceCoach.test.ts, and the meter line in src/ui/quadEditor.ts are free.
- **piper** (done): the assistant speaks the setup and camera alignment, and the Assistant page shows those lines so you can reply. Files are free again.
- **moss** (done): OpenAI and ElevenLabs keys set on the Cloudflare worker are used, and the app stops asking for them. worker/index.ts, worker/index.test.ts, wrangler.jsonc, src/ui/wizardSteps.ts, src/setup/aiVoice.test.ts, src/ui/workflows.ts, src/ui/assistantKeyBox.ts, src/ui/paramDocs.ts are free.
