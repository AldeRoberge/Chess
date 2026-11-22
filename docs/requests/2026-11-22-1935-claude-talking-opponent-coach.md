# Talking AI opponent, trivia and "this is known as" coaching
- Agent: Claude
- Time: 2026-11-22 19:35 (UTC)
- Ask: Let the AI chess opponent talk in character alongside the narrators, with trivia-style back-and-forth ("Do you know what a gambit is?"), recognise and highlight openings, tactics and pawn structures ("this is known as a … because …"), and let the player tune the comments from Beginner to Expert. Also merge the three pending performance branches if CI is green.

## Tasks
- [x] Merge the board-rendering, load-time and camera/vision performance branches (checks pass locally; merged on the branch, main push needs approval)
- [x] Recognise openings, tactics (fork, pin, skewer) and structures (isolated, doubled, passed pawns, fianchetto)
- [x] Opponent voice (speaker C) with in-character lines and trivia questions/answers
- [x] Highlight the recognised squares on the board, projector and 3D view
- [x] Commentary level setting (Off, Beginner .. Expert) and "Opponent talks" toggle, saved in the browser
- [x] Tests, type-check, build
