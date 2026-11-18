import type { TrackResult } from "../chess/tracker";
import type { DirectorOut } from "../experience/director";
import { sqIndex } from "../vision/types";
import { drawClockOverlay, type ClockOverlay } from "./clockOverlay";

export interface OverlayInput {
  game: TrackResult | null;
  director: DirectorOut | null;
  hint: { from: string; to: string } | null;
  /** Both default to shown; the on-screen preview can hide them. */
  lastMove?: boolean; hints?: boolean;
  clock?: ClockOverlay | null;
  /** Board effects to paint in light on top (the output page keeps its own engine). */
  fx?: { draw(ctx: CanvasRenderingContext2D, px: number, now: number): void } | null;
}

/**
 * What the projector paints onto the physical board/table, drawn in board coordinates
 * (0..8 squares, plus a margin ring for the menu). Sized 1 unit = `px` pixels.
 */
export function drawTableOverlay(ctx: CanvasRenderingContext2D, px: number, margin: number, o: OverlayInput, t: number, clear = true) {
  if (clear) ctx.clearRect(0, 0, (8 + margin * 2) * px, (8 + margin * 2) * px);
  ctx.save();
  ctx.translate(margin * px, margin * px);
  const sq = (name: string) => { const i = sqIndex(name); return { x: (i % 8) * px, y: Math.floor(i / 8) * px }; };
  const fill = (name: string, c: string) => { const p = sq(name); ctx.fillStyle = c; ctx.fillRect(p.x, p.y, px, px); };

  const g = o.game;
  if (g?.last && o.lastMove !== false) { fill(g.last.from, "rgba(80,160,255,.28)"); fill(g.last.to, "rgba(80,160,255,.45)"); }
  if (g?.lifted) fill(g.lifted, "rgba(255,190,60,.5)");
  for (const i of g?.status === "illegal" ? g.diff : []) { const x = (i % 8) * px, y = Math.floor(i / 8) * px; ctx.strokeStyle = `rgba(255,70,90,${0.5 + 0.5 * Math.sin(t * 8)})`; ctx.lineWidth = px * 0.08; ctx.strokeRect(x + 3, y + 3, px - 6, px - 6); }
  if (o.hint && o.hints !== false) { // engine's move: the human physically plays it for the machine
    const pulse = 0.5 + 0.5 * Math.sin(t * 4);
    fill(o.hint.from, `rgba(60,255,160,${0.25 + 0.3 * pulse})`); fill(o.hint.to, `rgba(60,255,160,${0.35 + 0.3 * pulse})`);
    const a = sq(o.hint.from), b = sq(o.hint.to);
    ctx.strokeStyle = "rgba(60,255,160,.8)"; ctx.lineWidth = px * 0.09; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(a.x + px / 2, a.y + px / 2); ctx.lineTo(b.x + px / 2, b.y + px / 2); ctx.stroke();
  }

  o.fx?.draw(ctx, px, t * 1000);

  const d = o.director;
  if (d?.phase === "menu") {
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
  if (o.clock) drawClockOverlay(ctx, px, o.clock, t);
  ctx.restore();
}
