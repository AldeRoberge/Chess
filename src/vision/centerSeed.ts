import type { GrayFrame, Pt } from "./types";

/**
 * A first guess at the board from simple arithmetic, at any rotation: where four squares meet, two light ones sit
 * diagonally across from two dark ones. That crossing is easy to spot by averaging the four quarters round a point and
 * checking that opposite quarters agree and neighbouring quarters differ. The empty middle of the board is a lattice of
 * such crossings (pieces never stand there at the start), so their spacing gives the square size, their lines give the
 * turn, and the middle of the lattice is the middle of the board. Perspective is ignored on purpose: this is only where
 * the search starts, and the fitting that follows bends it onto the real edges.
 */
export interface CenterSeed { corners: Pt[]; center: Pt; side: number; angle: number; crossings: number }

const ANGLES = 6; // the pattern repeats every quarter turn, so a quarter turn in 6 steps (15 degrees) is plenty
const MIN_SCORE = 14; // grey levels of difference between the light and the dark pair

export function findCenterSeed(f: GrayFrame): CenterSeed | null {
  const { width: w, height: h, data } = f;
  if (w < 32 || h < 32) return null;
  const k = Math.max(1, Math.floor(w / 200)), sw = Math.floor(w / k), sh = Math.floor(h / k);
  const g = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    let s = 0; for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) s += data[(y * k + j) * w + x * k + i];
    g[y * sw + x] = s / (k * k);
  }
  const radii: number[] = [];
  for (let r = 3.5; r <= Math.min(sw, sh) / 5; r *= 1.25) radii.push(r);
  const at = (x: number, y: number) => g[Math.min(sh - 1, Math.max(0, Math.round(y))) * sw + Math.min(sw - 1, Math.max(0, Math.round(x)))];
  /** Mean brightness of the quarter whose middle lies `phi` radians round from the right, `r` away. */
  const quarter = (x: number, y: number, phi: number, r: number) => {
    const c = Math.cos(phi), s = Math.sin(phi);
    return (at(x + c * r * 0.6, y + s * r * 0.6) + at(x + c * r, y + s * r) + at(x + c * r * 1.4, y + s * r * 1.4)) / 3;
  };
  interface Cross { x: number; y: number; score: number; r: number; theta: number }
  const found: Cross[] = [];
  for (let y = 4; y < sh - 4; y += 2) for (let x = 4; x < sw - 4; x += 2) {
    let best: Cross | null = null;
    for (const r of radii) {
      const m = r * 2;
      if (x < m || y < m || x >= sw - m || y >= sh - m) continue;
      for (let a = 0; a < ANGLES; a++) {
        const th = (a * Math.PI) / 2 / ANGLES + Math.PI / 4;
        const q0 = quarter(x, y, th, r), q1 = quarter(x, y, th + Math.PI / 2, r), q2 = quarter(x, y, th + Math.PI, r), q3 = quarter(x, y, th + 1.5 * Math.PI, r);
        const score = Math.abs((q0 + q2) / 2 - (q1 + q3) / 2) - (Math.abs(q0 - q2) + Math.abs(q1 - q3)) / 2;
        if (score >= MIN_SCORE && (!best || score > best.score * 1.1 || (score > best.score * 0.9 && r > best.r))) best = { x, y, score, r, theta: th - Math.PI / 4 };
      }
    }
    if (best) found.push(best);
  }
  if (found.length < 9) return null;
  // Real crossings sit on a lattice: a square away, in line with their own turn, lie more crossings. Piece fuzz and the board's
  // outer edge can show far stronger contrast than the faint squares, but nothing lines up round them, so keep only the supported ones.
  const cell = 3, buckets = new Map<number, number[]>(), cellKey = (x: number, y: number) => Math.floor(y / cell) * 4096 + Math.floor(x / cell);
  found.forEach((c, i) => { const key = cellKey(c.x, c.y), b = buckets.get(key); if (b) b.push(i); else buckets.set(key, [i]); });
  const turnOk = (a: number, b: number) => { const d = Math.abs(a - b) % (Math.PI / 2); return Math.min(d, Math.PI / 2 - d) < 0.35; };
  const support = (c: Cross) => {
    const sq = c.r * Math.SQRT2, tol = Math.max(0.3 * sq, 2.5), cs = Math.cos(c.theta), sn = Math.sin(c.theta);
    let n = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ex = c.x + sq * (dx * cs - dy * sn), ey = c.y + sq * (dx * sn + dy * cs);
      let hit = false;
      for (let yy = Math.floor((ey - tol) / cell); yy <= Math.floor((ey + tol) / cell) && !hit; yy++) for (let xx = Math.floor((ex - tol) / cell); xx <= Math.floor((ex + tol) / cell) && !hit; xx++) {
        for (const i of buckets.get(yy * 4096 + xx) ?? []) {
          const o = found[i];
          if (Math.hypot(o.x - ex, o.y - ey) <= tol && o.r >= c.r / 1.3 && o.r <= c.r * 1.3 && turnOk(o.theta, c.theta)) { hit = true; break; }
        }
      }
      if (hit) n++;
    }
    return n;
  };
  const lattice = found.filter((c) => support(c) >= 2);
  if (lattice.length < 9) return null;
  // the square size most crossings agree on
  const bySize = radii.map((r) => ({ r, w: lattice.filter((c) => c.r === r).length })).sort((a, b) => b.w - a.w);
  const r0 = bySize[0].r;
  let keep = lattice.filter((c) => c.r >= r0 / 1.3 && c.r <= r0 * 1.3);
  keep.sort((a, b) => b.score - a.score);
  const thin: Cross[] = [];
  for (const c of keep) if (thin.every((t) => Math.hypot(t.x - c.x, t.y - c.y) > r0 * 1.15)) thin.push(c);
  keep = thin;
  if (keep.length < 9) return null;
  // the connected group (crossings are a square apart, diagonal ones 1.4 apart)
  const link = r0 * Math.SQRT2 * 1.7, seen = new Uint8Array(keep.length);
  let group: Cross[] = [];
  for (let i = 0; i < keep.length; i++) {
    if (seen[i]) continue;
    const comp: Cross[] = [], stack = [i]; seen[i] = 1;
    while (stack.length) {
      const c = stack.pop()!; comp.push(keep[c]);
      for (let j = 0; j < keep.length; j++) if (!seen[j] && Math.hypot(keep[j].x - keep[c].x, keep[j].y - keep[c].y) <= link) { seen[j] = 1; stack.push(j); }
    }
    if (comp.length > group.length) group = comp;
  }
  if (group.length < 9) return null;
  // the turn: lines of crossings repeat every quarter turn, so average four times the angle
  let sa = 0, ca = 0;
  for (const c of group) { sa += Math.sin(4 * c.theta); ca += Math.cos(4 * c.theta); }
  const angle = Math.atan2(sa, ca) / 4, u = { x: Math.cos(angle), y: Math.sin(angle) }, v = { x: -u.y, y: u.x };
  // the square size: the usual distance from a crossing to its nearest neighbour
  const nn = group.map((c) => Math.min(...group.filter((o) => o !== c).map((o) => Math.hypot(o.x - c.x, o.y - c.y)))).sort((a, b) => a - b);
  const side = nn[Math.floor(nn.length / 2)];
  if (!(side > 2)) return null;
  // the middle of the lattice, from where most crossings lie along each of the two directions
  const mid = (vals: number[]) => { const s = vals.slice().sort((a, b) => a - b); return (s[Math.floor(s.length * 0.1)] + s[Math.ceil(s.length * 0.9) - 1]) / 2; };
  const mu = mid(group.map((c) => c.x * u.x + c.y * u.y)), mv = mid(group.map((c) => c.x * v.x + c.y * v.y));
  const cx = u.x * mu + v.x * mv, cy = u.y * mu + v.y * mv;
  const to = (a: number, b: number): Pt => ({ x: (cx + u.x * a * side + v.x * b * side + 0.5) * k, y: (cy + u.y * a * side + v.y * b * side + 0.5) * k });
  return { corners: [to(-4, -4), to(4, -4), to(4, 4), to(-4, 4)], center: { x: (cx + 0.5) * k, y: (cy + 0.5) * k }, side: side * k, angle, crossings: group.length };
}
