import type { GrayFrame, Pt } from "../vision/types";
import { BoardSampler, defaultSamplerConfig } from "../vision/sampler";
import { pieceImage } from "./pieceSets";
import { squareToQuad } from "./quadMap";

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
  /** 0 (the squares just outside the grid are not board) .. 1 (the checker pattern carries on past the grid: it is too small or shifted). */
  outside: number;
  /** Like `error`, but over all 18 lines including the board's own outer edges, and a mean that ignores the worst few: it feels every corner. For the auto-aligner. */
  fine: number;
  /** How much the edge offset changes along a grid line, in squares per square. 0 means the line is only shifted, not tilted. The middle of the board counts more. */
  warp: number;
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
/** Signed edge-offset against position along the line. Squares per square; 0 when every stretch is shifted by the same amount. */
function offsetSlope(samples: { j: number; off: number; w: number }[]): number {
  if (samples.length < 4) return 0;
  let sw = 0, sj = 0, so = 0;
  for (const s of samples) { sw += s.w; sj += s.w * s.j; so += s.w * s.off; }
  const mj = sj / sw, mo = so / sw;
  let sjj = 0, sjo = 0;
  for (const s of samples) { const dj = s.j - mj; sjj += s.w * dj * dj; sjo += s.w * dj * (s.off - mo); }
  return sjj < 1e-6 ? 0 : sjo / sjj;
}

function lineError(f: GrayFrame, m: BoardMap, alongU: boolean, k: number): { at: number; per: number[]; slope: number; slopeN: number } | null {
  const prof: number[] = [], h = HALF / 8, grid: number[][] = []; // grid[offset][stretch], NaN where unreadable
  for (const s of OFFSETS) {
    const steps: number[] = [], row: number[] = [];
    for (let j = 0; j < 8; j++) {
      const t = (j + 0.5) / 8, c = k / 8 + s / 8;
      const a = luma(f, alongU ? m(c - h, t) : m(t, c - h)), b = luma(f, alongU ? m(c + h, t) : m(t, c + h));
      if (a !== null && b !== null) { steps.push(Math.abs(b - a)); row.push(Math.abs(b - a)); } else row.push(NaN);
    }
    if (steps.length < 4) return null; // the line leaves the picture
    prof.push(median(steps)); grid.push(row);
  }
  let best = 0; for (let i = 1; i < prof.length; i++) if (prof[i] > prof[best]) best = i;
  let at = OFFSETS[best];
  if (best > 0 && best < prof.length - 1) { // refine between the samples with a parabola through the peak
    const l = prof[best - 1], c = prof[best], r = prof[best + 1], den = l - 2 * c + r;
    if (den < 0) at += (STEP * 0.5 * (l - r)) / den;
  }
  // where each stretch's own edge is: the median above hides a corner that is off, this does not.
  // The slope of those offsets is the tilt the median also hides: a line can be centred in the middle and still be rotated off the squares.
  const per: number[] = [], samples: { j: number; off: number; w: number }[] = [];
  for (let j = 0; j < 8; j++) {
    let bi = -1; for (let i = 0; i < grid.length; i++) if (Number.isFinite(grid[i][j]) && (bi < 0 || grid[i][j] > grid[bi][j])) bi = i;
    if (bi < 0 || !(grid[bi][j] > 4)) continue;
    let off = OFFSETS[bi];
    if (bi > 0 && bi < grid.length - 1) {
      const l = grid[bi - 1][j], c = grid[bi][j], r = grid[bi + 1][j], den = l - 2 * c + r;
      if (Number.isFinite(l) && Number.isFinite(r) && den < 0) off += (STEP * 0.5 * (l - r)) / den;
    }
    per.push(Math.abs(off));
    samples.push({ j, off, w: j >= 2 && j <= 5 ? 3 : 1 }); // the middle four stretches are the empty squares
  }
  return { at: Math.abs(at), per, slope: offsetSlope(samples), slopeN: samples.length };
}

/** 1 at the centre of the board, about 0.25 at the outer edge. The empty middle is the clean black and white signal. */
function centreWeight(t: number): number {
  const d = Math.min(1, Math.abs(t - 0.5) * 2);
  return 1 - 0.75 * d * d;
}

/**
 * How well the drawn grid sits on the picture's squares, from how far its lines are from the real edges (median over
 * the 14 inner lines). Independent of lens blur and lighting, and robust to pieces. The light/dark order is checked
 * separately: a1 is a dark square, so a grid with the colours the wrong way round is probably rotated or mirrored.
 */
export function scoreAlignment(f: GrayFrame, m: BoardMap): Alignment {
  const errs: number[] = [], polarity: number[] = [], perAll: number[] = [], slopes: number[] = [], slopeW: number[] = [];
  const take = (k: number, alongU: boolean, into: number[]) => {
    const e = lineError(f, m, alongU, k);
    if (!e) return;
    into.push(e.at); perAll.push(...e.per);
    if (e.slopeN >= 4) { slopes.push(Math.abs(e.slope)); slopeW.push(centreWeight(k / 8)); }
  };
  for (let k = 1; k < 8; k++) for (const alongU of [true, false]) take(k, alongU, errs);
  const outer: number[] = [];
  for (const k of [0, 8]) for (const alongU of [true, false]) take(k, alongU, outer);
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const u = (c + 0.5) / 8, v = (r + 0.5) / 8;
    // neighbours are the other colour; a1 is dark, i.e. file + rank odd, and rank = 8 - r
    const mid = luma(f, m(u, v)), nb = [luma(f, m(u - 1 / 8, v)), luma(f, m(u + 1 / 8, v)), luma(f, m(u, v - 1 / 8)), luma(f, m(u, v + 1 / 8))].filter((x): x is number => x !== null);
    if (mid !== null && nb.length >= 2) polarity.push(((c + 8 - r) % 2 === 1 ? -1 : 1) * (mid - nb.reduce((x, y) => x + y, 0) / nb.length));
  }
  const slopeSum = slopeW.reduce((a, b) => a + b, 0);
  const warp = slopeSum > 0 ? slopes.reduce((s, v, i) => s + v * slopeW[i], 0) / slopeSum : 0;
  if (errs.length < 10 || polarity.length < 30) return { q: 0, flipped: false, contrast: 0, error: REACH, outside: 0, fine: REACH, warp: 0 }; // most of the grid is outside the picture
  const all = perAll.length >= 20 ? perAll.sort((a, b) => a - b) : [...errs, ...outer].sort((a, b) => a - b), kept = all.slice(0, Math.max(4, Math.ceil(all.length * 0.75))), fine = kept.reduce((a, b) => a + b, 0) / kept.length;
  const error = median(errs), signed = median(polarity), contrast = Math.abs(signed);
  // Does the checker pattern carry on just outside the grid? Then the grid sits inside the board (smaller or shifted) and the interior lines alone cannot tell.
  const side = (cells: [number, number][]) => {
    const v: number[] = [];
    for (const [c, r] of cells) {
      const mid = luma(f, m((c + 0.5) / 8, (r + 0.5) / 8)), nb = [luma(f, m((c - 0.5) / 8, (r + 0.5) / 8)), luma(f, m((c + 1.5) / 8, (r + 0.5) / 8)), luma(f, m((c + 0.5) / 8, (r - 0.5) / 8)), luma(f, m((c + 0.5) / 8, (r + 1.5) / 8))].filter((x): x is number => x !== null);
      if (mid !== null && nb.length >= 2) v.push((((c + 8 - r) % 2 + 2) % 2 === 1 ? -1 : 1) * (mid - nb.reduce((x, y) => x + y, 0) / nb.length));
    }
    return v.length >= 4 ? median(v) : 0;
  };
  const idx = Array.from({ length: 8 }, (_, i) => i);
  const sides = [idx.map((i): [number, number] => [i, -1]), idx.map((i): [number, number] => [i, 8]), idx.map((i): [number, number] => [-1, i]), idx.map((i): [number, number] => [8, i])];
  const outside = contrast < 3 ? 0 : Math.max(...sides.map((cells) => Math.min(1, Math.max(0, (side(cells) / contrast * Math.sign(signed || 1) - 0.35) / 0.4))));
  const visible = Math.min(1, Math.max(0, (contrast - 3) / 12)); // a grid that is hardly visible cannot be judged
  const flipped = signed < -1.5 && visible > 0.3;
  // A line can sit on the squares in the middle and still be tilted. The tilt counts, or the meter stays green while the corners are off.
  const lined = Math.max(error, Math.min(REACH, warp * 0.4));
  const q = visible * Math.min(1, Math.max(0, 1 - lined / FAR)) * (1 - outside);
  return { q: flipped ? Math.min(0.45, q) : q, flipped, contrast, error, outside, fine, warp };
}

// ---- traced square lines, the perspective guide ---------------------------------------------------------------

/** One grid line as seen in the picture: ax + by + c = 0, with a² + b² = 1. `k` is the line's index, 0..8. */
export interface TracedLine { alongU: boolean; k: number; a: number; b: number; c: number; w: number }
/** Straight edges traced from the squares. The empty middle weighs more than the rims, where pieces sit. */
export interface GridGuide { lines: TracedLine[] }

const GUIDE_REACH = 0.42, GUIDE_STEP = 0.02;
const GUIDE_OFFSETS = Array.from({ length: Math.round((2 * GUIDE_REACH) / GUIDE_STEP) + 1 }, (_, i) => Math.round((-GUIDE_REACH + i * GUIDE_STEP) * 1000) / 1000);
const ALONG: number[] = [];
for (let j = 0; j < 8; j++) ALONG.push((j + 0.32) / 8, (j + 0.68) / 8);

/**
 * Where the real square edge is, near one sample of a grid line. The search stays inside half a square, so a line
 * that has already wandered onto the next square is left for the brightness score instead of being trusted here.
 */
function tracePoint(f: GrayFrame, m: BoardMap, alongU: boolean, k: number, along: number): { x: number; y: number; w: number; off: number; along: number } | null {
  const half = 0.08 / 8, prof: number[] = [];
  let best = -1, bestV = 0;
  for (let i = 0; i < GUIDE_OFFSETS.length; i++) {
    const c = k / 8 + GUIDE_OFFSETS[i] / 8;
    const a = luma(f, alongU ? m(c - half, along) : m(along, c - half)), b = luma(f, alongU ? m(c + half, along) : m(along, c + half));
    const v = a === null || b === null ? 0 : Math.abs(b - a);
    prof.push(v);
    if (v > bestV) { bestV = v; best = i; }
  }
  if (best <= 0 || best >= GUIDE_OFFSETS.length - 1 || bestV < 12) return null;
  for (let i = 0; i < GUIDE_OFFSETS.length; i++) if (Math.abs(GUIDE_OFFSETS[i] - GUIDE_OFFSETS[best]) > 0.16 && prof[i] > bestV * 0.85) return null;
  let off = GUIDE_OFFSETS[best];
  const l = prof[best - 1], mid = prof[best], r = prof[best + 1], den = l - 2 * mid + r;
  if (den < 0) off += (GUIDE_STEP * 0.5 * (l - r)) / den;
  if (Math.abs(off) > GUIDE_REACH) return null;
  const u = alongU ? k / 8 + off / 8 : along, v = alongU ? along : k / 8 + off / 8, p = m(u, v);
  return { x: p.x, y: p.y, off, along, w: centreWeight(k / 8) * centreWeight(along) };
}

function fitLine(pts: { x: number; y: number; w: number }[]): { a: number; b: number; c: number; rms: number } | null {
  let sw = 0, sx = 0, sy = 0;
  for (const p of pts) { sw += p.w; sx += p.w * p.x; sy += p.w * p.y; }
  if (!(sw > 0)) return null;
  const mx = sx / sw, my = sy / sw;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) { const dx = p.x - mx, dy = p.y - my; sxx += p.w * dx * dx; syy += p.w * dy * dy; sxy += p.w * dx * dy; }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), dx = Math.cos(ang), dy = Math.sin(ang), a = -dy, b = dx, c = -(a * mx + b * my);
  let ss = 0;
  for (const p of pts) { const d = a * p.x + b * p.y + c; ss += p.w * d * d; }
  return { a, b, c, rms: Math.sqrt(ss / sw) };
}

function traceLines(f: GrayFrame, m: BoardMap, sq: number): GridGuide | null {
  if (!(sq > 1)) return null;
  const lines: TracedLine[] = [];
  for (const alongU of [true, false]) for (let k = 0; k <= 8; k++) {
    const raw: { x: number; y: number; w: number; off: number; along: number }[] = [];
    for (const along of ALONG) { const p = tracePoint(f, m, alongU, k, along); if (p && p.w > 0.02) raw.push(p); }
    const offs = raw.map((p) => p.off).sort((a, b) => a - b);
    // a line whose edge sits near the far side of the search found the next square, not this one
    if (offs.length < 5 || Math.abs(offs[offs.length >> 1]) > 0.34) continue;
    let fit = fitLine(raw);
    if (!fit) continue;
    const kept = raw.filter((p) => Math.abs(fit!.a * p.x + fit!.b * p.y + fit!.c) <= Math.max(1.25, sq * 0.12));
    // at least two hits in the middle half of the line: the rims are where the pieces are
    const centreHits = kept.filter((p) => p.along > 0.2 && p.along < 0.8).length;
    if (kept.length < 4 || centreHits < 2) continue;
    fit = fitLine(kept);
    if (!fit || fit.rms > sq * 0.1) continue;
    const w = kept.reduce((s, p) => s + p.w, 0);
    lines.push({ alongU, k, a: fit.a, b: fit.b, c: fit.c, w });
  }
  const files = lines.filter((l) => l.alongU), ranks = lines.filter((l) => !l.alongU);
  if (files.length < 3 || ranks.length < 3) return null;
  return { lines };
}

function intersect(p: TracedLine, q: TracedLine): Pt | null {
  const det = p.a * q.b - q.a * p.b;
  if (Math.abs(det) < 1e-8) return null;
  return { x: (-p.c * q.b + p.b * q.c) / det, y: (-p.a * q.c + p.c * q.a) / det };
}

function quadArea(q: Pt[]): number {
  return Math.abs(q.reduce((s, p, i) => { const n = q[(i + 1) % 4]; return s + p.x * n.y - n.x * p.y; }, 0)) / 2;
}
function sideLen(c: Pt[]): number {
  let s = 0; for (let i = 0; i < 4; i++) s += Math.hypot(c[(i + 1) % 4].x - c[i].x, c[(i + 1) % 4].y - c[i].y); return s / 4;
}
function convexQuad(c: Pt[]): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4], d = c[(i + 2) % 4], cr = (b.x - a.x) * (d.y - b.y) - (b.y - a.y) * (d.x - b.x);
    if (Math.abs(cr) < 1e-3) return false;
    const s = Math.sign(cr); if (sign && s !== sign) return false; sign = s;
  }
  return true;
}

function normOf(pts: { x: number; y: number; w: number }[]): { cx: number; cy: number; s: number } | null {
  let sw = 0, sx = 0, sy = 0;
  for (const p of pts) { sw += p.w; sx += p.w * p.x; sy += p.w * p.y; }
  if (!(sw > 0)) return null;
  const cx = sx / sw, cy = sy / sw;
  let sd = 0; for (const p of pts) sd += p.w * Math.hypot(p.x - cx, p.y - cy);
  const mean = sd / sw;
  if (!(mean > 1e-4)) return null;
  return { cx, cy, s: Math.SQRT2 / mean };
}

function solveLinear(A: Float64Array[], b: Float64Array): Float64Array | null {
  const n = b.length, M = A.map((row, i) => { const r = new Float64Array(n + 1); r.set(row); r[n] = b[i]; return r; });
  for (let col = 0; col < n; col++) {
    let piv = col, best = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r++) { const v = Math.abs(M[r][col]); if (v > best) { best = v; piv = r; } }
    if (best < 1e-12) return null;
    if (piv !== col) { const t = M[col]; M[col] = M[piv]; M[piv] = t; }
    const div = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= div;
    for (let r = 0; r < n; r++) if (r !== col) {
      const f = M[r][col]; if (!f) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  const h = new Float64Array(n); for (let i = 0; i < n; i++) h[i] = M[i][n]; return h;
}

/**
 * The four corners implied by the traced lines. Interior crossings (mostly the empty middle) fix the perspective,
 * and the corners are that same perspective extended out to the edge of the board.
 */
function cornersFromGuide(g: GridGuide, from: Pt[], sq: number): Pt[] | null {
  const files = g.lines.filter((l) => l.alongU), ranks = g.lines.filter((l) => !l.alongU);
  const span = (ls: TracedLine[]) => Math.max(...ls.map((l) => l.k)) - Math.min(...ls.map((l) => l.k));
  const seesMiddle = (ls: TracedLine[]) => ls.some((l) => l.k >= 3 && l.k <= 5);
  if (span(files) < 3 || span(ranks) < 3 || !seesMiddle(files) || !seesMiddle(ranks)) return null;
  const pts: { u: number; v: number; x: number; y: number; w: number }[] = [];
  for (const file of files) for (const rank of ranks) {
    const hit = intersect(file, rank); if (!hit) continue;
    pts.push({ u: file.k / 8, v: rank.k / 8, x: hit.x, y: hit.y, w: file.w * rank.w });
  }
  if (pts.length < 8) return null;
  const bu = normOf(pts.map((p) => ({ x: p.u, y: p.v, w: p.w }))), bi = normOf(pts.map((p) => ({ x: p.x, y: p.y, w: p.w })));
  if (!bu || !bi) return null;
  const n = 8, AtA = Array.from({ length: n }, () => new Float64Array(n)), Atb = new Float64Array(n);
  const add = (row: number[], rhs: number, w: number) => {
    for (let i = 0; i < n; i++) { Atb[i] += w * row[i] * rhs; for (let j = 0; j < n; j++) AtA[i][j] += w * row[i] * row[j]; }
  };
  for (const p of pts) {
    const u = (p.u - bu.cx) * bu.s, v = (p.v - bu.cy) * bu.s, x = (p.x - bi.cx) * bi.s, y = (p.y - bi.cy) * bi.s;
    add([u, v, 1, 0, 0, 0, -x * u, -x * v], x, p.w);
    add([0, 0, 0, u, v, 1, -y * u, -y * v], y, p.w);
  }
  const h = solveLinear(AtA, Atb); if (!h) return null;
  const map = (u0: number, v0: number): Pt | null => {
    const u = (u0 - bu.cx) * bu.s, v = (v0 - bu.cy) * bu.s, w = h[6] * u + h[7] * v + 1;
    if (!(Math.abs(w) > 1e-6)) return null;
    return { x: (h[0] * u + h[1] * v + h[2]) / w / bi.s + bi.cx, y: (h[3] * u + h[4] * v + h[5]) / w / bi.s + bi.cy };
  };
  let err = 0, sw = 0;
  for (const p of pts) {
    const q = map(p.u, p.v); if (!q) return null;
    err += p.w * Math.hypot(q.x - p.x, q.y - p.y); sw += p.w;
  }
  if (!(sw > 0) || err / sw > sq * 0.1) return null;
  const corners = [map(0, 0), map(1, 0), map(1, 1), map(0, 1)];
  if (corners.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  const out = corners as Pt[];
  if (!convexQuad(out)) return null;
  const side = sideLen(from), area0 = quadArea(from), area1 = quadArea(out);
  if (!(side > 1) || !(area0 > 1) || area1 < area0 * 0.55 || area1 > area0 * 1.8) return null;
  if (Math.abs(sideLen(out) - side) / side > 0.22) return null;
  if (out.some((p, i) => Math.hypot(p.x - from[i].x, p.y - from[i].y) > side * 1.15)) return null;
  return out;
}

/** How far the grid's own lines have drifted off the traced square edges, in squares. */
export function guideDrift(g: GridGuide, m: BoardMap, sq: number): number {
  if (!(sq > 1)) return 0;
  let acc = 0, w = 0;
  for (const ln of g.lines) {
    let d = 0, n = 0;
    for (const t of [0.15, 0.32, 0.5, 0.68, 0.85]) {
      const p = ln.alongU ? m(ln.k / 8, t) : m(t, ln.k / 8);
      d += Math.abs(ln.a * p.x + ln.b * p.y + ln.c); n++;
    }
    acc += ln.w * (d / n); w += ln.w;
  }
  return w > 0 ? acc / w / sq : 0;
}

/** Median distance of the middle grid lines from the real edges. The rims, where the pieces are, are left out. */
function middleError(f: GrayFrame, m: BoardMap): number {
  const errs: number[] = [];
  for (let k = 2; k <= 6; k++) for (const alongU of [true, false]) { const e = lineError(f, m, alongU, k); if (e) errs.push(e.at); }
  if (errs.length < 6) return REACH;
  return median(errs);
}

/**
 * Reads the black and white edges of the squares and, when they agree on a perspective, moves the corners onto it.
 * Every square is traced; the middle of the board, where the squares are empty, weighs the most. Returns the same
 * corners when the lines can be seen but do not improve the fit, so the caller can still use them as a guide.
 */
export function traceSquareGuide(f: GrayFrame, corners: Pt[]): { corners: Pt[]; guide: GridGuide } | null {
  const m = squareToQuad(corners), sq = sideLen(corners) / 8, guide = traceLines(f, m, sq);
  if (!guide) return null;
  const snapped = cornersFromGuide(guide, corners, sq);
  if (!snapped) return { corners, guide };
  const before = middleError(f, m), after = middleError(f, squareToQuad(snapped));
  if (after <= before + 0.012 && after < 0.1) {
    const again = traceLines(f, squareToQuad(snapped), sideLen(snapped) / 8);
    return { corners: snapped, guide: again ?? guide };
  }
  return { corners, guide };
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
