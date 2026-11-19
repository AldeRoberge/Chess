import type { GrayFrame, Pt } from "../vision/types";
import { BoardSampler, defaultSamplerConfig } from "../vision/sampler";
import { pieceImage } from "./pieceSets";

/** Maps the board's unit square to picture pixels (u: file a→h, v: rank 8→1). See squareToQuad. */
export type BoardMap = (u: number, v: number) => Pt;

// ---- alignment score -------------------------------------------------------------------------------------------

export interface Alignment {
  /** 0 (grid is nowhere near the squares) .. 1 (every grid line sits on a square edge). */
  q: number;
  /** The light and dark squares are the wrong way round: a1 must be a dark square, so the corners are probably rotated or mirrored. */
  flipped: boolean;
  /** Brightness difference between neighbouring squares, in grey levels. Near 0 means no visible squares. */
  contrast: number;
  /** Median distance of the grid lines from the real edges, in squares (0 = on them). */
  error: number;
}

/** Bilinear brightness at a picture point; outside the picture counts as unreadable (null). */
function luma(f: GrayFrame, p: Pt): number | null {
  if (!(p.x >= 0 && p.y >= 0 && p.x <= f.width - 1 && p.y <= f.height - 1)) return null;
  const x0 = Math.floor(p.x), y0 = Math.floor(p.y), x1 = Math.min(f.width - 1, x0 + 1), y1 = Math.min(f.height - 1, y0 + 1), fx = p.x - x0, fy = p.y - y0, d = f.data, w = f.width;
  return (d[y0 * w + x0] * (1 - fx) + d[y0 * w + x1] * fx) * (1 - fy) + (d[y1 * w + x0] * (1 - fx) + d[y1 * w + x1] * fx) * fy;
}

const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
/** How far (in squares) each way a grid line is searched for the real edge, and the step between tries. */
const REACH = 0.25, STEP = 0.025, HALF = 0.04;
const OFFSETS = Array.from({ length: Math.round((2 * REACH) / STEP) + 1 }, (_, i) => -REACH + i * STEP);
/** Distance in squares at which the score reaches 0: the picture's edge is this far from the grid line. */
const FAR = 0.15;

/**
 * Where is the real edge relative to one grid line? For the 8 stretches of the line (one per square) it reads the
 * brightness step across it at a range of offsets, takes the median over the stretches (pieces cover only a few), and
 * returns the offset where the step peaks. For a lined-up grid that is 0, whatever the blur of the lens.
 */
function lineError(f: GrayFrame, m: BoardMap, alongU: boolean, k: number): number | null {
  const prof: number[] = [], h = HALF / 8;
  for (const s of OFFSETS) {
    const steps: number[] = [];
    for (let j = 0; j < 8; j++) {
      const t = (j + 0.5) / 8, c = k / 8 + s / 8;
      const a = luma(f, alongU ? m(c - h, t) : m(t, c - h)), b = luma(f, alongU ? m(c + h, t) : m(t, c + h));
      if (a !== null && b !== null) steps.push(Math.abs(b - a));
    }
    if (steps.length < 4) return null; // the line leaves the picture
    prof.push(median(steps));
  }
  let best = 0; for (let i = 1; i < prof.length; i++) if (prof[i] > prof[best]) best = i;
  let at = OFFSETS[best];
  if (best > 0 && best < prof.length - 1) { // refine between the samples with a parabola through the peak
    const l = prof[best - 1], c = prof[best], r = prof[best + 1], den = l - 2 * c + r;
    if (den < 0) at += (STEP * 0.5 * (l - r)) / den;
  }
  return Math.abs(at);
}

/**
 * How well the drawn grid sits on the picture's squares, from how far its lines are from the real edges (median over
 * the 14 inner lines). Independent of lens blur and lighting, and robust to pieces. The light/dark order is checked
 * separately: a1 is a dark square, so a grid with the colours the wrong way round is probably rotated or mirrored.
 */
export function scoreAlignment(f: GrayFrame, m: BoardMap): Alignment {
  const errs: number[] = [], polarity: number[] = [];
  for (let k = 1; k < 8; k++) for (const alongU of [true, false]) { const e = lineError(f, m, alongU, k); if (e !== null) errs.push(e); }
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const u = (c + 0.5) / 8, v = (r + 0.5) / 8;
    // neighbours are the other colour; a1 is dark, i.e. file + rank odd, and rank = 8 - r
    const mid = luma(f, m(u, v)), nb = [luma(f, m(u - 1 / 8, v)), luma(f, m(u + 1 / 8, v)), luma(f, m(u, v - 1 / 8)), luma(f, m(u, v + 1 / 8))].filter((x): x is number => x !== null);
    if (mid !== null && nb.length >= 2) polarity.push(((c + 8 - r) % 2 === 1 ? -1 : 1) * (mid - nb.reduce((x, y) => x + y, 0) / nb.length));
  }
  if (errs.length < 10 || polarity.length < 30) return { q: 0, flipped: false, contrast: 0, error: REACH }; // most of the grid is outside the picture
  const error = median(errs), signed = median(polarity), contrast = Math.abs(signed);
  const visible = Math.min(1, Math.max(0, (contrast - 3) / 12)); // a grid that is hardly visible cannot be judged
  const flipped = signed < -1.5 && visible > 0.3;
  const q = visible * Math.min(1, Math.max(0, 1 - error / FAR));
  return { q: flipped ? Math.min(0.45, q) : q, flipped, contrast, error };
}

/** Keeps the readout calm: it follows the score, a little late, so a moving hand does not make it flicker. */
export class AlignmentMeter {
  q = 0; flipped = false; contrast = 0; error = 0; private seeded = false;
  feed(a: Alignment, k = 0.25) { this.q = this.seeded ? this.q + (a.q - this.q) * k : a.q; this.seeded = true; this.flipped = a.flipped; this.contrast = a.contrast; this.error = a.error; return this.q; }
  /** True once the grid sits well on the board. */
  get good() { return this.q >= GOOD && !this.flipped; }
  get label() {
    if (this.flipped) return "Colours look flipped: a1 must be a dark square. Check the corner order (a8, h8, h1, a1).";
    if (this.contrast < 4) return "Can't see the squares yet. Drag the corners onto the board.";
    return this.q >= GOOD ? "Nicely aligned" : this.q >= 0.45 ? "Getting closer. Line the grid up with the square edges." : "Not lined up yet. Drag the corners onto the board.";
  }
}
export const GOOD = 0.7;

/** Orange when the grid is off, green when it fits: hue slides from 28° to 130°. */
export const alignColor = (q: number, light = 54) => `hsl(${Math.round(28 + 102 * Math.min(1, Math.max(0, q)))} 92% ${light}%)`;

// ---- piece icons along the edges --------------------------------------------------------------------------------

export interface EdgeIcon { code: string; u: number; v: number; edge: "top" | "bottom" | "left" | "right"; /** The board square (0 = a8 .. 63 = h1) this icon stands for. */ sq: number }
const BACK = ["r", "n", "b", "q", "k", "b", "n", "r"];
/** How far outside the board's edge the icons sit, in squares. */
const OUT = 0.62;

/**
 * The pieces as they stand at the start, on the four outer edges: the white back rank along a1–h1, the black one along
 * a8–h8, and the rooks and pawns of the a- and h-files down the sides. Line a piece up with its icon and the edge is right.
 */
export function edgeIcons(): EdgeIcon[] {
  const out: EdgeIcon[] = [];
  BACK.forEach((p, f) => { out.push({ code: `b${p}`, u: (f + 0.5) / 8, v: -OUT / 8, edge: "top", sq: f }, { code: `w${p}`, u: (f + 0.5) / 8, v: 1 + OUT / 8, edge: "bottom", sq: 56 + f }); });
  const file = ["br", "bp", "", "", "", "", "wp", "wr"]; // rank 8 down to rank 1
  file.forEach((code, r) => { if (code) out.push({ code, u: -OUT / 8, v: (r + 0.5) / 8, edge: "left", sq: r * 8 }, { code, u: 1 + OUT / 8, v: (r + 0.5) / 8, edge: "right", sq: r * 8 + 7 }); });
  return out;
}

// ---- how sure we are of each piece ------------------------------------------------------------------------------

/** The steps of certainty: 1 sure, 0.5 unsure, 0.2 only a guess from the game state, 0 unknown or impossible. */
export const LEVELS = [1, 0.5, 0.2, 0] as const;
const LEVEL_COLOR: Record<number, string> = { 1: "#35e07a", 0.5: "#e6d83c", 0.2: "#ff9a3c", 0: "#ff4d4d" };

/** Snaps a probability (0..1) to the nearest-below step: >=0.85 sure, >=0.5 unsure, >=0.2 a guess, else nothing. */
export function snapLevel(p: number): number { return p >= 0.85 ? 1 : p >= 0.5 ? 0.5 : p >= 0.2 ? 0.2 : 0; }

/**
 * For each edge icon (same order as edgeIcons()), how sure the camera is that the right piece colour stands on that
 * start square. Reads the picture with the grid as it is now, assuming the start position: when the grid is off the
 * board the answer drops with the alignment, so a perfect fit with the pieces seen under it gives full rings.
 */
export function iconLevels(f: GrayFrame, corners: Pt[], q: number): number[] {
  const s = new BoardSampler("guide", { ...defaultSamplerConfig(), corners });
  s.calibrateFromStart(f);
  const obs = s.read(f), fit = Math.min(1, Math.max(0, q / GOOD));
  return edgeIcons().map((ic) => {
    const white = ic.code[0] === "w", p = obs.occ[ic.sq] * (white ? obs.white[ic.sq] : 1 - obs.white[ic.sq]);
    return snapLevel(Number.isFinite(p) ? p * fit : 0);
  });
}

const GLYPH: Record<string, string> = { wp: "♙", wn: "♘", wb: "♗", wr: "♖", wq: "♕", wk: "♔", bp: "♟", bn: "♞", bb: "♝", br: "♜", bq: "♛", bk: "♚" };

/** Draws the edge icons. `P` maps the unit square to canvas pixels; `ring` is the colour of the badge behind each icon. */
export function drawEdgeIcons(ctx: CanvasRenderingContext2D, P: (u: number, v: number) => Pt, ring: string, levels?: number[]) {
  const a = P(0.5, 0), b = P(0.5 + 1 / 8, 0), c = P(0, 0.5), d = P(0, 0.5 + 1 / 8);
  const size = Math.max(12, Math.min(46, Math.min(Math.hypot(b.x - a.x, b.y - a.y), Math.hypot(d.x - c.x, d.y - c.y)) * 0.78));
  ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
  edgeIcons().forEach((ic, i) => {
    const p = P(ic.u, ic.v), img = pieceImage(ic.code), lv = levels?.[i];
    ctx.fillStyle = "rgba(7,9,13,.62)"; ctx.strokeStyle = lv === undefined ? ring : "rgba(255,255,255,.18)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, size * 0.62, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (lv !== undefined && lv > 0) { // the outline fills up with how sure we are: full circle = sure
      ctx.strokeStyle = LEVEL_COLOR[lv] ?? ring; ctx.lineWidth = 3.5; ctx.lineCap = "round";
      ctx.beginPath(); ctx.arc(p.x, p.y, size * 0.62, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * lv); ctx.stroke();
    }
    if (img) ctx.drawImage(img, p.x - size / 2, p.y - size / 2, size, size);
    else { ctx.fillStyle = ic.code[0] === "w" ? "#fff" : "#9fb4cc"; ctx.font = `${Math.round(size * 0.85)}px serif`; ctx.fillText(GLYPH[ic.code], p.x, p.y + size * 0.04); }
  });
  ctx.restore();
}
