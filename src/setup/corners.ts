import { boardSeparation, type Channel } from "./autodetect";
import { boardToImage, applyH } from "../vision/homography";
import type { Pt } from "../vision/types";

/**
 * Finds the four playing-surface corners (a8, h8, h1, a1) in a camera picture.
 * Shape: the checkerboard's repeating light/dark squares, grown out to a quadrilateral and scored the same way
 * channel auto-detect scores a board. OCR: a–h and 1–8 printed on the border, which fixes which corner is which
 * (the squares alone cannot tell a 180° flip). AI: a vision model, used when an OpenAI key is set, and averaged in
 * when it agrees with the measured board.
 */

/** 5×7 ink bitmaps for the letters and ranks printed around a board. "1" is ink. */
export const LABEL_GLYPH: Record<string, string[]> = {
  a: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  b: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  c: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  d: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  e: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  f: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  g: ["01110", "10001", "10000", "10111", "10001", "10001", "01110"],
  h: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
};

const FILES = "abcdefgh";
const RANKS = "87654321";
/** What a correctly named clockwise quad says about each corner. */
const CANON_FILE = ["a", "h", "h", "a"] as const;
const CANON_RANK = ["8", "8", "1", "1"] as const;

export interface ShapeCorners { corners: Pt[]; separation: number; channel: Channel }
export interface LabelOrientation { corners: Pt[]; labels: boolean; notes: string }
export interface CornerDetection { corners: Pt[] | null; detail: string }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function planeOf(img: ImageData, ch: Channel): Float32Array {
  const n = img.width * img.height, o = new Float32Array(n), d = img.data;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    o[p] = ch === "red" ? d[i] : ch === "green" ? d[i + 1] : ch === "blue" ? d[i + 2] : 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  }
  return o;
}

function lumaAt(img: ImageData, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= img.width - 1 || y >= img.height - 1) return -1;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, w = img.width * 4, i = (y0 * img.width + x0) * 4, d = img.data;
  const l = (o: number) => 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];
  return l(i) * (1 - fx) * (1 - fy) + l(i + 4) * fx * (1 - fy) + l(i + w) * (1 - fx) * fy + l(i + w + 4) * fx * fy;
}

/** Screen-clockwise convex quad with some area. Bow-ties and collapsed boards are rejected. */
function convexQuad(c: Pt[], minArea: number): boolean {
  let sign = 0, area = 0;
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4], d = c[(i + 2) % 4];
    const cross = (b.x - a.x) * (d.y - b.y) - (b.y - a.y) * (d.x - b.x);
    if (Math.abs(cross) < 1) return false;
    const s = Math.sign(cross);
    if (sign && s !== sign) return false;
    sign = s;
    area += a.x * b.y - b.x * a.y;
  }
  return sign > 0 && Math.abs(area) / 2 >= minArea;
}

const rotate = (c: Pt[], r: number): Pt[] => [0, 1, 2, 3].map((i) => c[(i + r) % 4]);

function scoreOf(img: ImageData, corners: Pt[], ch: Channel): number {
  if (!convexQuad(corners, 200)) return 0;
  try { return boardSeparation(img, corners, ch); } catch { return 0; }
}

/**
 * Pixels whose neighbourhood repeats like a checkerboard. Width and height are searched separately: a camera
 * flattens a square into a rectangle, and one shared period misses the board. Colour planes are tried when luma
 * shows nothing (an infrared camera often lives in red).
 */
function checkerHits(img: ImageData): { pts: Pt[]; channel: Channel; sx: number; sy: number } | null {
  const { width: W, height: H } = img;
  const run = (ch: Channel) => {
    const lum = planeOf(img, ch), pts: Pt[] = [], seen = new Set<string>();
    let bestN = 0, sx = 28, sy = 28;
    for (let vy = 12; vy <= 56; vy += 4) for (let vx = 12; vx <= 56; vx += 4) {
      if (Math.abs(vx - vy) > 16) continue;
      const step = Math.max(4, Math.min(vx, vy) >> 2);
      let n = 0;
      for (let y = vy; y < H - vy; y += step) for (let x = vx; x < W - vx; x += step) {
        const a = lum[y * W + x];
        const l = lum[y * W + (x - vx)], r = lum[y * W + (x + vx)], u = lum[(y - vy) * W + x], dn = lum[(y + vy) * W + x];
        const diag = lum[(y + vy) * W + (x + vx)];
        const diff = Math.min(Math.abs(a - l), Math.abs(a - r), Math.abs(a - u), Math.abs(a - dn));
        const same = Math.max(Math.abs(a - diag), Math.abs(l - r), Math.abs(u - dn));
        if (diff < 10 || diff - same < 6) continue;
        n++;
        const k = `${Math.round(x / 4)},${Math.round(y / 4)}`;
        if (!seen.has(k)) { seen.add(k); pts.push({ x, y }); }
      }
      if (n > bestN) { bestN = n; sx = vx; sy = vy; }
    }
    return { pts, channel: ch, sx, sy };
  };
  let best = run("luma");
  if (best.pts.length < 60) for (const ch of ["red", "green", "blue"] as const) { const r = run(ch); if (r.pts.length > best.pts.length) best = r; }
  return best.pts.length >= 24 ? best : null;
}

/** Largest blob of hits. Links a few cells apart so a piece sitting on a square does not split the board in two. */
function largestBlob(pts: Pt[]): Pt[] {
  const key = (x: number, y: number) => `${x},${y}`;
  const at = new Map<string, Pt>();
  for (const p of pts) at.set(key(Math.round(p.x / 4), Math.round(p.y / 4)), p);
  const seen = new Set<string>();
  let best: Pt[] = [];
  for (const p of pts) {
    const start = key(Math.round(p.x / 4), Math.round(p.y / 4));
    if (seen.has(start)) continue;
    const comp: Pt[] = [], q = [start];
    seen.add(start);
    while (q.length) {
      const cur = q.pop()!, [cx, cy] = cur.split(",").map(Number), hit = at.get(cur);
      if (hit) comp.push(hit);
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        if (!dx && !dy) continue;
        const nk = key(cx + dx, cy + dy);
        if (at.has(nk) && !seen.has(nk)) { seen.add(nk); q.push(nk); }
      }
    }
    if (comp.length > best.length) best = comp;
  }
  return best;
}

function extremes(pts: Pt[]): Pt[] {
  let tl = pts[0], tr = pts[0], br = pts[0], bl = pts[0];
  for (const p of pts) {
    if (p.x + p.y < tl.x + tl.y) tl = p;
    if (p.x - p.y > tr.x - tr.y) tr = p;
    if (p.x + p.y > br.x + br.y) br = p;
    if (p.x - p.y < bl.x - bl.y) bl = p;
  }
  return [tl, tr, br, bl];
}

/** Slides one edge of a clockwise quad along its outward normal, both corners together. */
function nudgeEdge(q: Pt[], edge: number, dist: number): Pt[] {
  const a = q[edge], b = q[(edge + 1) % 4];
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  const nx = dy / len, ny = -dx / len; // outward for a clockwise quad in image space
  return q.map((p, i) => (i === edge || i === (edge + 1) % 4 ? { x: p.x + nx * dist, y: p.y + ny * dist } : p));
}

/** Light and dark square tones inside the checker hits, and how far a pixel may sit from either and still be the board. */
function squareTones(lum: Float32Array, W: number, H: number, pts: Pt[]): { light: number; dark: number; tol: number } {
  const vals = pts.map((p) => lum[clamp(Math.round(p.y), 0, H - 1) * W + clamp(Math.round(p.x), 0, W - 1)]).sort((a, b) => a - b);
  const dark = vals[Math.floor(vals.length * 0.3)], light = vals[Math.floor(vals.length * 0.7)];
  // Tight enough that the table, even when it sits near the dark squares, does not count as a square.
  return { light, dark, tol: Math.max(12, Math.abs(light - dark) * 0.22) };
}

const isSquare = (v: number, tone: { light: number; dark: number; tol: number }) => Math.min(Math.abs(v - tone.light), Math.abs(v - tone.dark)) <= tone.tol;

/** True when the strip just inside this edge still alternates light and dark. A solid border or the table does not. */
function edgeOnBoard(lum: Float32Array, w: number, h: number, q: Pt[], edge: number, gap: number): boolean {
  const a = q[edge], b = q[(edge + 1) % 4];
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  const nx = dy / len, ny = -dx / len;
  let runs = 0, prev = NaN;
  for (let dist = len * 0.06; dist < len * 0.94; dist += 2) {
    const t = dist / len;
    const x = Math.round(a.x + dx * t - nx * 2), y = Math.round(a.y + dy * t - ny * 2);
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const v = lum[y * w + x];
    if (Number.isNaN(prev) || Math.abs(v - prev) > gap) { runs++; prev = v; }
  }
  return runs >= 4;
}

/** Outermost pixels that match the square tones. For a convex board this is the four corners; a printed border is solid and fails the checker score later. */
function maskCorners(lum: Float32Array, w: number, h: number, blob: Pt[], tone: { light: number; dark: number; tol: number }, pad: number): Pt[] | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of blob) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  const xa = Math.max(0, Math.floor(x0 - pad)), ya = Math.max(0, Math.floor(y0 - pad));
  const xb = Math.min(w - 1, Math.ceil(x1 + pad)), yb = Math.min(h - 1, Math.ceil(y1 + pad));
  const pts: Pt[] = [];
  for (let y = ya; y <= yb; y += 2) for (let x = xa; x <= xb; x += 2) if (isSquare(lum[y * w + x], tone)) pts.push({ x, y });
  return pts.length >= 40 ? extremes(pts) : null;
}

/**
 * Checker hits stop about a square inside the far edges, and any box that still covers most of the squares
 * scores the same. One candidate walks each edge until the squares stop alternating (so a solid printed border
 * is not swallowed). The other takes the outline of every pixel that is a square colour, which follows a
 * perspective trapezoid the hits only partly covered. The one that reads as a board wins.
 */
function fitQuad(img: ImageData, blob: Pt[], sx: number, sy: number, ch: Channel): Pt[] {
  const lum = planeOf(img, ch), tone = squareTones(lum, img.width, img.height, blob);
  const gap = Math.max(10, Math.abs(tone.light - tone.dark) * 0.45);
  const period = Math.max(sx, sy, 12);
  let walked = extremes(blob);
  const span = period * 2;
  for (let pass = 0; pass < 2; pass++) for (let e = 0; e < 4; e++) {
    let best = 0, seen = false, misses = 0;
    for (let d = -Math.round(span); d <= span; d++) {
      if (edgeOnBoard(lum, img.width, img.height, nudgeEdge(walked, e, d), e, gap)) { best = d; seen = true; misses = 0; }
      else if (seen && ++misses > 3) break;
    }
    if (seen) walked = nudgeEdge(walked, e, best);
  }
  const masked = maskCorners(lum, img.width, img.height, blob, tone, period * 6);
  const sw = scoreOf(img, walked, ch), sm = masked ? scoreOf(img, masked, ch) : 0;
  console.log("fit", "walk", sw.toFixed(2), walked.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(" | "), "mask", sm.toFixed(2), masked ? masked.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(" | ") : "none", "tone", Math.round(tone.dark), Math.round(tone.light), "tol", tone.tol.toFixed(1));
  return sm > sw ? masked! : walked;
}

/** a8 and h1 are light squares, h8 and a1 dark. That kills a 90° spin; 180° still looks the same, so rank 1 goes to the bottom of the picture. */
function orientByShade(img: ImageData, corners: Pt[], ch: Channel): Pt[] {
  const sample = (c: Pt[], u: number, v: number) => {
    const [a, b, d, e] = c, w00 = (1 - u) * (1 - v), w10 = u * (1 - v), w11 = u * v, w01 = (1 - u) * v;
    return lumaAt(img, w00 * a.x + w10 * b.x + w11 * d.x + w01 * e.x, w00 * a.y + w10 * b.y + w11 * d.y + w01 * e.y);
  };
  let best = corners, bestScore = -1, bestLow = -1;
  for (let r = 0; r < 4; r++) {
    const c = rotate(corners, r);
    const s = [[0.5, 0.5], [7.5, 0.5], [7.5, 7.5], [0.5, 7.5]].map(([u, v]) => sample(c, u / 8, v / 8));
    let score = 0;
    if (s[0] > s[1]) score++;
    if (s[2] > s[3]) score++;
    if (s[0] > s[3]) score++;
    if (s[2] > s[1]) score++;
    const low = (c[2].y + c[3].y) / 2; // h1 and a1: the side placed at the bottom of the picture
    if (score > bestScore || (score === bestScore && low > bestLow)) { bestScore = score; bestLow = low; best = c; }
  }
  return best;
}

/** The checkerboard quadrilateral, named a8, h8, h1, a1 as far as the squares themselves allow. Null when nothing reads as a board. */
export function detectCornersByShape(img: ImageData): ShapeCorners | null {
  const hits = checkerHits(img);
  if (!hits) { console.log("reject no hits"); return null; }
  const blob = largestBlob(hits.pts);
  if (blob.length < 24) { console.log("reject blob", blob.length, "pts", hits.pts.length); return null; }
  const fitted = fitQuad(img, blob, hits.sx, hits.sy, hits.channel);
  const corners = orientByShade(img, fitted, hits.channel);
  const separation = scoreOf(img, corners, hits.channel);
  if (separation < 0.45) {
    console.log("reject", "hits", hits.pts.length, "blob", blob.length, "sx", hits.sx, "sy", hits.sy, "sep", separation.toFixed(2), "fit", fitted.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(" | "));
    return null;
  }
  return { corners, separation, channel: hits.channel };
}

// ---- printed coordinates ----------------------------------------------------------------------------------------------------

interface CellVote { file?: "a" | "h"; rank?: "8" | "1" }

function inkGrid(px: Float32Array, W: number, H: number, x0: number, x1: number): number[] | null {
  const vals: number[] = [];
  for (let y = 0; y < H; y++) for (let x = x0; x < x1; x++) { const v = px[y * W + x]; if (v >= 0) vals.push(v); }
  if (vals.length < 12) return null;
  vals.sort((a, b) => a - b);
  const lo = vals[Math.floor(vals.length * 0.06)], hi = vals[Math.floor(vals.length * 0.94)];
  if (hi - lo < 35) return null;
  const mid = (lo + hi) / 2, inkDark = vals.filter((v) => v < mid).length <= vals.length * 0.55;
  const on = (x: number, y: number) => { const v = px[y * W + x]; return v >= 0 && (inkDark ? v < mid : v > mid); };
  let xa = x1, xb = x0, ya = H, yb = 0, n = 0;
  for (let y = 0; y < H; y++) for (let x = x0; x < x1; x++) if (on(x, y)) { n++; xa = Math.min(xa, x); xb = Math.max(xb, x); ya = Math.min(ya, y); yb = Math.max(yb, y); }
  if (n < 6 || xb - xa < 1 || yb - ya < 2) return null;
  const grid: number[] = [];
  for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) {
    const gx0 = xa + ((xb - xa + 1) * c) / 5, gx1 = xa + ((xb - xa + 1) * (c + 1)) / 5;
    const gy0 = ya + ((yb - ya + 1) * r) / 7, gy1 = ya + ((yb - ya + 1) * (r + 1)) / 7;
    let s = 0, m = 0;
    for (let y = Math.floor(gy0); y < Math.ceil(gy1); y++) for (let x = Math.floor(gx0); x < Math.ceil(gx1); x++) if (x >= x0 && x < x1 && y >= 0 && y < H) { s += on(x, y) ? 1 : 0; m++; }
    grid.push(m ? s / m : 0);
  }
  return grid;
}

function classifyGrid(grid: number[]): { ch: string; dist: number; gap: number } | null {
  let best = "", bestD = Infinity, second = Infinity;
  for (const [ch, rows] of Object.entries(LABEL_GLYPH)) {
    let d = 0;
    for (let i = 0; i < 35; i++) d += Math.abs(grid[i] - (rows[Math.floor(i / 5)][i % 5] === "1" ? 1 : 0));
    d /= 35;
    if (d < bestD) { second = bestD; bestD = d; best = ch; } else if (d < second) second = d;
  }
  if (bestD > 0.46 || second - bestD < 0.06) return null;
  return { ch: best, dist: bestD, gap: second - bestD };
}

/** One border edge, warped so column 0 touches the edge's start corner. Eight cells, one per square. */
function readEdge(img: ImageData, H: number[], edge: number): (string | null)[] | null {
  const W = 176, Ht = 32, M0 = 0.18, M1 = 0.92, px = new Float32Array(W * Ht);
  try {
    for (let j = 0; j < Ht; j++) for (let i = 0; i < W; i++) {
      const t = (i + 0.5) / W, s = (j + 0.5) / Ht, out = M0 + (M1 - M0) * s;
      let u: number, v: number;
      if (edge === 0) { u = 8 * t; v = -out; }
      else if (edge === 1) { v = 8 * t; u = 8 + out; }
      else if (edge === 2) { u = 8 - 8 * t; v = 8 + out; }
      else { v = 8 - 8 * t; u = -out; }
      const p = applyH(H, u, v);
      px[j * W + i] = lumaAt(img, p.x, p.y);
    }
  } catch { return null; }
  const cw = W / 8, out: (string | null)[] = [];
  for (let i = 0; i < 8; i++) {
    const grid = inkGrid(px, W, Ht, Math.floor(i * cw), Math.floor((i + 1) * cw));
    out.push(grid ? classifyGrid(grid)?.ch ?? null : null);
  }
  return out;
}

function hitsOf(chars: (string | null)[], seq: string): number {
  let n = 0;
  for (let i = 0; i < 8; i++) if (chars[i] === seq[i]) n++;
  return n;
}

/**
 * Re-names a clockwise quad from letters and numbers read just outside its edges.
 * One confident edge is enough to confirm or to turn the quad; with nothing readable the corners come back unchanged.
 */
export function applyBorderLabels(img: ImageData, corners: Pt[]): LabelOrientation {
  let H: number[];
  try { H = boardToImage(corners); } catch { return { corners, labels: false, notes: "no homography" }; }
  const vote: CellVote[] = [{}, {}, {}, {}];
  const notes: string[] = [];
  let conflict = false;
  const set = (i: number, key: "file" | "rank", value: string) => {
    const cur = vote[i][key];
    if (cur && cur !== value) conflict = true;
    else (vote[i] as Record<string, string>)[key] = value;
  };
  for (let e = 0; e < 4; e++) {
    const chars = readEdge(img, H, e);
    if (!chars) continue;
    const opts = [
      { n: hitsOf(chars, FILES), kind: "file" as const, start: "a" },
      { n: hitsOf(chars, [...FILES].reverse().join("")), kind: "file" as const, start: "h" },
      { n: hitsOf(chars, RANKS), kind: "rank" as const, start: "8" },
      { n: hitsOf(chars, [...RANKS].reverse().join("")), kind: "rank" as const, start: "1" },
    ].sort((a, b) => b.n - a.n);
    const top = opts[0];
    if (top.n < 4 || top.n < opts[1].n + 1) continue;
    const j = (e + 1) % 4;
    notes.push(`edge ${e} ${top.kind} from ${top.start} (${top.n})`);
    if (top.kind === "file") {
      set(e, "file", top.start); set(j, "file", top.start === "a" ? "h" : "a");
    } else {
      set(e, "rank", top.start); set(j, "rank", top.start === "8" ? "1" : "8");
    }
  }
  if (conflict || !notes.length) return { corners, labels: false, notes: conflict ? "conflicting labels" : "no labels" };
  let bestR = 0, bestN = -1;
  for (let r = 0; r < 4; r++) {
    let n = 0;
    for (let i = 0; i < 4; i++) {
      const at = (i - r + 4) % 4; // where this corner sits after the quad is rotated by r
      if (vote[i].file && vote[i].file === CANON_FILE[at]) n++;
      if (vote[i].rank && vote[i].rank === CANON_RANK[at]) n++;
    }
    if (n > bestN) { bestN = n; bestR = r; }
  }
  if (bestN < 2) return { corners, labels: false, notes: notes.join("; ") };
  return { corners: rotate(corners, bestR), labels: true, notes: notes.join("; ") };
}

// ---- AI ----------------------------------------------------------------------------------------------------------------------

const VISION_MODEL = "gpt-4.1-mini";

function visionModel(requested?: string): string {
  if (requested && /^(gpt-4\.1(-mini)?|gpt-4o(-mini)?|gpt-5(-mini)?)$/.test(requested)) return requested;
  return VISION_MODEL;
}

function downscale(img: ImageData, maxEdge = 240): { img: ImageData; sx: number; sy: number } {
  const s = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const W = Math.max(1, Math.round(img.width * s)), H = Math.max(1, Math.round(img.height * s));
  if (W === img.width && H === img.height) return { img, sx: 1, sy: 1 };
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const x0 = Math.floor((x * img.width) / W), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * img.width) / W));
    const y0 = Math.floor((y * img.height) / H), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * img.height) / H));
    let r = 0, g = 0, b = 0, n = 0;
    for (let yy = y0; yy < Math.min(img.height, y1); yy++) for (let xx = x0; xx < Math.min(img.width, x1); xx++) {
      const i = (yy * img.width + xx) * 4; r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++;
    }
    const o = (y * W + x) * 4; data[o] = r / n; data[o + 1] = g / n; data[o + 2] = b / n; data[o + 3] = 255;
  }
  return { img: { width: W, height: H, data } as ImageData, sx: img.width / W, sy: img.height / H };
}

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length), v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  out[4] = type.charCodeAt(0); out[5] = type.charCodeAt(1); out[6] = type.charCodeAt(2); out[7] = type.charCodeAt(3);
  out.set(data, 8);
  const crcBuf = out.subarray(4, 8 + data.length);
  v.setUint32(8 + data.length, crc32(crcBuf));
  return out;
}

/** RGB PNG, stored (uncompressed) deflate, so a picture can be handed to the vision model without a canvas. */
export function pngBase64(img: ImageData): string {
  const { width: W, height: H, data } = img, raw = new Uint8Array(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    const row = y * (1 + W * 3);
    for (let x = 0; x < W; x++) { const s = (y * W + x) * 4, d = row + 1 + x * 3; raw[d] = data[s]; raw[d + 1] = data[s + 1]; raw[d + 2] = data[s + 2]; }
  }
  const blocks: Uint8Array[] = [];
  for (let i = 0; i < raw.length || i === 0; i += 65535) {
    const n = Math.min(65535, raw.length - i), last = i + n >= raw.length, b = new Uint8Array(5 + Math.max(0, n));
    b[0] = last ? 1 : 0; b[1] = n & 255; b[2] = (n >> 8) & 255; const nl = (~n) & 0xffff; b[3] = nl & 255; b[4] = (nl >> 8) & 255;
    if (n > 0) b.set(raw.subarray(i, i + n), 5);
    blocks.push(b);
    if (raw.length === 0) break;
  }
  let a = 1, bsum = 0;
  for (let i = 0; i < raw.length; i++) { a = (a + raw[i]) % 65521; bsum = (bsum + a) % 65521; }
  const ad = new Uint8Array(4); new DataView(ad.buffer).setUint32(0, ((bsum << 16) | a) >>> 0);
  const zlen = 2 + blocks.reduce((s, p) => s + p.length, 0) + 4, z = new Uint8Array(zlen);
  z[0] = 0x78; z[1] = 0x01; let o = 2; for (const p of blocks) { z.set(p, o); o += p.length; } z.set(ad, o);
  const ihdr = new Uint8Array(13), hv = new DataView(ihdr.buffer);
  hv.setUint32(0, W); hv.setUint32(4, H); ihdr[8] = 8; ihdr[9] = 2;
  const sig = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", z), pngChunk("IEND", new Uint8Array(0))];
  const bytes = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0; for (const p of parts) { bytes.set(p, at); at += p.length; }
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function parseAiCorners(text: string, sx: number, sy: number): Pt[] | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j: unknown;
  try { j = JSON.parse(m[0]); } catch { return null; }
  const arr = (j as { corners?: unknown }).corners;
  if (!Array.isArray(arr) || arr.length < 4) return null;
  const named: Record<string, Pt> = {}, pts: Pt[] = [];
  for (const raw of arr.slice(0, 8)) {
    const p = raw as { x?: unknown; y?: unknown; name?: unknown };
    const x = Number(p?.x), y = Number(p?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const pt = { x: x * sx, y: y * sy };
    pts.push(pt);
    if (typeof p?.name === "string") named[p.name.toLowerCase()] = pt;
  }
  const order = ["a8", "h8", "h1", "a1"].map((n) => named[n]);
  return order.every(Boolean) ? (order as Pt[]) : pts.slice(0, 4);
}

/** Asks a vision model for a8, h8, h1, a1 in the picture's own pixels. Null when the reply is missing or not a real quad. */
export async function detectCornersByAi(img: ImageData, apiKey: string, model?: string, doFetch: typeof fetch = fetch): Promise<Pt[] | null> {
  const small = downscale(img), ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await doFetch("https://api.openai.com/v1/chat/completions", {
      method: "POST", signal: ctl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey.trim()}` },
      body: JSON.stringify({
        model: visionModel(model), temperature: 0, max_tokens: 220, response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You locate chessboard corners in a photograph. Reply with JSON only." },
          { role: "user", content: [
            { type: "text", text: `Image size ${small.img.width}×${small.img.height}. Origin is the top-left pixel, x grows right, y grows down. Return the four corners of the playing surface (the 64 squares, not the border), ordered a8, h8, h1, a1. a8 is the light corner square on black's left. Trust printed a–h and 1–8 labels when you can see them. JSON: {"corners":[{"name":"a8","x":0,"y":0},{"name":"h8","x":0,"y":0},{"name":"h1","x":0,"y":0},{"name":"a1","x":0,"y":0}]}` },
            { type: "image_url", image_url: { url: `data:image/png;base64,${pngBase64(small.img)}` } },
          ] },
        ],
      }),
    });
    if (!r.ok) throw new Error(`OpenAI ${r.status}`);
    const text = (await r.json())?.choices?.[0]?.message?.content ?? "";
    const pts = parseAiCorners(text, small.sx, small.sy);
    if (!pts || !convexQuad(pts, img.width * img.height * 0.02)) return null;
    return pts;
  } finally { clearTimeout(timer); }
}

function meanDist(a: Pt[], b: Pt[]): number {
  let s = 0; for (let i = 0; i < 4; i++) s += Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y); return s / 4;
}

/** Best renaming of `other` onto `ref`, including the reversed winding. */
function alignTo(ref: Pt[], other: Pt[]): { pts: Pt[]; dist: number } {
  let pts = other, dist = Infinity;
  const windings = [other, [other[0], other[3], other[2], other[1]]];
  for (const w of windings) for (let r = 0; r < 4; r++) {
    const rot = rotate(w, r), d = meanDist(ref, rot);
    if (d < dist) { dist = d; pts = rot; }
  }
  return { pts, dist };
}

const joinAnd = (xs: string[]) => xs.length <= 1 ? xs[0] ?? "" : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

export interface DetectOptions { apiKey?: string; model?: string; doFetch?: typeof fetch }

/**
 * Shape, then the printed coordinates, then AI when a key is set. The measured board wins a disagreement;
 * when AI lands on the same corners the two are averaged.
 */
export async function detectBoardCorners(img: ImageData, opt: DetectOptions = {}): Promise<CornerDetection> {
  const shape = detectCornersByShape(img);
  let corners = shape?.corners ?? null;
  let labels = false;
  if (corners) {
    const named = applyBorderLabels(img, corners);
    corners = named.corners; labels = named.labels;
  }
  const key = opt.apiKey?.trim() ?? "";
  let ai: Pt[] | null = null, aiFailed = false;
  if (key) {
    try { ai = await detectCornersByAi(img, key, opt.model, opt.doFetch); }
    catch { aiFailed = true; }
  }
  const ch = shape?.channel ?? "luma";
  if (corners && ai) {
    const aligned = alignTo(corners, ai);
    const shapeS = scoreOf(img, corners, ch), aiS = scoreOf(img, aligned.pts, ch);
    const agree = aligned.dist <= 15;
    // a label-confirmed board is not handed over to a far-away guess; a weak unlabeled one can be
    const preferAi = !agree && !labels && aiS > shapeS + 0.3;
    if (agree) corners = corners.map((p, i) => ({ x: (p.x + aligned.pts[i].x) / 2, y: (p.y + aligned.pts[i].y) / 2 }));
    else if (preferAi) corners = orientByShade(img, aligned.pts, ch);
    const how = [preferAi ? "" : "the checkerboard shape", !preferAi && labels ? "the printed coordinates" : "", agree || preferAi ? "AI" : ""].filter(Boolean);
    let detail = `Corners set from ${joinAnd(how)}.`;
    if (agree) detail += " AI agreed.";
    else if (!preferAi) detail += " AI saw a different board, so the measured corners were kept.";
    if (!labels) detail += " Rank 1 is at the bottom of the picture; drag a handle if white sits at the top.";
    return { corners, detail };
  }
  if (corners) {
    const how = ["the checkerboard shape", labels ? "the printed coordinates" : ""].filter(Boolean);
    let detail = `Corners set from ${joinAnd(how)}.`;
    if (!labels) detail += " Rank 1 is at the bottom of the picture; drag a handle if white sits at the top.";
    if (aiFailed) detail += " AI could not be reached.";
    return { corners, detail };
  }
  if (ai) {
    const named = orientByShade(img, ai, "luma");
    return { corners: named, detail: "Corners set by AI. The checkerboard in the picture was not clear enough to measure on its own." };
  }
  const extra = aiFailed ? " AI could not be reached." : key ? "" : "";
  return { corners: null, detail: `Corners not found. Show the whole board; printed a–h and 1–8 labels help${key ? "" : ", and an OpenAI key on the AI step lets AI look as well"}.${extra}` };
}
