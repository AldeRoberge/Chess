import type { Pt } from "../vision/types";

/** Projective map of the unit square onto a quad (Heckbert), so the board grid is drawn in true perspective. */
export function squareToQuad(q: Pt[]): (u: number, v: number) => Pt {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dy1 = p1.y - p2.y, dy2 = p3.y - p2.y;
  const sx = p0.x - p1.x + p2.x - p3.x, sy = p0.y - p1.y + p2.y - p3.y;
  const det = dx1 * dy2 - dx2 * dy1;
  const g = Math.abs(det) < 1e-9 ? 0 : (sx * dy2 - dx2 * sy) / det, hh = Math.abs(det) < 1e-9 ? 0 : (dx1 * sy - sx * dy1) / det;
  const a = p1.x - p0.x + g * p1.x, b = p3.x - p0.x + hh * p3.x, c = p0.x, d = p1.y - p0.y + g * p1.y, e = p3.y - p0.y + hh * p3.y, f = p0.y;
  return (u, v) => { const w = g * u + hh * v + 1; return { x: (a * u + b * v + c) / w, y: (d * u + e * v + f) / w }; };
}
