import { BoardSampler, defaultSamplerConfig } from "../vision/sampler";
import type { GrayFrame, Pt } from "../vision/types";
import { sqName } from "../vision/types";
import { pieceImage } from "./pieceSets";

/** One piece the camera can see, and the starting square it should slide to. */
export interface PieceMove { from: number; to: number; code: string }

const BACK = ["r", "n", "b", "q", "k", "b", "n", "r"];

/** The piece that stands on `sq` at the start, or "" for an empty square. `sq` 0 is a8. */
export function startCode(sq: number): string {
  const row = Math.floor(sq / 8), file = sq % 8;
  if (row === 0) return "b" + BACK[file];
  if (row === 1) return "bp";
  if (row === 6) return "wp";
  if (row === 7) return "w" + BACK[file];
  return "";
}

const OCC = 0.62, SURE = 0.62;
const dist = (a: number, b: number) => Math.max(Math.abs(a % 8 - b % 8), Math.abs(Math.floor(a / 8) - Math.floor(b / 8)));

/**
 * Where the visible pieces should go to reach the starting position.
 * Empty when every piece already stands on a starting square (a wrong colour there is a corner-order problem, not a placement one).
 * Null when too few or too many squares look occupied to trust the reading.
 */
export function movesFromReading(occ: ArrayLike<number>, white: ArrayLike<number>): PieceMove[] | null {
  const seen: number[] = [];
  for (let sq = 0; sq < 64; sq++) if (occ[sq] >= OCC) seen.push(sq);
  if (!seen.length || seen.length > 40) return null;
  const off = seen.filter((sq) => !startCode(sq));
  if (!off.length) return [];
  const colorOf = (sq: number): boolean | null => white[sq] >= SURE ? true : white[sq] <= 1 - SURE ? false : null;
  const homes: { sq: number; white: boolean; code: string }[] = [];
  for (let sq = 0; sq < 64; sq++) {
    const code = startCode(sq);
    if (!code) continue;
    const wantWhite = code[0] === "w", col = colorOf(sq);
    const taken = occ[sq] >= OCC && (col === null || col === wantWhite);
    if (!taken) homes.push({ sq, white: wantWhite, code });
  }
  const cands: { from: number; hi: number; d: number; colorMatch: number }[] = [];
  for (const from of off) {
    const col = colorOf(from);
    homes.forEach((h, hi) => {
      const colorMatch = col === null ? 1 : col === h.white ? 2 : 0;
      if (colorMatch) cands.push({ from, hi, d: dist(from, h.sq), colorMatch });
    });
  }
  cands.sort((a, b) => b.colorMatch - a.colorMatch || a.d - b.d || a.from - b.from);
  const usedF = new Set<number>(), usedH = new Set<number>(), moves: PieceMove[] = [];
  for (const c of cands) {
    if (usedF.has(c.from) || usedH.has(c.hi)) continue;
    usedF.add(c.from); usedH.add(c.hi);
    const h = homes[c.hi];
    moves.push({ from: c.from, to: h.sq, code: h.code });
  }
  return moves.length ? moves : null;
}

/** Reads the picture under the grid and returns the same moves. Null when the picture is too unsure. */
export function placementMoves(f: GrayFrame, corners: Pt[]): PieceMove[] | null {
  if (corners.length !== 4) return null;
  const s = new BoardSampler("coach", { ...defaultSamplerConfig(), corners });
  s.calibrateFromStart(f);
  const obs = s.read(f);
  if (obs.quality < 0.35) return null;
  return movesFromReading(obs.occ, obs.white);
}

export const COACH_LABEL = "These pieces are off their starting squares. Move each one to the square named at the end of its line.";

const GLYPH: Record<string, string> = { wp: "♙", wn: "♘", wb: "♗", wr: "♖", wq: "♕", wk: "♔", bp: "♟", bn: "♞", bb: "♝", br: "♜", bq: "♛", bk: "♚" };

/**
 * Draws each move as a piece gliding from where it stands to its starting square, with that square's name at the end.
 * `P` maps the unit board (u: file a→h, v: rank 8→1) to canvas pixels.
 */
export function drawPlacementMoves(ctx: CanvasRenderingContext2D, P: (u: number, v: number) => Pt, moves: PieceMove[], now: number) {
  if (!moves.length) return;
  const period = 1700;
  const anchor = P(0.5, 0.5), step = P(0.5 + 1 / 8, 0.5);
  const size = Math.max(14, Math.min(42, Math.hypot(step.x - anchor.x, step.y - anchor.y) * 0.72));
  ctx.save();
  ctx.lineCap = "round"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  moves.forEach((mv, i) => {
    const phase = ((now + i * 90) % period) / period;
    const glide = phase < 0.72 ? phase / 0.72 : 1;
    const e = glide * glide * (3 - 2 * glide);
    const fade = phase < 0.72 ? 1 : 1 - (phase - 0.72) / 0.28;
    const u0 = (mv.from % 8 + 0.5) / 8, v0 = (Math.floor(mv.from / 8) + 0.5) / 8;
    const u1 = (mv.to % 8 + 0.5) / 8, v1 = (Math.floor(mv.to / 8) + 0.5) / 8;
    const a = P(u0, v0), b = P(u1, v1);
    const x = a.x + (b.x - a.x) * e, y = a.y + (b.y - a.y) * e;
    ctx.globalAlpha = 0.9 * fade;
    ctx.strokeStyle = "rgba(255, 196, 64, 0.95)"; ctx.lineWidth = 2;
    ctx.setLineDash?.([5, 4]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.setLineDash?.([]);
    ctx.fillStyle = "rgba(8, 12, 18, 0.55)";
    ctx.beginPath(); ctx.arc(b.x, b.y, size * 0.28, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffe7a3";
    ctx.font = `700 ${Math.max(10, Math.round(size * 0.36))}px "IBM Plex Mono", ui-monospace, monospace`;
    ctx.fillText(sqName(mv.to), b.x, b.y + 0.5);
    const img = pieceImage(mv.code);
    ctx.globalAlpha = fade;
    if (img) ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
    else {
      ctx.fillStyle = mv.code[0] === "w" ? "#f4f7fb" : "#1a1e27";
      ctx.strokeStyle = mv.code[0] === "w" ? "#1a1e27" : "#f4f7fb"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, size * 0.38, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = mv.code[0] === "w" ? "#1a1e27" : "#f4f7fb";
      ctx.font = `${Math.round(size * 0.72)}px serif`;
      ctx.fillText(GLYPH[mv.code] ?? "●", x, y + size * 0.04);
    }
  });
  ctx.restore();
}
