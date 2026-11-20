# Webcam preview: hide only when out of view, never fade in view
- Agent: Claude
- Time: 2026-11-20 08:30 (local)
- Ask: Stop the webcam node's preview from fading out / being hidden while it is on screen; it should only stop showing when scrolled out of view.

## Tasks
- [x] Exempt source.webcam from the preview-budget hide (editor.ts)
- [x] Type-check and editor tests pass (not checked live in the browser)
