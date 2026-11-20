import type { Pt } from "../vision/types";

interface Coeffs { a: number; b: number; c: number; d: number; e: number; f: number; g: number; h: number }

/** The eight numbers of the projective map of the unit square onto the quad `q` (Heckbert). */
function coeffs(q: Pt[]): Coeffs {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dy1 = p1.y - p2.y, dy2 = p3.y - p2.y;
  const sx = p0.x - p1.x + p2.x - p3.x, sy = p0.y - p1.y + p2.y - p3.y;
  const det = dx1 * dy2 - dx2 * dy1;
  const g = Math.abs(det) < 1e-9 ? 0 : (sx * dy2 - dx2 * sy) / det, hh = Math.abs(det) < 1e-9 ? 0 : (dx1 * sy - sx * dy1) / det;
  return { a: p1.x - p0.x + g * p1.x, b: p3.x - p0.x + hh * p3.x, c: p0.x, d: p1.y - p0.y + g * p1.y, e: p3.y - p0.y + hh * p3.y, f: p0.y, g, h: hh };
}

/** Projective map of the unit square onto a quad (Heckbert), so the board grid is drawn in true perspective. */
export function squareToQuad(q: Pt[]): (u: number, v: number) => Pt {
  const { a, b, c, d, e, f, g, h: hh } = coeffs(q);
  return (u, v) => { const w = g * u + hh * v + 1; return { x: (a * u + b * v + c) / w, y: (d * u + e * v + f) / w }; };
}

/** The projective denominator at a board point (1 at the a8 corner): it shrinks toward the horizon and is zero or negative once a point would be at or behind the camera. */
export function quadDepth(q: Pt[]): (u: number, v: number) => number {
  const { g, h } = coeffs(q);
  return (u, v) => g * u + h * v + 1;
}

/** The way back: a picture point to board coordinates (u across the files, v down the ranks), or null when it has none. */
export function quadToSquare(q: Pt[]): (x: number, y: number) => { u: number; v: number } | null {
  const { a, b, c, d, e, f, g, h } = coeffs(q);
  return (x, y) => {
    const m11 = a - g * x, m12 = b - h * x, m21 = d - g * y, m22 = e - h * y, det = m11 * m22 - m12 * m21;
    if (Math.abs(det) < 1e-12) return null;
    const r1 = x - c, r2 = y - f, u = (r1 * m22 - m12 * r2) / det, v = (m11 * r2 - m21 * r1) / det;
    return Number.isFinite(u) && Number.isFinite(v) ? { u, v } : null;
  };
}
