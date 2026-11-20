# Blink the centre crossing and the OCR finds
- Agent: Claude
- Time: 2026-11-19 24:00 (local)
- Ask: Make the centre crossing blink when found, same for OCR (user suspects OCR does not work at all).

## Tasks
- [x] Centre seed: cyan dashed quad, crosshair and CENTRE FOUND blink for 4 s
- [x] OCR: report (reading / found / none / unavailable + reason); read letters blink magenta; status line in the corner editor
- [x] Check tesseract loads in the browser: it does (online); clean letters read at 99%, vertical digits missed in a plain test
- [x] Tests; tsc and UI/vision tests pass
