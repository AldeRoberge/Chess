# OCR board letters as auto-align guides
- Agent: Claude
- Time: 2026-11-20 01:30 (local)
- Ask: Make auto align to board corners use OCR to find the a-h / 1-8 letters on the board, when visible, and use them as guides.

## Tasks
- [x] Add tesseract.js, src/vision/boardLabels.ts (OCR + label geometry -> corner guesses)
- [x] Feed guesses into AutoAligner (async hint) and wire quadEditor, vision plugin, alignAll
- [x] Tests, type-check, commit and push
- [x] Follow-up: do not wait for OCR; start at once, try the label corners if they arrive mid-search (scored like any layout, not trusted)
- [x] Follow-up: centre guess and OCR are optional switches (off by default, remembered); OCR shows only reads that line up as board labels (>=4 in a row, same size, confidence >= 65)
