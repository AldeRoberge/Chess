import type { Capsule3D, V3 } from "./arm";

/** One overhead lamp (an IR illuminator over the table). Shared by the ray-caster and the 3D view. */
export const LIGHT: V3 = [-0.3, 2.1, 0.4];
export const SHADOW_STRENGTH = 0.55;

export interface ShadowMask { x0: number; z0: number; cell: number; w: number; h: number; data: Float32Array }

const CELL = 0.006, X0 = -0.7, X1 = 0.7, Z0 = -0.5, Z1 = 0.5;

/**
 * Soft shadows of upright/arbitrary capsules on the table plane, as a coverage mask 0..1.
 * Each capsule is projected from the lamp onto y = tableY (perspective: higher parts spread wider and blur more),
 * then rasterised once. Per-pixel lookups in the camera ray-caster are then O(1) instead of casting shadow rays.
 */
export function buildShadowMask(caps: Capsule3D[], tableY: number, light: V3 = LIGHT): ShadowMask {
  const w = Math.ceil((X1 - X0) / CELL), h = Math.ceil((Z1 - Z0) / CELL);
  const m: ShadowMask = { x0: X0, z0: Z0, cell: CELL, w, h, data: new Float32Array(w * h) };
  const proj = (p: V3) => { const k = (light[1] - tableY) / Math.max(1e-3, light[1] - p[1]); return { x: light[0] + (p[0] - light[0]) * k, z: light[2] + (p[2] - light[2]) * k, k, up: p[1] - tableY }; };
  for (const c of caps) {
    if (c.a[1] >= light[1] || c.b[1] >= light[1]) continue; // above the lamp: casts nothing downward
    const A = proj(c.a), B = proj(c.b), rA = c.r * A.k, rB = c.r * B.k;
    const soft = 0.004 + 0.012 * Math.min(1, Math.max(0, (A.up + B.up) / 2) / 0.3);
    const pad = Math.max(rA, rB) + soft;
    const i0 = Math.max(0, Math.floor((Math.min(A.x, B.x) - pad - X0) / CELL)), i1 = Math.min(w - 1, Math.ceil((Math.max(A.x, B.x) + pad - X0) / CELL));
    const j0 = Math.max(0, Math.floor((Math.min(A.z, B.z) - pad - Z0) / CELL)), j1 = Math.min(h - 1, Math.ceil((Math.max(A.z, B.z) + pad - Z0) / CELL));
    const dx = B.x - A.x, dz = B.z - A.z, l2 = dx * dx + dz * dz;
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const px = X0 + (i + 0.5) * CELL, pz = Z0 + (j + 0.5) * CELL;
        const t = l2 > 1e-12 ? Math.min(1, Math.max(0, ((px - A.x) * dx + (pz - A.z) * dz) / l2)) : 0;
        const d = Math.hypot(px - (A.x + dx * t), pz - (A.z + dz * t)) - (rA + (rB - rA) * t);
        const cov = Math.min(1, Math.max(0, 0.5 - d / (2 * soft)));
        const idx = j * w + i;
        if (cov > m.data[idx]) m.data[idx] = cov;
      }
  }
  return m;
}

/** Shadow coverage 0..1 at a table-plane point. */
export function shadowAt(m: ShadowMask, x: number, z: number): number {
  const i = Math.floor((x - m.x0) / m.cell), j = Math.floor((z - m.z0) / m.cell);
  return i < 0 || j < 0 || i >= m.w || j >= m.h ? 0 : m.data[j * m.w + i];
}
