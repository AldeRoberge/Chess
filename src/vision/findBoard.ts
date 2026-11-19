import type { GrayFrame, Pt } from "./types";

/**
 * Finds the board in a grey picture and returns its four corners ordered top-left, top-right, bottom-right, bottom-left
 * of the picture, or null when nothing board-like is there. A board is the biggest patch of busy texture (many strong
 * edges close together), so: gradient strength -> box blur -> Otsu threshold -> biggest blob -> convex hull -> the four
 * hull points furthest along the picture's diagonals.
 */
export function findBoardCorners(f: GrayFrame): Pt[] | null {
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
  const r = Math.max(2, Math.round(sw / 40));
  const busy = boxBlur(boxBlur(mag, sw, sh, r), sw, sh, r);
  const t = otsu(busy);
  if (t == null) return null;
  const mask = new Uint8Array(sw * sh); for (let i = 0; i < mask.length; i++) mask[i] = busy[i] > t ? 1 : 0;
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

/** Andrew's monotone chain. */
function convexHull(pts: Pt[]): Pt[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo: Pt[] = [], up: Pt[] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...p].reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}
