# Move Tracker: say what it sees in plain English
- Agent: Claude
- Time: 2026-11-20 07:00 (local)
- Ask: Instead of just "illegal", the Move Tracker should say clearly what the detector sees: an extra piece, a missing piece, etc., with the confidence.

## Tasks
- [x] src/chess/mismatch.ts: explainMismatch (extra / missing / wrong colour, full sentence + short label + confidence + hint)
- [x] Tracker preview footer: "Doesn't match the game", summary, first squares; hover and detail rows carry the full sentences
- [x] Tests, type-check, checked drawing in the app, commit
