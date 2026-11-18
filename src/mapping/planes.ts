export type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };

export interface Surface {
  id: string;
  kind: "floor" | "ceiling" | "wall" | "other";
  normal: V3;
  center: V3;
  u: V3; // unit axes in the plane
  v: V3;
  halfW: number;
  halfH: number;
  inliers: number;
}

export interface PlaneOpts { iterations: number; tol: number; minInliers: number; maxPlanes: number; up: V3; seed: number }
export const defaultPlaneOpts = (): PlaneOpts => ({ iterations: 300, tol: 0.03, minInliers: 200, maxPlanes: 12, up: [0, 1, 0], seed: 3 });

/**
 * Sequential RANSAC over a scan's vertices (flat xyz array, e.g. from a Polycam OBJ/GLB).
 * Each plane becomes a projectable Surface with an oriented rectangular extent and a
 * floor / ceiling / wall label from its normal relative to `up`.
 */
export function extractSurfaces(xyz: Float32Array | number[], o: Partial<PlaneOpts> = {}): Surface[] {
  const opt = { ...defaultPlaneOpts(), ...o };
  let s = opt.seed;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  let idx: number[] = [];
  for (let i = 0; i < xyz.length / 3; i++) idx.push(i);
  const P = (i: number): V3 => [xyz[i * 3], xyz[i * 3 + 1], xyz[i * 3 + 2]];
  const out: Surface[] = [];

  while (out.length < opt.maxPlanes && idx.length >= opt.minInliers) {
    let best: number[] = [], bn: V3 = [0, 1, 0], bd = 0;
    for (let it = 0; it < opt.iterations; it++) {
      const a = P(idx[Math.floor(rand() * idx.length)]), b = P(idx[Math.floor(rand() * idx.length)]), c = P(idx[Math.floor(rand() * idx.length)]);
      const n = cross(sub(b, a), sub(c, a));
      if (Math.hypot(...n) < 1e-9) continue;
      const nn = norm(n), d = -dot(nn, a);
      let cnt = 0;
      for (const i of idx) if (Math.abs(dot(nn, P(i)) + d) < opt.tol) cnt++;
      if (cnt > best.length) { best = idx.filter((i) => Math.abs(dot(nn, P(i)) + d) < opt.tol); bn = nn; bd = d; }
    }
    if (best.length < opt.minInliers) break;
    out.push(toSurface(`plane${out.length}`, best.map(P), bn, bd, opt.up));
    const set = new Set(best);
    idx = idx.filter((i) => !set.has(i));
  }
  return out;
}

function toSurface(id: string, pts: V3[], n: V3, _d: number, up: V3): Surface {
  const c: V3 = [0, 0, 0];
  for (const p of pts) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
  c[0] /= pts.length; c[1] /= pts.length; c[2] /= pts.length;
  const ref: V3 = Math.abs(dot(n, up)) > 0.9 ? [1, 0, 0] : up;
  // wall: v = world-up projected into the plane; floor/ceiling: v = reference axis
  let v = sub(ref, [n[0] * dot(ref, n), n[1] * dot(ref, n), n[2] * dot(ref, n)]);
  v = norm(v);
  const u = norm(cross(v, n));
  let minU = 1e9, maxU = -1e9, minV = 1e9, maxV = -1e9;
  for (const p of pts) {
    const r = sub(p, c);
    const a = dot(r, u), b = dot(r, v);
    minU = Math.min(minU, a); maxU = Math.max(maxU, a); minV = Math.min(minV, b); maxV = Math.max(maxV, b);
  }
  const mid: V3 = [c[0] + u[0] * (minU + maxU) / 2 + v[0] * (minV + maxV) / 2, c[1] + u[1] * (minU + maxU) / 2 + v[1] * (minV + maxV) / 2, c[2] + u[2] * (minU + maxU) / 2 + v[2] * (minV + maxV) / 2];
  const up_ = dot(n, up);
  const kind: Surface["kind"] = Math.abs(up_) > 0.9 ? (dot(sub(mid, [0, 0, 0]), up) > 1.5 ? "ceiling" : "floor") : Math.abs(up_) < 0.3 ? "wall" : "other";
  return { id, kind, normal: n, center: mid, u, v, halfW: (maxU - minU) / 2, halfH: (maxV - minV) / 2, inliers: pts.length };
}
