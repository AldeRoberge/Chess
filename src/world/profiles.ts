/**
 * Lathe silhouettes shared by the 3D view (meshes) and the fake-camera renderer (rays / shadows).
 * [radius, height] in piece units. Heights must be non-decreasing so radiusAt can interpolate.
 * Staunton-style turned profiles: plinth, waist, collar, then the head/crown.
 * Detail that a lathe cannot make (knight head, rook merlons, king cross) is added in world/pieces.ts.
 */
export const PROFILES: Record<string, [number, number][]> = {
  // pawn: wide plinth, slim waist, collar ring, round ball head
  p: [[0, 0], [0.45, 0], [0.45, 0.05], [0.43, 0.1], [0.37, 0.13], [0.27, 0.18], [0.21, 0.27], [0.19, 0.36], [0.2, 0.44], [0.25, 0.49], [0.31, 0.52], [0.31, 0.55], [0.22, 0.575], [0.173, 0.58], [0.188, 0.612], [0.2, 0.68], [0.173, 0.78], [0.129, 0.833], [0.068, 0.868], [0, 0.88]],
  // rook: plinth, tower, flared parapet ring at 0.9 (merlons sit on top, see pieces.ts)
  r: [[0, 0], [0.5, 0], [0.5, 0.05], [0.47, 0.09], [0.4, 0.13], [0.34, 0.19], [0.31, 0.27], [0.3, 0.6], [0.32, 0.76], [0.37, 0.82], [0.38, 0.86], [0.38, 0.9], [0, 0.9]],
  // knight: plinth and neck; the horse head is an extruded silhouette added in pieces.ts
  n: [[0, 0], [0.5, 0], [0.5, 0.05], [0.44, 0.1], [0.36, 0.15], [0.3, 0.22], [0.28, 0.4], [0.28, 0.7], [0.3, 0.9], [0.25, 1.0], [0.15, 1.08], [0, 1.1]],
  // bishop: plinth, slim stem, collar, pointed mitre with a finial ball
  b: [[0, 0], [0.5, 0], [0.5, 0.05], [0.44, 0.1], [0.36, 0.15], [0.3, 0.22], [0.22, 0.34], [0.19, 0.5], [0.18, 0.62], [0.24, 0.68], [0.28, 0.7], [0.28, 0.74], [0.2, 0.78], [0.26, 0.84], [0.31, 0.92], [0.3, 0.99], [0.22, 1.08], [0.12, 1.16], [0.1, 1.19], [0.07, 1.22], [0.04, 1.25], [0, 1.26]],
  // queen: plinth, long stem, collar, flared crown cup with a ball on top
  q: [[0, 0], [0.5, 0], [0.5, 0.05], [0.44, 0.1], [0.36, 0.15], [0.3, 0.24], [0.22, 0.4], [0.2, 0.6], [0.22, 0.8], [0.3, 0.86], [0.36, 0.9], [0.36, 0.95], [0.3, 0.98], [0.38, 1.1], [0.42, 1.2], [0.36, 1.26], [0.2, 1.3], [0.12, 1.36], [0.07, 1.4], [0, 1.42]],
  // king: queen-like body with a taller, narrower crown; the cross is added in pieces.ts
  k: [[0, 0], [0.5, 0], [0.5, 0.05], [0.44, 0.1], [0.36, 0.15], [0.3, 0.24], [0.22, 0.4], [0.2, 0.6], [0.22, 0.82], [0.3, 0.88], [0.36, 0.92], [0.36, 0.97], [0.3, 1.0], [0.34, 1.1], [0.38, 1.2], [0.32, 1.26], [0.18, 1.3], [0.12, 1.34], [0.1, 1.4], [0.08, 1.46], [0, 1.5]],
};

/** Radius of a profile at height y (piece units); 0 above the top or below the base. */
export function radiusAt(type: string, y: number): number {
  const p = PROFILES[type];
  if (y < 0 || y > p[p.length - 1][1]) return 0;
  const i = p.findIndex((pt, k) => k > 0 && y <= pt[1]); // y is within the solid, so a segment always exists
  const [r0, y0] = p[i - 1], [r1, y1] = p[i];
  return y1 === y0 ? Math.max(r0, r1) : r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
}

export const profileHeight = (type: string) => PROFILES[type][PROFILES[type].length - 1][1];
export const profileMaxRadius = (type: string) => Math.max(...PROFILES[type].map((p) => p[0]));
