import type { GrayFrame, Pt } from "./types";

/**
 * Finds the board in a grey picture and returns its four corners ordered top-left, top-right, bottom-right, bottom-left
 * of the picture, or null when nothing board-like is there. A board is the biggest patch of busy texture (many strong
 * edges close together), so: gradient strength -> box blur -> Otsu threshold -> biggest blob -> convex hull -> the four
 * hull points furthest along the picture's diagonals.
 */
export interface FindOpts {
  /** Scales the texture threshold: below 1 grows the blob (looser), above 1 shrinks it. */
  tScale?: number;
  /** Scales the blur radius that merges nearby edges into one blob. */
  blurScale?: number;
}

export function findBoardCorners(f: GrayFrame, opts: FindOpts = {}): Pt[] | null {
  const { width: w, height: h, data } = f;
  if (w < 16 || h < 16) return null;
  // Work on at most ~160 px wide so the cost is flat whatever the camera resolves.
  const k = Math.max(1, Math.floor(w / 160)), sw = Math.floor(w / k), sh = Math.floor(h / k);
  const g = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    let s = 0; for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) s += data[(y * k + j) * w + x * k + i];
    g[y * sw + x] = s / (k * k);
  }
  const mag = new Float32Array(sw * sh);
  for (let y = 1; y < sh - 1; y++) for (let x = 1; x < sw - 1; x++) {
    const gx = g[y * sw + x + 1] - g[y * sw + x - 1], gy = g[(y + 1) * sw + x] - g[(y - 1) * sw + x];
    mag[y * sw + x] = Math.hypot(gx, gy);
  }
  const r = Math.max(opts.blurScale ? 1 : 2, Math.round((sw / 40) * (opts.blurScale ?? 1)));
  const busy = boxBlur(boxBlur(mag, sw, sh, r), sw, sh, r);
  const t = otsu(busy);
  if (t == null) return null;
  const mask = new Uint8Array(sw * sh); for (let i = 0; i < mask.length; i++) mask[i] = busy[i] > t * (opts.tScale ?? 1) ? 1 : 0;
  const blob = biggestBlob(mask, sw, sh);
  if (!blob || blob.length < sw * sh * 0.04 || blob.length > sw * sh * 0.95) return null;
  const hull = convexHull(blob.map((i) => ({ x: i % sw, y: Math.floor(i / sw) })));
  if (hull.length < 3) return null;
  const pick = (score: (p: Pt) => number) => hull.reduce((a, b) => (score(b) > score(a) ? b : a));
  const tl = pick((p) => -p.x - p.y), tr = pick((p) => p.x - p.y), br = pick((p) => p.x + p.y), bl = pick((p) => -p.x + p.y);
  const out = [tl, tr, br, bl].map((p) => ({ x: (p.x + 0.5) * k, y: (p.y + 0.5) * k }));
  // Four distinct corners with a real area, or it is not a board.
  const area = Math.abs(out.reduce((s, p, i) => { const q = out[(i + 1) % 4]; return s + p.x * q.y - q.x * p.y; }, 0)) / 2;
  return area > w * h * 0.03 ? out : null;
}

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let s = 0, n = 0;
    for (let x = 0; x < Math.min(w, r); x++) { s += src[y * w + x]; n++; }
    for (let x = 0; x < w; x++) {
      if (x + r < w) { s += src[y * w + x + r]; n++; }
      if (x - r - 1 >= 0) { s -= src[y * w + x - r - 1]; n--; }
      tmp[y * w + x] = s / n;
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let y = 0; y < Math.min(h, r); y++) { s += tmp[y * w + x]; n++; }
    for (let y = 0; y < h; y++) {
      if (y + r < h) { s += tmp[(y + r) * w + x]; n++; }
      if (y - r - 1 >= 0) { s -= tmp[(y - r - 1) * w + x]; n--; }
      out[y * w + x] = s / n;
    }
  }
  return out;
}

function otsu(v: Float32Array): number | null {
  let max = 0; for (const x of v) if (x > max) max = x;
  if (max < 4) return null; // flat picture: no texture at all
  const bins = 64, hist = new Float64Array(bins);
  for (const x of v) hist[Math.min(bins - 1, Math.floor((x / max) * bins))]++;
  let total = v.length, sumAll = 0; for (let i = 0; i < bins; i++) sumAll += i * hist[i];
  let wb = 0, sb = 0, best = -1, bestT = 0;
  for (let i = 0; i < bins; i++) {
    wb += hist[i]; if (!wb) continue; const wf = total - wb; if (!wf) break;
    sb += i * hist[i]; const mb = sb / wb, mf = (sumAll - sb) / wf, between = wb * wf * (mb - mf) ** 2;
    if (between > best) { best = between; bestT = i; }
  }
  return ((bestT + 1) / bins) * max;
}

function biggestBlob(mask: Uint8Array, w: number, h: number): number[] | null {
  const seen = new Uint8Array(w * h); let best: number[] | null = null;
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    const comp: number[] = [], stack = [s]; seen[s] = 1;
    while (stack.length) {
      const i = stack.pop()!; comp.push(i); const x = i % w, y = (i / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx; if (mask[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    if (!best || comp.length > best.length) best = comp;
  }
  return best;
}

const clampN = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The checkerboard itself, ordered top-left, top-right, bottom-right, bottom-left of the picture.
 * Busy texture is the wrong signal here: a speckled table, a cable and the rim of a lamp all have edges,
 * and those were being taken as the board. A square repeats — it differs from the squares beside it and
 * matches the one diagonally across — and the table does not, so only that period is kept. The quad is then
 * walked out to the last place the squares still alternate, which stops at the playing surface instead of
 * running on into a glare the same brightness as a light square.
 */
export function findCheckerCorners(f: GrayFrame): Pt[] | null {
  const { width: w, height: h, data } = f;
  if (w < 16 || h < 16) return null;
  const k = Math.max(1, Math.floor(w / 220)), sw = Math.floor(w / k), sh = Math.floor(h / k);
  const g = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    let s = 0; for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) s += data[(y * k + j) * w + x * k + i];
    g[y * sw + x] = s / (k * k);
  }
  const hit = bestPeriod(g, sw, sh);
  if (!hit) return null;
  const period0 = Math.max(hit.sx, hit.sy);
  const blob = largestBlob(hit.pts, period0 * 1.4);
  if (blob.length < 16) return null;
  const full = blob.map((p) => ({ x: (p.x + 0.5) * k, y: (p.y + 0.5) * k }));
  const period = period0 * k;
  const vals = full.map((p) => data[clampN(Math.round(p.y), 0, h - 1) * w + clampN(Math.round(p.x), 0, w - 1)]).sort((a, b) => a - b);
  const dark = vals[Math.floor(vals.length * 0.3)], light = vals[Math.floor(vals.length * 0.7)];
  if (light - dark < 12) return null;
  const q = fitChecker(data, w, h, extremes(full), period, (light + dark) / 2, Math.max(14, (light - dark) * 0.4));
  const area = Math.abs(q.reduce((s, p, i) => { const n = q[(i + 1) % 4]; return s + p.x * n.y - n.x * p.y; }, 0)) / 2;
  return area > w * h * 0.02 ? q : null;
}

function checkerAt(g: Float32Array, sw: number, sh: number, x: number, y: number, vx: number, vy: number): boolean {
  if (x - vx < 0 || y - vy < 0 || x + vx >= sw || y + vy >= sh) return false;
  const a = g[y * sw + x];
  const l = g[y * sw + x - vx], r = g[y * sw + x + vx], u = g[(y - vy) * sw + x], dn = g[(y + vy) * sw + x];
  const diag = g[(y + vy) * sw + x + vx];
  const diff = Math.min(Math.abs(a - l), Math.abs(a - r), Math.abs(a - u), Math.abs(a - dn));
  const same = Math.max(Math.abs(a - diag), Math.abs(l - r), Math.abs(u - dn));
  return diff >= 8 && diff - same >= 4;
}

/** Hits for the single period that explains the most of the picture. Other periods are table grain and get dropped. */
function bestPeriod(g: Float32Array, sw: number, sh: number): { pts: Pt[]; sx: number; sy: number } | null {
  let bestN = 0, sx = 12, sy = 12, best: Pt[] = [];
  for (let vy = 6; vy <= 32; vy += 2) for (let vx = 6; vx <= 32; vx += 2) {
    if (Math.abs(vx - vy) > 10) continue;
    const step = Math.max(2, Math.min(vx, vy) >> 2), pts: Pt[] = [];
    for (let y = vy; y < sh - vy - 2; y += step) for (let x = vx; x < sw - vx - 2; x += step) {
      if (!checkerAt(g, sw, sh, x, y, vx, vy) || !checkerAt(g, sw, sh, x + 2, y, vx, vy)) continue;
      pts.push({ x, y });
    }
    if (pts.length > bestN) { bestN = pts.length; sx = vx; sy = vy; best = pts; }
  }
  return bestN >= 16 ? { pts: best, sx, sy } : null;
}

function largestBlob(pts: Pt[], link: number): Pt[] {
  const cell = Math.max(1, link), key = (x: number, y: number) => `${x},${y}`, buckets = new Map<string, number[]>();
  pts.forEach((p, i) => { const k = key(Math.floor(p.x / cell), Math.floor(p.y / cell)), b = buckets.get(k); if (b) b.push(i); else buckets.set(k, [i]); });
  const seen = new Uint8Array(pts.length); let best: number[] = []; const link2 = link * link;
  for (let i = 0; i < pts.length; i++) {
    if (seen[i]) continue;
    const comp: number[] = [], q = [i]; seen[i] = 1;
    while (q.length) {
      const c = q.pop()!; comp.push(c); const p = pts[c], cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const b = buckets.get(key(cx + dx, cy + dy)); if (!b) continue;
        for (const j of b) {
          if (seen[j]) continue;
          const ox = pts[j].x - p.x, oy = pts[j].y - p.y;
          if (ox * ox + oy * oy <= link2) { seen[j] = 1; q.push(j); }
        }
      }
    }
    if (comp.length > best.length) best = comp;
  }
  return best.map((i) => pts[i]);
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

function nudgeEdge(q: Pt[], edge: number, dist: number): Pt[] {
  const a = q[edge], b = q[(edge + 1) % 4];
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, nx = dy / len, ny = -dx / len;
  return q.map((p, i) => (i === edge || i === (edge + 1) % 4 ? { x: p.x + nx * dist, y: p.y + ny * dist } : p));
}

function clockwise(c: Pt[]): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4], d = c[(i + 2) % 4];
    const cross = (b.x - a.x) * (d.y - b.y) - (b.y - a.y) * (d.x - b.x);
    if (Math.abs(cross) < 1) return false;
    const s = Math.sign(cross);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return sign > 0;
}

/** Long alternating runs along the strip just inside the edge: eight squares, not grain and not a solid lamp. */
function edgeAlternates(data: Uint8ClampedArray, w: number, h: number, q: Pt[], edge: number, minRun: number, gap: number, mid: number): boolean {
  const { levels, flips } = edgeFlips(data, w, h, q, edge, minRun, gap, mid, -3);
  // A real edge crosses nearly every square. A few accidental flips in the table grain do not.
  return levels >= 6 && flips >= 5;
}

/** Dark/light runs and their flips along a line `off` px outside the edge (negative is inside). */
function edgeFlips(data: Uint8ClampedArray, w: number, h: number, q: Pt[], edge: number, minRun: number, gap: number, mid: number, off: number): { levels: number; flips: number } {
  const a = q[edge], b = q[(edge + 1) % 4];
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, nx = dy / len, ny = -dx / len;
  const levels: number[] = []; let runPx = 0, anchor = NaN;
  // Only clearly dark or clearly light runs count: mid-grey table grain alternates too, but never that far from the middle.
  const close = () => { if (runPx >= minRun && Math.abs(anchor - mid) >= gap * 0.75) levels.push(anchor); };
  for (let dist = len * 0.08; dist < len * 0.92; dist += 2) {
    const t = dist / len, x = Math.round(a.x + dx * t + nx * off), y = Math.round(a.y + dy * t + ny * off);
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const v = data[y * w + x];
    if (Number.isNaN(anchor) || Math.abs(v - anchor) <= gap) { if (Number.isNaN(anchor)) anchor = v; runPx += 2; }
    else { close(); anchor = v; runPx = 2; }
  }
  close();
  let flips = 0;
  for (let i = 1; i < levels.length; i++) if ((levels[i] - mid) * (levels[i - 1] - mid) < 0) flips++;
  return { levels: levels.length, flips };
}

/** Moves one corner of a quad `d` px along the outward normal of `edge`. */
function nudgeCorner(q: Pt[], edge: number, which: 0 | 1, d: number): Pt[] {
  const a = q[edge], b = q[(edge + 1) % 4];
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, nx = dy / len, ny = -dx / len;
  const i = (edge + which) % 4;
  return q.map((p, j) => (j === i ? { x: p.x + nx * d, y: p.y + ny * d } : p));
}

function fitChecker(data: Uint8ClampedArray, w: number, h: number, q: Pt[], period: number, mid: number, gap: number): Pt[] {
  // Positive moves an edge outward. Grow from the squares already found and stop once a whole square breaks,
  // so a lamp or the speckled table beyond the board cannot pull the corner across the picture.
  const reach = Math.round(period * 2), minRun = Math.max(4, period * 0.22);
  const ok = (cur: Pt[], e: number, d: number) => {
    const moved = nudgeEdge(cur, e, d);
    return clockwise(moved) && edgeAlternates(data, w, h, moved, e, minRun, gap, mid);
  };
  let cur = q;
  for (let pass = 0; pass < 3; pass++) for (let e = 0; e < 4; e++) {
    let start = 0;
    if (!ok(cur, e, 0)) {
      let found = false;
      for (let d = 1; d <= period; d++) {
        if (ok(cur, e, -d)) { start = -d; found = true; break; }
        if (ok(cur, e, d)) { start = d; found = true; break; }
      }
      if (!found) continue;
    }
    // Rows with pieces on them stop alternating part-way across a square, so a short break is allowed;
    // a full square of no alternation is the table or a lamp and ends the walk.
    let best = start, miss = 0, streak = 0;
    for (let d = start + 1; d <= reach; d++) {
      if (ok(cur, e, d)) { miss = 0; if (++streak >= 2 || d === start + 1) best = d; }
      else { streak = 0; if (++miss > period * 0.9) break; }
    }
    if (best !== 0) cur = nudgeEdge(cur, e, best);
  }
  // Growing only slides edges, so a quad seeded at the wrong angle keeps it. Tilt each edge onto the board's rim:
  // the line just inside crosses every square and the line just outside is off the board and crosses none.
  const rim = (c: Pt[], e: number) => {
    if (!clockwise(c)) return -Infinity;
    // Several lines on each side so a slightly tilted edge still scores part-way; inside, pieces on the back rank can
    // break a line up, so the best one counts.
    let inside = 0, outside = 0;
    for (const off of [3, 8, 13]) {
      inside = Math.max(inside, Math.min(7, edgeFlips(data, w, h, c, e, minRun, gap, mid, -off).flips));
      outside += edgeFlips(data, w, h, c, e, minRun, gap, mid, off).flips;
    }
    return inside - outside;
  };
  const total = (c: Pt[]) => rim(c, 0) + rim(c, 1) + rim(c, 2) + rim(c, 3);
  let score = total(cur);
  // Coupled corners make a corner-by-corner search stall, so first place each edge's line on its own: slide and
  // tilt it over the span the squares already found, keep the best rim, then corner the quad where the lines meet.
  // The squares found first are often only the empty middle ranks, so the search reaches two and a half squares out.
  {
    const lo = -Math.round(period * 0.75), hi = Math.round(period * 2.5), lines: [Pt, Pt][] = [];
    for (let e = 0; e < 4; e++) {
      let best: [Pt, Pt] = [cur[e], cur[(e + 1) % 4]], bestS = -Infinity;
      for (let da = lo; da <= hi; da += 2) for (let db = lo; db <= hi; db += 2) {
        const c = nudgeCorner(nudgeCorner(cur, e, 0, da), e, 1, db);
        const sc = rim(c, e) * 2 + Math.min(7, edgeFlips(data, w, h, c, e, minRun, gap, mid, -3).flips);
        if (sc > bestS) { bestS = sc; best = [c[e], c[(e + 1) % 4]]; }
      }
      lines.push(best);
    }
    const meet = (p: [Pt, Pt], q: [Pt, Pt]): Pt | null => {
      const r = { x: p[1].x - p[0].x, y: p[1].y - p[0].y }, s2 = { x: q[1].x - q[0].x, y: q[1].y - q[0].y };
      const den = r.x * s2.y - r.y * s2.x; if (Math.abs(den) < 1e-6) return null;
      const t = ((q[0].x - p[0].x) * s2.y - (q[0].y - p[0].y) * s2.x) / den;
      return { x: p[0].x + r.x * t, y: p[0].y + r.y * t };
    };
    const quad = [0, 1, 2, 3].map((i) => meet(lines[(i + 3) % 4], lines[i]));
    if (quad.every((p) => p && p.x > -w && p.y > -h && p.x < 2 * w && p.y < 2 * h)) {
      const c = quad as Pt[], sc = total(c);
      if (sc >= score) { score = sc; cur = c; }
    }
  }
  for (const [range, step] of [[6, 2], [3, 1]]) {
    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      for (let i = 0; i < 4; i++) {
        let best = cur;
        for (let oy = -range; oy <= range; oy += step) for (let ox = -range; ox <= range; ox += step) for (const both of [false, true]) {
          if (!ox && !oy) continue;
          // One corner on its own, or a whole edge (this corner and the next) slid together.
          const c = cur.map((p, j) => (j === i || (both && j === (i + 1) % 4) ? { x: p.x + ox, y: p.y + oy } : p)), s = total(c);
          if (s > score) { score = s; best = c; }
        }
        if (best !== cur) { cur = best; moved = true; }
      }
      if (!moved) break;
    }
  }
  return cur;
}

function at(f: GrayFrame, c: Pt[], u: number, v: number): number {
  const [a, b, d, e] = c, w00 = (1 - u) * (1 - v), w10 = u * (1 - v), w11 = u * v, w01 = (1 - u) * v;
  const x = clampN(Math.round(w00 * a.x + w10 * b.x + w11 * d.x + w01 * e.x), 0, f.width - 1);
  const y = clampN(Math.round(w00 * a.y + w10 * b.y + w11 * d.y + w01 * e.y), 0, f.height - 1);
  return f.data[y * f.width + x];
}

/** Positive when light squares are the ones a8/h1 naming says are light. Pieces cover some centres, so each square contributes its median. */
function polarity(f: GrayFrame, c: Pt[]): number {
  const contrast: number[] = [], v: number[] = [];
  for (let rank = 8; rank >= 1; rank--) for (let file = 0; file < 8; file++) {
    const samples = [[0, 0], [-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]].map(([du, dv]) => at(f, c, (file + 0.5 + du) / 8, (8 - rank + 0.5 + dv) / 8)).sort((a, b) => a - b);
    v.push(samples[2]);
  }
  v.forEach((value, i) => {
    const row = Math.floor(i / 8), col = i % 8, around: number[] = [];
    if (col > 0) around.push(v[i - 1]);
    if (col < 7) around.push(v[i + 1]);
    if (row > 0) around.push(v[i - 8]);
    if (row < 7) around.push(v[i + 8]);
    const mean = around.reduce((s, n) => s + n, 0) / around.length;
    const dark = (col + (8 - row)) % 2 === 1;
    contrast.push((dark ? -1 : 1) * (value - mean));
  });
  const s = contrast.sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** How much brighter ranks 1–2 are than ranks 7–8, sampled at square centres where a piece sits. */
function wingDelta(f: GrayFrame, c: Pt[]): number {
  const mean = (ranks: number[]) => {
    let s = 0, n = 0;
    for (const rank of ranks) for (let file = 0; file < 8; file++) { s += at(f, c, (file + 0.5) / 8, (8 - rank + 0.5) / 8); n++; }
    return s / n;
  };
  return mean([1, 2]) - mean([7, 8]);
}

/**
 * Turns a clockwise picture quad into a8, h8, h1, a1.
 * Square colour kills a 90° spin (a8 and h1 are light). It cannot tell the board from the same board turned
 * halfway round, so the side whose pieces are lighter is white. An empty board has no such side and rank 1
 * stays toward the bottom of the picture.
 */
export function orientBoardCorners(f: GrayFrame, corners: Pt[]): Pt[] {
  const rot = (r: number) => [0, 1, 2, 3].map((i) => corners[(i + r) % 4]);
  let bestR = 0, bestP = -Infinity; const pol: number[] = [];
  for (let r = 0; r < 4; r++) { pol[r] = polarity(f, rot(r)); if (pol[r] > bestP) { bestP = pol[r]; bestR = r; } }
  const twin = (bestR + 2) % 4;
  if (pol[twin] < bestP - Math.max(4, Math.abs(bestP) * 0.3)) return rot(bestR);
  const a = rot(bestR), b = rot(twin), da = wingDelta(f, a), db = wingDelta(f, b);
  if (Math.abs(da - db) > 12) return da > db ? a : b;
  return (a[2].y + a[3].y) >= (b[2].y + b[3].y) ? a : b;
}

/** Andrew's monotone chain. */
function convexHull(pts: Pt[]): Pt[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo: Pt[] = [], up: Pt[] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...p].reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}
