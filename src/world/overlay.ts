import type { TrackResult } from "../chess/tracker";
import type { DirectorOut } from "../experience/director";
import { sqIndex } from "../vision/types";
import { drawChevrons } from "./chevrons";
import { drawClockOverlay, type ClockOverlay } from "./clockOverlay";
import { drawPieceOverlay, type PieceOverlay } from "./pieceOverlay";

export interface OverlayInput {
  game: TrackResult | null;
  director: DirectorOut | null;
  hint: { from: string; to: string } | null;
  /** Both default to shown; the on-screen preview can hide them. */
  lastMove?: boolean; hints?: boolean;
  clock?: ClockOverlay | null;
  /** An outline round the board, and the square the human got wrong while moving the online bot's piece. */
  outline?: boolean; reconcile?: { from: string; to: string; wrong: string } | null;
  /** Pieces projected onto the table (the piece-less game); null when the pieces are physical. */
  pieces?: PieceOverlay | null;
  /** Board effects to paint in light on top (the output page keeps its own engine). */
  fx?: { draw(ctx: CanvasRenderingContext2D, px: number, now: number): void } | null;
  /** Turn the 8×8 around (Black at the bottom). Menu buttons and clocks stay in table space. */
  flip?: boolean;
}

/**
 * What the projector paints onto the physical board/table, drawn in board coordinates
 * (0..8 squares, plus a margin ring for the menu). Sized 1 unit = `px` pixels.
 */
/**
 * `layer` splits the paint so a screen that also draws pieces can put square tints under them.
 * "under" is the fills, "over" is strokes, arrows and menus, "all" is both (the projector).
 */
export function drawTableOverlay(ctx: CanvasRenderingContext2D, px: number, margin: number, o: OverlayInput, t: number, clear = true, layer: "all" | "under" | "over" = "all") {
  if (clear) ctx.clearRect(0, 0, (8 + margin * 2) * px, (8 + margin * 2) * px);
  ctx.save();
  ctx.translate(margin * px, margin * px);
  const under = layer !== "over", over = layer !== "under";
  const at = (i: number) => { const j = o.flip ? 63 - i : i; return { x: (j % 8) * px, y: Math.floor(j / 8) * px }; };
  const sq = (name: string) => at(sqIndex(name));
  const fill = (name: string, c: string) => { const p = sq(name); ctx.fillStyle = c; ctx.fillRect(p.x, p.y, px, px); };

  const g = o.game;
  if (under && g?.last && o.lastMove !== false) { fill(g.last.from, "rgba(80,160,255,.28)"); fill(g.last.to, "rgba(80,160,255,.45)"); }
  if (under && g?.lifted) fill(g.lifted, "rgba(255,190,60,.5)");
  if (over) for (const i of g?.status === "illegal" ? g.diff : []) { const p = at(i); ctx.strokeStyle = `rgba(255,70,90,${0.5 + 0.5 * Math.sin(t * 8)})`; ctx.lineWidth = px * 0.08; ctx.strokeRect(p.x + 3, p.y + 3, px - 6, px - 6); }
  if (o.hint && o.hints !== false) { // engine's move: the human physically plays it for the machine
    const pulse = 0.5 + 0.5 * Math.sin(t * 4);
    if (under) { fill(o.hint.from, `rgba(60,255,160,${0.25 + 0.3 * pulse})`); fill(o.hint.to, `rgba(60,255,160,${0.35 + 0.3 * pulse})`); }
    if (over) {
      const a = sq(o.hint.from), b = sq(o.hint.to);
      drawChevrons(ctx, { x: a.x + px / 2, y: a.y + px / 2 }, { x: b.x + px / 2, y: b.y + px / 2 }, px, t);
    }
  }

  if (o.reconcile) { // the piece went down in the wrong place: mark where it is and where it should have gone
    const pulse = 0.5 + 0.5 * Math.sin(t * 8), w = sq(o.reconcile.wrong);
    if (under) { fill(o.reconcile.wrong, `rgba(255,70,90,${0.3 + 0.3 * pulse})`); fill(o.reconcile.to, `rgba(60,255,160,${0.2 + 0.3 * pulse})`); }
    if (over) { ctx.strokeStyle = "rgba(255,70,90,.95)"; ctx.lineWidth = px * 0.07; ctx.strokeRect(w.x + 3, w.y + 3, px - 6, px - 6); }
  }
  if (over && o.outline) { // frame round the board: calm while all is well, amber when asked to move the bot's piece, red while reconciling
    const col = o.reconcile ? "255,70,90" : o.hint ? "255,190,60" : "90,200,255", glow = 0.55 + 0.25 * Math.sin(t * (o.reconcile ? 8 : 3));
    ctx.save(); ctx.strokeStyle = `rgba(${col},${glow})`; ctx.lineWidth = px * 0.12; ctx.shadowColor = `rgba(${col},.9)`; ctx.shadowBlur = px * 0.3;
    ctx.strokeRect(-px * 0.08, -px * 0.08, px * 8.16, px * 8.16); ctx.restore();
  }

  if (over) o.fx?.draw(ctx, px, t * 1000);

  const d = o.director;
  if (over && d?.phase === "menu") {
    for (const b of d.menu) {
      const x = b.x * px, y = b.y * px, r = b.r * px;
      ctx.fillStyle = "rgba(10,14,28,.78)"; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      ctx.strokeStyle = "rgba(140,170,255,.8)"; ctx.lineWidth = 2; ctx.stroke();
      const p = d.progress[b.id] ?? 0;
      if (p > 0) { // loading spinner ring while the hand hovers
        ctx.strokeStyle = "#4dffb8"; ctx.lineWidth = px * 0.09; ctx.lineCap = "round";
        ctx.beginPath(); ctx.arc(x, y, r * 0.88, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); ctx.stroke();
      }
      ctx.save(); ctx.translate(x, y);
      if (d.seat) ctx.rotate((d.seat.angle * Math.PI) / 180); // readable from the player's side
      ctx.fillStyle = "#fff"; ctx.font = `600 ${px * 0.2}px system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const words = b.label.split(" ");
      words.forEach((w, i) => ctx.fillText(w, 0, (i - (words.length - 1) / 2) * px * 0.26));
      ctx.restore();
    }
  }
  if (over && o.pieces) drawPieceOverlay(ctx, px, o.pieces, t, o.director?.seat?.angle ?? 0);
  if (over && o.clock) drawClockOverlay(ctx, px, o.clock, t);
  ctx.restore();
}
