/** Lathe silhouettes shared by the 3D view (meshes) and the fake-camera renderer (rays). [radius, height] in piece units. */
export const PROFILES: Record<string, [number, number][]> = {
  // pawn: round foot, slim stem, collar, ball head
  p: [[0, 0], [0.45, 0], [0.45, 0.06], [0.4, 0.12], [0.3, 0.2], [0.22, 0.35], [0.19, 0.5], [0.3, 0.55], [0.3, 0.58], [0.2, 0.62], [0.27, 0.7], [0.29, 0.76], [0.25, 0.83], [0.15, 0.88], [0, 0.9]],
  // rook: flared base, straight tower, wide crenellated crown (flat top)
  r: [[0, 0], [0.5, 0], [0.5, 0.07], [0.42, 0.14], [0.32, 0.24], [0.28, 0.5], [0.3, 0.74], [0.42, 0.82], [0.44, 0.86], [0.44, 1.0], [0, 1.0]],
  // knight: base, thick neck, tapered head with a muzzle bulge (lathe approximation)
  n: [[0, 0], [0.5, 0], [0.5, 0.07], [0.42, 0.14], [0.3, 0.24], [0.28, 0.45], [0.33, 0.68], [0.38, 0.82], [0.34, 0.96], [0.22, 1.06], [0.1, 1.1], [0, 1.1]],
  // bishop: base, slim stem, collar, teardrop mitre with a finial
  b: [[0, 0], [0.5, 0], [0.5, 0.07], [0.42, 0.14], [0.3, 0.24], [0.2, 0.5], [0.18, 0.66], [0.32, 0.72], [0.32, 0.76], [0.2, 0.8], [0.3, 0.92], [0.28, 1.04], [0.15, 1.14], [0.08, 1.18], [0.1, 1.22], [0, 1.25]],
  // queen: base, long stem, wide collar, flared crown with orb
  q: [[0, 0], [0.5, 0], [0.5, 0.07], [0.42, 0.14], [0.3, 0.26], [0.22, 0.55], [0.2, 0.8], [0.36, 0.88], [0.36, 0.93], [0.26, 0.97], [0.5, 1.1], [0.4, 1.14], [0.22, 1.18], [0.14, 1.26], [0.12, 1.34], [0, 1.4]],
  // king: queen-like body, narrower crown, cross on top
  k: [[0, 0], [0.5, 0], [0.5, 0.07], [0.42, 0.14], [0.3, 0.26], [0.24, 0.55], [0.22, 0.88], [0.38, 0.96], [0.38, 1.0], [0.28, 1.04], [0.5, 1.15], [0.36, 1.2], [0.12, 1.24], [0.12, 1.5], [0, 1.5]],
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
