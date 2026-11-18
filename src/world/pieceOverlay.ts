import { Chess } from "chess.js";
import { pieceImage } from "../ui/pieceSets";
import { sqIndex } from "../vision/types";
import type { DragState } from "../experience/dragdrop";

/** What the projector paints when the game has no physical pieces: the position, and the piece a finger is holding. */
export interface PieceOverlay {
  fen: string;
  drag: DragState | null;
  /** dots on the squares the held piece may go to */
  legalDots: boolean;
  /** a soft shadow under the pieces, and a longer one under the held piece */
  shadow: boolean;
  /** piece size as a fraction of a square */
  scale: number;
  /** turn each piece to face the seated player (otherwise they all stand as white sees them) */
  rotate: boolean;
}

const GLYPH: Record<string, string> = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
let cachedFen = "", cachedBoard: ReturnType<Chess["board"]> = [];
const boardOf = (fen: string) => {
  if (fen !== cachedFen) { try { cachedBoard = new Chess(fen).board(); cachedFen = fen; } catch { cachedBoard = []; } }
  return cachedBoard;
};

/** One piece centred on (cx, cy) in pixels, `size` pixels tall. */
function sprite(ctx: CanvasRenderingContext2D, code: string, cx: number, cy: number, size: number, turn: number) {
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(turn);
  const img = pieceImage(code);
  if (img) ctx.drawImage(img, -size / 2, -size / 2, size, size);
  else {
    const white = code[0] === "w";
    ctx.font = `${size * 0.82}px "Segoe UI Symbol", serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = white ? "#fdfdfd" : "#262421"; ctx.strokeStyle = white ? "#3b3a37" : "#0d0d0d"; ctx.lineWidth = size * 0.05;
    ctx.strokeText(GLYPH[code[1]], 0, size * 0.05); ctx.fillText(GLYPH[code[1]], 0, size * 0.05);
  }
  ctx.restore();
}

/**
 * Paints the pieces onto the table, in board units (board = 0..8, ctx already translated by the margin; `px` pixels per unit).
 * The piece being held leaves its square (a faint ghost stays), grows a little and follows the fingertip.
 */
export function drawPieceOverlay(ctx: CanvasRenderingContext2D, px: number, o: PieceOverlay, t: number, seatAngle = 0) {
  const board = boardOf(o.fen), d = o.drag, size = px * o.scale, turn = o.rotate ? (seatAngle * Math.PI) / 180 : 0;
  ctx.save();
  if (d) { // the way it can go, under everything else
    const from = sqIndex(d.from);
    ctx.fillStyle = "rgba(255,200,60,.28)"; ctx.fillRect((from % 8) * px, Math.floor(from / 8) * px, px, px);
    if (o.legalDots) for (const sq of d.legal) {
      const i = sqIndex(sq), x = (i % 8 + 0.5) * px, y = (Math.floor(i / 8) + 0.5) * px, hit = !!board[Math.floor(i / 8)]?.[i % 8], on = d.hover === sq;
      ctx.fillStyle = on ? "rgba(90,255,170,.4)" : "rgba(90,255,170,.16)"; ctx.fillRect((i % 8) * px, Math.floor(i / 8) * px, px, px);
      ctx.strokeStyle = on ? "rgba(90,255,170,.95)" : "rgba(90,255,170,.7)"; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = px * 0.07;
      ctx.beginPath();
      if (hit) { ctx.arc(x, y, px * 0.46, 0, 7); ctx.stroke(); } else { ctx.arc(x, y, px * (on ? 0.2 : 0.13), 0, 7); ctx.fill(); }
    }
  }
  board.forEach((row, r) => row.forEach((p, c) => {
    if (!p) return;
    const held = d && d.from === "abcdefgh"[c] + (8 - r);
    if (o.shadow && !held) { ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.beginPath(); ctx.ellipse((c + 0.5) * px, (r + 0.82) * px, size * 0.3, size * 0.09, 0, 0, 7); ctx.fill(); }
    ctx.globalAlpha = held ? 0.25 : 1;
    sprite(ctx, p.color + p.type, (c + 0.5) * px, (r + 0.5) * px, size, turn);
  }));
  ctx.globalAlpha = 1;
  if (d) {
    const lift = 0.12 + 0.02 * Math.sin(t * 6), big = size * 1.25;
    if (o.shadow) { ctx.fillStyle = "rgba(0,0,0,.4)"; ctx.beginPath(); ctx.ellipse(d.x * px, (d.y + 0.34) * px, big * 0.3, big * 0.1, 0, 0, 7); ctx.fill(); }
    sprite(ctx, d.color + d.piece, d.x * px, (d.y - lift) * px, big, turn);
  }
  ctx.restore();
}
