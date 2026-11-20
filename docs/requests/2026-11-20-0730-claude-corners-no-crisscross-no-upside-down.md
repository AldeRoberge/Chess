# Corners: no criss-cross, never upside down
- Agent: Claude
- Time: 2026-11-20 07:30 (local)
- Ask: Corner dragging must never criss-cross the box (it turns the box instead) and the board must never go upside down; the rotate handle also stops short of that.

## Tasks
- [x] src/ui/quadRules.ts: quadValid (clockwise, convex, no sliver), boardTilt/quadUpright (top edge within 110 degrees of "right"), dragCorner (turns instead of crossing), turnWithin
- [x] Editor: corner drag, arrow keys and the rotate handle obey the rules (a broken box can still be mended by hand); turnQuad moved to quadTurn.ts
- [x] Tests, type-check, commit
