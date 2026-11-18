import type { V3 } from "./planes";

export interface ProjectorDef {
  id: string;
  pos: V3;
  target: V3;
  fovY: number; // degrees (vertical)
  aspect: number; // width / height
  rollDeg?: number;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };

/** World point -> normalized device coords (-1..1) of the projector, or null when behind it. */
export function projectToProjector(p: ProjectorDef, w: V3): { x: number; y: number; depth: number } | null {
  const f = norm(sub(p.target, p.pos));
  const r = norm(cross(f, Math.abs(f[1]) > 0.9999 ? [0, 0, -1] : [0, 1, 0])); // straight-down projectors need another 'up'
  const u = cross(r, f);
  const d = sub(w, p.pos);
  const z = dot(d, f);
  if (z <= 1e-6) return null;
  const t = Math.tan((p.fovY * Math.PI) / 360);
  return { x: dot(d, r) / z / (t * p.aspect), y: dot(d, u) / z / t, depth: z };
}

/** Smooth 0..1 weight: 1 well inside the frustum, easing to 0 at its edge (feather = fraction of half-width). */
export function edgeWeight(x: number, y: number, feather = 0.25): number {
  const k = (v: number) => Math.min(1, Math.max(0, (1 - Math.abs(v)) / feather));
  const s = (t: number) => t * t * (3 - 2 * t);
  return s(k(x)) * s(k(y));
}

/**
 * Edge blending: each projector's share of a world point where several overlap.
 * Shares sum to 1 and are gamma-compensated (display gamma ~2.2) so overlaps keep constant brightness.
 */
export function blendShares(projs: ProjectorDef[], w: V3, feather = 0.25, gamma = 2.2): number[] {
  const ws = projs.map((p) => {
    const q = projectToProjector(p, w);
    return q ? edgeWeight(q.x, q.y, feather) : 0;
  });
  const sum = ws.reduce((a, b) => a + b, 0);
  return ws.map((x) => (sum > 0 ? Math.pow(x / sum, 1 / gamma) : 0));
}
