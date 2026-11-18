import { applyH, solveHomography } from "./homography";
import type { GrayFrame, Pt } from "./types";

/** What a reader saw on one display. `ms` is null when nothing plausible was read; `conf` is 0..1; `sigmaMs` is the display's own resolution. */
export interface ClockRead { ms: number | null; conf: number; sigmaMs: number; text: string }
export type ClockKind = "lcd" | "phone" | "analog";
const none = (sigmaMs = 500): ClockRead => ({ ms: null, conf: 0, sigmaMs, text: "" });
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Luma of the quad (tl,tr,br,bl) resampled to w x h (bilinear). */
export function warp(frame: GrayFrame, quad: Pt[], w: number, h: number): Float32Array {
  const H = solveHomography([{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], quad);
  const out = new Float32Array(w * h), { width: fw, height: fh, data } = frame;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = applyH(H, x + 0.5, y + 0.5), px = Math.min(fw - 1.001, Math.max(0, p.x - 0.5)), py = Math.min(fh - 1.001, Math.max(0, p.y - 0.5));
    const x0 = Math.floor(px), y0 = Math.floor(py), fx = px - x0, fy = py - y0, i = y0 * fw + x0;
    out[y * w + x] = data[i] * (1 - fx) * (1 - fy) + data[i + 1] * fx * (1 - fy) + data[i + fw] * (1 - fx) * fy + data[i + fw + 1] * fx * fy;
  }
  return out;
}

/** Foreground-ness 0..1 per pixel: the minority tone is the ink, whichever polarity the display uses. Null when there is no contrast. */
function ink(px: Float32Array): { f: Float32Array; contrast: number } | null {
  const s = Array.from(px).sort((a, b) => a - b), lo = s[Math.floor(s.length * 0.01)], hi = s[Math.floor(s.length * 0.99)], span = hi - lo;
  if (span < 28) return null;
  const mid = (lo + hi) / 2, bright = px.reduce((n, v) => n + (v > mid ? 1 : 0), 0) / px.length < 0.5;
  const f = new Float32Array(px.length);
  for (let i = 0; i < px.length; i++) { const v = clamp01((px[i] - lo) / span); f[i] = bright ? v : 1 - v; }
  return { f, contrast: clamp01(span / 120) };
}

// ---- digit classifiers -------------------------------------------------------------------------------------------------------

/** a b c d e f g */
const SEG: Record<number, string> = { 0: "1111110", 1: "0110000", 2: "1101101", 3: "1111001", 4: "0110011", 5: "1011011", 6: "1011111", 7: "1110000", 8: "1111111", 9: "1111011" };
const SEG_BOX: [number, number, number, number][] = [[0.2, 0, 0.8, 0.14], [0.78, 0.1, 1, 0.48], [0.78, 0.52, 1, 0.9], [0.2, 0.86, 0.8, 1], [0, 0.52, 0.22, 0.9], [0, 0.1, 0.22, 0.48], [0.2, 0.43, 0.8, 0.57]];

const GLYPH5x7: Record<number, string[]> = {
  0: ["01110", "10001", "10011", "10101", "11001", "10001", "01110"], 1: ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  2: ["01110", "10001", "00001", "00010", "00100", "01000", "11111"], 3: ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  4: ["00010", "00110", "01010", "10010", "11111", "00010", "00010"], 5: ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  6: ["00110", "01000", "10000", "11110", "10001", "10001", "01110"], 7: ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  8: ["01110", "10001", "10001", "01110", "10001", "10001", "01110"], 9: ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
};
export const glyph5x7 = (d: number) => GLYPH5x7[d];

interface Cell { x0: number; x1: number }
type Classify = (f: Float32Array, W: number, cell: Cell, y0: number, y1: number, runW: number, cellW: number) => { digit: number; conf: number };

/** Mean ink of a box given in pixel coordinates. */
function boxInk(f: Float32Array, W: number, x0: number, y0: number, x1: number, y1: number) {
  const xa = Math.max(0, Math.floor(x0)), xb = Math.max(xa + 1, Math.ceil(x1)), ya = Math.floor(y0), yb = Math.max(ya + 1, Math.ceil(y1));
  let s = 0, n = 0;
  for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) { s += f[y * W + x] ?? 0; n++; }
  return n ? s / n : 0;
}

/** Nearest pattern + how far ahead of the runner-up it is. */
function best(dist: number[]): { digit: number; conf: number } {
  let b = 0, second = Infinity;
  for (let d = 1; d < dist.length; d++) if (dist[d] < dist[b]) b = d;
  for (let d = 0; d < dist.length; d++) if (d !== b) second = Math.min(second, dist[d]);
  return { digit: b, conf: clamp01((second - dist[b]) / 1.0) * clamp01(1 - dist[b] / 1.8) };
}

const classifySeg: Classify = (f, W, cell, y0, y1, _runW, cellW) => {
  const H = y1 - y0 + 1, w = cellW, x0 = cell.x1 + 1 - w; // every digit lights a right-hand segment, so the run's right edge is the cell's right edge
  const on = SEG_BOX.map(([a, b, c, d]) => Math.min(1, boxInk(f, W, x0 + a * w, y0 + b * H, x0 + c * w, y0 + d * H) / 0.65)); // a lit segment reads ~0.7 once edges blur
  return best(Array.from({ length: 10 }, (_, d) => on.reduce((s, v, i) => s + Math.abs(v - Number(SEG[d][i])), 0)));
};

const classifyGlyph: Classify = (f, W, cell, y0, y1, _runW, cellW) => {
  const H = y1 - y0 + 1, cw = cellW, mid = (cell.x0 + cell.x1) / 2, x0 = mid - cw / 2;
  const grid: number[] = [];
  for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) grid.push(Math.min(1, boxInk(f, W, x0 + (c * cw) / 5, y0 + (r * H) / 7, x0 + ((c + 1) * cw) / 5, y0 + ((r + 1) * H) / 7) / 0.7));
  return best(Array.from({ length: 10 }, (_, d) => grid.reduce((s, v, i) => s + Math.abs(v - Number(GLYPH5x7[d][Math.floor(i / 5)][i % 5])), 0) / 3));
};

/** Digits left to right from a warped display; colons are noted by position in the digit sequence. */
function readText(px: Float32Array, W: number, H: number, classify: Classify): { digits: { d: number; conf: number }[]; colons: number[]; contrast: number } | null {
  const k = ink(px); if (!k) return null;
  const { f, contrast } = k;
  let y0 = -1, y1 = -1;
  for (let y = 0; y < H; y++) { let s = 0; for (let x = 0; x < W; x++) s += f[y * W + x] > 0.5 ? 1 : 0; if (s >= 2) { if (y0 < 0) y0 = y; y1 = y; } }
  if (y0 < 0 || y1 - y0 + 1 < 0.25 * H) return null;
  const Hd = y1 - y0 + 1, occ: boolean[] = [];
  for (let x = 0; x < W; x++) { let on = false; for (let y = y0; y <= y1 && !on; y++) on = f[y * W + x] > 0.5; occ.push(on); }
  const runs: Cell[] = [];
  for (let x = 0; x < W; x++) if (occ[x]) { let e = x; while (e + 1 < W && occ[e + 1]) e++; runs.push({ x0: x, x1: e }); x = e; }
  const digits: { d: number; conf: number }[] = [], colons: number[] = [];
  const wide = runs.map((r) => r.x1 - r.x0 + 1).filter((w) => w >= 0.3 * Hd), cellW = Math.min(0.9 * Hd, Math.max(0.4 * Hd, wide.length ? Math.max(...wide) : 0.55 * Hd)); // digit width as the widest glyph shows it
  for (const r of runs) {
    const w = r.x1 - r.x0 + 1;
    let top = y1, bot = y0;
    for (let y = y0; y <= y1; y++) for (let x = r.x0; x <= r.x1; x++) if (f[y * W + x] > 0.5) { top = Math.min(top, y); bot = Math.max(bot, y); }
    if (w < 0.3 * Hd && bot - top + 1 < 0.72 * Hd) { colons.push(digits.length); continue; } // two dots: short and thin
    if (w < 0.08 * Hd) continue; // speck
    const c = classify(f, W, r, y0, y1, w, cellW);
    digits.push({ d: c.digit, conf: c.conf });
  }
  return { digits, colons, contrast };
}

function toTime(r: ReturnType<typeof readText>, sigmaMs: number): ClockRead {
  if (!r || r.digits.length < 3 || r.digits.length > 6) return none(sigmaMs);
  const ds = r.digits.map((x) => x.d), n = ds.length, num = (a: number[]) => a.reduce((s, v) => s * 10 + v, 0);
  const secs = num(ds.slice(-2)), mins = num(ds.slice(-4, -2)), hrs = n > 4 ? num(ds.slice(0, n - 4)) : 0;
  if (secs > 59 || mins > 59 || hrs > 9) return none(sigmaMs);
  const cs = r.digits.map((x) => Math.sqrt(x.conf)), conf = (0.5 * Math.min(...cs) + 0.5 * (cs.reduce((a, b) => a + b, 0) / cs.length)) * (0.4 + 0.6 * r.contrast); // the weakest digit matters most
  const text = `${hrs ? hrs + ":" : ""}${String(mins).padStart(hrs ? 2 : 1, "0")}:${String(secs).padStart(2, "0")}`;
  return { ms: ((hrs * 60 + mins) * 60 + secs) * 1000, conf: clamp01(conf), sigmaMs, text };
}

/** Seven-segment LCD / LED display (DGT-style): `quad` = tl,tr,br,bl around the whole time readout, e.g. "12:34". */
export function readLcd(frame: GrayFrame, quad: Pt[]): ClockRead {
  const W = 160, H = 48;
  return toTime(readText(warp(frame, quad, W, H), W, H, classifySeg), 500);
}

/** Large on-screen digits of a phone / tablet clock app. */
export function readPhone(frame: GrayFrame, quad: Pt[]): ClockRead {
  const W = 192, H = 64;
  return toTime(readText(warp(frame, quad, W, H), W, H, classifyGlyph), 500);
}

/**
 * Analog dial. `quad` frames the whole dial face. The time left is the distance from the hands to the flag position, which is
 * 12 o'clock unless `flagHour` says otherwise. Hands give about a minute of resolution, so the reading is coarse but never wild.
 */
export function readDial(frame: GrayFrame, quad: Pt[], flagHour = 12): ClockRead {
  const N = 72, px = warp(frame, quad, N, N), k = ink(px);
  if (!k) return none(30000);
  const { f, contrast } = k, c = (N - 1) / 2, reach: number[] = [], step = 2;
  for (let a = 0; a < 360; a += step) { // reach of ink running outward from the hub along each ray
    const rad = (a * Math.PI) / 180, dx = Math.sin(rad), dy = -Math.cos(rad);
    let r = 0.06 * N, last = 0;
    for (; r < 0.46 * N; r += 0.5) { const x = c + dx * r, y = c + dy * r; if (f[Math.round(y) * N + Math.round(x)] > 0.5) last = r; else if (r - last > 0.06 * N) break; }
    reach.push(last / N);
  }
  const smooth = reach.map((_, i) => Math.max(reach[i], reach[(i + 1) % reach.length] * 0.97, reach[(i + reach.length - 1) % reach.length] * 0.97));
  let mi = 0; smooth.forEach((v, i) => { if (v > smooth[mi]) mi = i; });
  const minuteReach = smooth[mi];
  if (minuteReach < 0.25) return none(30000);
  // hand direction = centroid of the ray cluster that is nearly as long as the best one
  const cluster = (idx: number, ok: (i: number) => boolean) => { let sx = 0, sy = 0, n = 0; for (let j = -8; j <= 8; j++) { const i = (idx + j + smooth.length) % smooth.length; if (ok(i)) { const a = (i * step * Math.PI) / 180; sx += Math.sin(a) * smooth[i]; sy += -Math.cos(a) * smooth[i]; n++; } } return n ? (Math.atan2(sx, -sy) * 180) / Math.PI : mi * step; };
  const mAngle = (cluster(mi, (i) => smooth[i] > minuteReach * 0.8) + 360) % 360;
  const away = (i: number) => Math.min(Math.abs(i * step - mAngle), 360 - Math.abs(i * step - mAngle)) > 24;
  let hi = -1; smooth.forEach((v, i) => { if (away(i) && (hi < 0 || v > smooth[hi])) hi = i; });
  const hourReach = hi >= 0 ? smooth[hi] : 0;
  if (hourReach < 0.15 || hourReach > minuteReach * 0.92) return none(30000);
  const hAngle = (cluster(hi, (i) => away(i) && smooth[i] > hourReach * 0.8) + 360) % 360;
  const minutes = mAngle / 6, hourFrac = hAngle / 30, hours = Math.round(hourFrac - minutes / 60);
  const shown = (((hours % 12) * 60 + minutes) + 720) % 720; // minutes since 12:00 on the dial
  const flag = (flagHour % 12) * 60, left = (((flag - shown) % 720) + 720) % 720;
  // the hour hand must agree with the minute hand: it sits where the minute hand says it should
  const expected = ((hours % 12) * 30 + minutes / 2 + 360) % 360, off = Math.min(Math.abs(expected - hAngle), 360 - Math.abs(expected - hAngle));
  const conf = clamp01(contrast * 0.8 + 0.2) * clamp01(1 - off / 25) * clamp01((minuteReach - 0.2) / 0.15) * 0.85;
  const total = Math.round(left * 60000);
  return { ms: total, conf, sigmaMs: 30000, text: `${Math.floor(left)}:${String(Math.floor((left % 1) * 60)).padStart(2, "0")}` };
}

/** Camera type unknown: try each reader and keep the most certain plausible one. The dial is held to a higher bar since it can see hands in noise. */
export function readAuto(frame: GrayFrame, quad: Pt[], flagHour = 12): ClockRead {
  let best = none();
  for (const k of ["lcd", "phone", "analog"] as ClockKind[]) {
    const r = readClock(k, frame, quad, flagHour);
    if (r.ms !== null && r.conf >= (k === "analog" ? 0.5 : 0.3) && r.conf > best.conf) best = r;
  }
  return best;
}

export function readClock(kind: ClockKind | "auto", frame: GrayFrame, quad: Pt[], flagHour = 12): ClockRead {
  try { if (kind === "auto") return readAuto(frame, quad, flagHour); return kind === "lcd" ? readLcd(frame, quad) : kind === "phone" ? readPhone(frame, quad) : readDial(frame, quad, flagHour); }
  catch { return none(); } // degenerate quad
}
