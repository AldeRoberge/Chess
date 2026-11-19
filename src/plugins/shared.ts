import { boardTheme } from "../ui/boardThemes";
import { pieceImage } from "../ui/pieceSets";
import { RIGS, rigCorners } from "../sim/rigs";
import type { BoardBelief, GrayFrame, Pt } from "../vision/types";

export const CAM_PRESETS: Record<string, Pt[]> = Object.fromEntries(Object.entries(RIGS).map(([k, r]) => [k, rigCorners(r)]));

export const parseCorners = (s: string): Pt[] | null => {
  const pts = s.split(";").map((p) => p.split(",").map(Number));
  return pts.length === 4 && pts.every((p) => p.length === 2 && p.every(Number.isFinite)) ? pts.map(([x, y]) => ({ x, y })) : null;
};
export const fmtCorners = (c: Pt[]) => c.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(";");

/** Plain grey copy of a frame, built once per frame object and shared by every preview that shows it (camera + reader previews, 15x/s). */
const frameCache = new WeakMap<GrayFrame, HTMLCanvasElement>();
let scratch: ImageData | null = null;
function frameCanvas(f: GrayFrame): HTMLCanvasElement {
  let c = frameCache.get(f);
  if (c) return c;
  if (!scratch || scratch.width !== f.width || scratch.height !== f.height) scratch = new ImageData(f.width, f.height);
  const d = new Uint32Array(scratch.data.buffer); // one 32-bit write per pixel (little-endian ABGR)
  for (let i = 0; i < f.data.length; i++) { const v = f.data[i]; d[i] = 0xff000000 | (v << 16) | (v << 8) | v; } // R = G = B: neutral grey
  c = document.createElement("canvas"); c.width = f.width; c.height = f.height;
  c.getContext("2d")!.putImageData(scratch, 0, 0);
  frameCache.set(f, c);
  return c;
}

/** Where a fw×fh image lands inside a w×h box: uniform scale `s`, centred (letterboxed), so it never stretches. */
export interface FitRect { x: number; y: number; s: number }
export function fitRect(fw: number, fh: number, w: number, h: number): FitRect {
  const s = Math.min(w / fw, h / fh);
  return { x: (w - fw * s) / 2, y: (h - fh * s) / 2, s };
}

/** Draws the frame uniformly scaled and centred in the box; returns the placed rect so overlays can map onto it. */
export function drawFrame(ctx: CanvasRenderingContext2D, w: number, h: number, f: GrayFrame | null | undefined, off = "offline"): FitRect | null {
  ctx.fillStyle = "#07090d"; ctx.fillRect(0, 0, w, h);
  if (!f) { ctx.fillStyle = "#566"; ctx.font = "12px system-ui"; ctx.fillText(off, 8, h / 2); return null; }
  const r = fitRect(f.width, f.height, w, h);
  ctx.drawImage(frameCanvas(f), r.x, r.y, f.width * r.s, f.height * r.s);
  return r;
}

const GLYPH: Record<string, string> = { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚" };
export function fenPieces(fen: string | undefined): (string | null)[] {
  const out: (string | null)[] = [];
  for (const ch of (fen ?? "").split(" ")[0]) { if (ch === "/") continue; if (ch >= "1" && ch <= "8") for (let k = 0; k < +ch; k++) out.push(null); else out.push(ch); }
  return out.length === 64 ? out : [];
}

const START_BOARD = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
const START_PIECES = fenPieces(START_BOARD);
/** Red → amber → green for a 0..1 confidence. */
export const confColor = (c: number, a = 1) => `hsla(${Math.round(Math.max(0, Math.min(1, c)) * 125)},85%,55%,${a})`;

/**
 * Does the reading look like a game that has just begun (both back ranks and pawn rows full, right colours, middle empty)?
 * Used when no tracked position exists yet, so the pieces can be assumed to stand where they start.
 */
export function looksLikeStart(b: { occ: ArrayLike<number>; white: ArrayLike<number> } | null | undefined): boolean {
  if (!b) return false;
  let ok = 0;
  for (let i = 0; i < 64; i++) {
    const pc = START_PIECES[i], seen = b.occ[i] > 0.5;
    if (!pc) ok += seen ? 0 : 1; else if (seen && (b.white[i] > 0.5) === (pc === pc.toUpperCase())) ok++;
  }
  return ok >= 56; // at most 8 of 64 squares disagree
}

/** Per-square read-out used by drawBoard (exported so tests and tooltips can share the numbers). */
export interface SquareRead { piece: string | null; seen: boolean; score: number; prior: boolean }
export function readSquares(b: { occ: ArrayLike<number>; white: ArrayLike<number>; conf?: ArrayLike<number> } | null | undefined, fen?: string): { reads: SquareRead[]; start: boolean } {
  let pcs = fenPieces(fen);
  const fenBoard = (fen ?? "").split(" ")[0];
  // a just-started game: the tracked position is still the start position, or nothing is tracked yet and the cameras see one
  const start = fenBoard === START_BOARD || (pcs.length === 0 && looksLikeStart(b));
  if (!pcs.length && start) pcs = START_PIECES;
  const reads: SquareRead[] = [];
  for (let i = 0; i < 64; i++) {
    const piece = pcs[i] ?? null;
    if (!b) { reads.push({ piece, seen: !!piece, score: 1, prior: false }); continue; }
    const conf = b.conf?.[i] ?? 1, occ = b.occ[i], seen = occ > 0.5;
    const white = b.white[i];
    // how likely is it that the square really holds what we show (this piece, this colour, or nothing)?
    let agree = piece ? occ : 1 - occ;
    if (piece && seen) agree = Math.min(agree, piece === piece.toUpperCase() ? white : 1 - white);
    if (!piece && seen) agree = Math.min(agree, 0.5 + Math.abs(white - 0.5)); // unidentified piece: only occupancy/colour certainty
    let score = Math.min(conf, Math.max(agree, 0));
    // the start position is a strong prior: a square that agrees with it needs far less evidence
    const prior = start && agree > 0.5;
    if (prior) score = 1 - (1 - score) * 0.3;
    reads.push({ piece, seen, score: Math.max(0, Math.min(1, score)), prior });
  }
  return { reads, start };
}

/**
 * Board preview: themed squares; on each, the piece (from `fen`, or the start position when a game has just begun) with a
 * confidence ring around it and the square's 0..100 confidence in the corner. Pieces seen but not identified show as "?".
 * Pieces expected but not seen are ghosted with a dashed red ring.
 */
export function drawBoard(ctx: CanvasRenderingContext2D, w: number, h: number, b: { occ: ArrayLike<number>; white: ArrayLike<number>; conf?: ArrayLike<number> } | null | undefined, opts: { diff?: number[]; lifted?: string; fen?: string } = {}) {
  const th = boardTheme();
  ctx.fillStyle = th.surround; ctx.fillRect(0, 0, w, h);
  const s = Math.min(w, h) / 8;
  const ox = (w - s * 8) / 2;
  const { reads, start } = readSquares(b, opts.fen);
  const labels = !!b && s >= 20;
  for (let i = 0; i < 64; i++) {
    const x = ox + (i % 8) * s, y = Math.floor(i / 8) * s, cx = x + s / 2, cy = y + s / 2;
    ctx.fillStyle = ((i % 8) + Math.floor(i / 8)) % 2 ? th.dark : th.light;
    ctx.fillRect(x, y, s, s);
    const r = reads[i], pc = r.piece;
    if (b) { ctx.fillStyle = confColor(r.score, 0.1 + 0.18 * (1 - r.score)); ctx.fillRect(x, y, s, s); } // low-confidence squares glow red
    const shown = !!pc && (r.seen || !b), ghost = !!pc && !shown, disc = !pc && r.seen;
    if (shown || ghost) {
      const white = pc === pc!.toUpperCase(), ps = s * 0.78;
      ctx.globalAlpha = ghost ? 0.22 : 0.55 + 0.45 * r.score;
      const img = pieceImage((white ? "w" : "b") + pc!.toLowerCase());
      if (img) ctx.drawImage(img, cx - ps / 2, cy - ps / 2, ps, ps);
      else {
        ctx.font = `${s * 0.7}px "Segoe UI Symbol", serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillStyle = white ? "#fdfdfd" : "#262421"; ctx.strokeStyle = white ? "#3b3a37" : "#0d0d0d"; ctx.lineWidth = white ? 1.4 : 0.8;
        const g = GLYPH[pc!.toLowerCase()]; ctx.strokeText(g, cx, cy + s * 0.04); ctx.fillText(g, cx, cy + s * 0.04);
      }
      ctx.globalAlpha = 1;
    } else if (disc) {
      const white = b!.white[i] > 0.5;
      ctx.globalAlpha = 0.55 + 0.45 * r.score;
      ctx.fillStyle = white ? "#fdfdfd" : "#262421"; ctx.strokeStyle = white ? "#3b3a37" : "#0d0d0d";
      ctx.beginPath(); ctx.arc(cx, cy, s * 0.26, 0, 7); ctx.fill(); ctx.stroke();
      if (s >= 14) { ctx.fillStyle = white ? "#262421" : "#fdfdfd"; ctx.font = `600 ${s * 0.3}px system-ui,sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("?", cx, cy + s * 0.02); }
      ctx.globalAlpha = 1;
    }
    // confidence ring: a dim full circle, with a coloured arc sweeping clockwise from the top in proportion to the score
    if (b && (shown || ghost || disc)) {
      const rad = s * 0.43; ctx.lineWidth = Math.max(1.5, s * 0.07); ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(0,0,0,.35)"; ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.stroke();
      if (ghost) { ctx.setLineDash([s * 0.12, s * 0.1]); ctx.strokeStyle = "rgba(255,90,110,.9)"; ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
      else { ctx.strokeStyle = confColor(r.score); ctx.beginPath(); ctx.arc(cx, cy, rad, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.02, r.score)); ctx.stroke(); }
      ctx.lineCap = "butt";
    }
    if (labels) { // the number itself, 0..100, in the corner (empty squares dimmer)
      const empty = !(shown || ghost || disc);
      ctx.font = `600 ${Math.max(8, s * 0.2)}px "IBM Plex Mono",ui-monospace,monospace`; ctx.textAlign = "right"; ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillText(String(Math.round(r.score * 100)), x + s - 2 + 1, y + s - 3 + 1);
      ctx.globalAlpha = empty ? 0.6 : 1; ctx.fillStyle = confColor(r.score); ctx.fillText(String(Math.round(r.score * 100)), x + s - 2, y + s - 3); ctx.globalAlpha = 1;
    } else if (b && !(shown || ghost || disc) && r.score < 0.5) { ctx.fillStyle = "rgba(255,170,60,.45)"; ctx.fillRect(x + s * 0.35, y + s * 0.35, s * 0.3, s * 0.3); }
  }
  ctx.strokeStyle = "#ff5a6e"; ctx.lineWidth = 2;
  for (const i of opts.diff ?? []) ctx.strokeRect(ox + (i % 8) * s + 1, Math.floor(i / 8) * s + 1, s - 2, s - 2);
  if (b && start) { ctx.font = `600 ${Math.max(9, s * 0.24)}px system-ui,sans-serif`; ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillRect(ox, 0, Math.min(s * 4.2, w), Math.max(11, s * 0.34)); ctx.fillStyle = "#9be7c4"; ctx.fillText("start position assumed", ox + 3, 1); }
  ctx.lineWidth = 1;
}

export type { BoardBelief };

export type DetailRow = [label: string, value: string, color?: string];
/** Compact one-line text for any value (used by the detail panels). */
export function brief(v: unknown, max = 120): string {
  if (v == null) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(3);
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (ArrayBuffer.isView(v)) return `${(v as any).constructor.name}[${(v as any).length}]`;
  if (Array.isArray(v)) return v.length ? `[${v.length}] ${brief(v[v.length - 1], max)}` : "[0]";
  try { const s = JSON.stringify(v, (_k, x) => (ArrayBuffer.isView(x) ? `${(x as any).constructor.name}[${(x as any).length}]` : x)); return s.length > max ? s.slice(0, max) + "…" : s; } catch { return String(v); }
}
export const objRows = (o: Record<string, unknown> | null | undefined): DetailRow[] => Object.entries(o ?? {}).map(([k, v]) => [k, brief(v)]);

/** Label / value rows filling a rectangle; rows that do not fit are dropped, long values are cut. */
export function drawRows(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rows: DetailRow[]) {
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.font = `500 12px "Chakra Petch",system-ui,sans-serif`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  const lh = 15, fit = Math.max(0, Math.floor((h - 6) / lh)), lab = Math.min(110, w * 0.38);
  rows.slice(0, fit).forEach(([l, v, c], i) => {
    const yy = y + 4 + 11 + i * lh;
    ctx.fillStyle = "#6f7f9f"; ctx.fillText(l, x + 6, yy);
    ctx.fillStyle = c ?? "#d5def2";
    let t = v; while (t.length > 1 && ctx.measureText(t).width > w - lab - 12) t = t.slice(0, -2);
    ctx.fillText(t === v ? t : t + "…", x + 6 + lab, yy);
  });
  ctx.restore();
}

/**
 * Preview that grows into more information instead of just zooming: at about its default size the visual fills the
 * canvas; once the node is expanded the visual keeps a sensible size and the extra space lists live details.
 */
export function detailLayout(w: number, h: number, base: [number, number]): { vw: number; vh: number; side: boolean } | null {
  const [bw, bh] = base, aspect = bw / bh;
  if (Math.min(w / bw, h / bh) <= 1.5) return null;
  const side = w / h >= aspect * 1.3;
  const vw = side ? Math.min(w - 170, h * aspect) : w, vh = side ? h : Math.min(h - 90, w / aspect);
  return vw < 80 || vh < 60 ? null : { vw, vh, side };
}

export function withDetail(ctx: CanvasRenderingContext2D, w: number, h: number, base: [number, number], paint: (w: number, h: number) => void, rows: () => DetailRow[]) {
  const L = detailLayout(w, h, base);
  if (!L) return paint(w, h);
  const { vw, vh, side } = L;
  ctx.fillStyle = "#07090d"; ctx.fillRect(0, 0, w, h);
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, vw, vh); ctx.clip(); paint(vw, vh); ctx.restore();
  if (side) drawRows(ctx, vw, 0, w - vw, h, rows()); else drawRows(ctx, 0, vh, w, h - vh, rows());
}
