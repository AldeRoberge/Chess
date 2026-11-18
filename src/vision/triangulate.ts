import type { Pt } from "./types";

/** 3x4 camera projection matrix, row-major. */
export type ProjMat = number[];

/** Pinhole camera -> 3x4 P = K [R | t] from position, look-at target, and vertical fov. */
export function cameraMatrix(pos: [number, number, number], target: [number, number, number], fovY: number, w: number, h: number): ProjMat {
  const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const nrm = (a: number[]) => { const l = Math.hypot(a[0], a[1], a[2]); return a.map((x) => x / l); };
  const f = nrm(sub(target, pos));
  const r = nrm(cross(f, [0, 1, 0]));
  const u = cross(r, f); // camera up
  const fl = h / 2 / Math.tan((fovY * Math.PI) / 360);
  // rows of R: right, -up (image y down), forward
  const R = [r, u.map((x) => -x), f];
  const t = R.map((row) => -(row[0] * pos[0] + row[1] * pos[1] + row[2] * pos[2]));
  const K = [[fl, 0, w / 2], [0, fl, h / 2], [0, 0, 1]];
  const P: number[] = [];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) P.push(K[i][0] * R[0][j] + K[i][1] * R[1][j] + K[i][2] * R[2][j]);
    P.push(K[i][0] * t[0] + K[i][1] * t[1] + K[i][2] * t[2]);
  }
  return P;
}

export function project(P: ProjMat, p: [number, number, number]): Pt {
  const w = P[8] * p[0] + P[9] * p[1] + P[10] * p[2] + P[11];
  return { x: (P[0] * p[0] + P[1] * p[1] + P[2] * p[2] + P[3]) / w, y: (P[4] * p[0] + P[5] * p[1] + P[6] * p[2] + P[7]) / w };
}

/** Linear (DLT) triangulation of one joint seen by >=2 calibrated cameras, via normal equations. */
export function triangulate(Ps: ProjMat[], pts: Pt[]): [number, number, number] | null {
  if (Ps.length < 2) return null;
  const A: number[][] = [];
  for (let i = 0; i < Ps.length; i++) {
    const P = Ps[i], { x, y } = pts[i];
    A.push([x * P[8] - P[0], x * P[9] - P[1], x * P[10] - P[2], P[3] - x * P[11]]);
    A.push([y * P[8] - P[4], y * P[9] - P[5], y * P[10] - P[6], P[7] - y * P[11]]);
  }
  // solve A[:, :3] X = A[:, 3] in least squares
  const M = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  for (const r of A) for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) M[i][j] += r[i] * r[j]; M[i][3] += r[i] * r[3]; }
  const det3 = (m: number[][]) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det3(M.map((r) => r.slice(0, 3)));
  if (Math.abs(D) < 1e-12) return null;
  // Cramer's rule: replace column k by the right-hand side
  return [0, 1, 2].map((k) => det3(M.map((r) => r.slice(0, 3).map((v, j) => (j === k ? r[3] : v)))) / D) as [number, number, number];

}

/** Single-camera fallback: intersect the pixel's ray with the plane y = height (floor for feet, etc.). */
export function rayToPlane(pos: [number, number, number], P: ProjMat, px: Pt, planeY = 0): [number, number, number] | null {
  // two points on the ray: camera centre and a far point found by triangulating against a copy of itself
  // Solve P [X Y planeY 1]^T ~ [x y 1]^T for X, Z.
  const a = [px.x * P[8] - P[0], px.x * P[10] - P[2], P[3] - px.x * P[11] + (px.x * P[9] - P[1]) * planeY * -1];
  const b = [px.y * P[8] - P[4], px.y * P[10] - P[6], P[7] - px.y * P[11] + (px.y * P[9] - P[5]) * planeY * -1];
  const det = a[0] * b[1] - a[1] * b[0];
  if (Math.abs(det) < 1e-12) return null;
  const X = (a[2] * b[1] - a[1] * b[2]) / det, Z = (a[0] * b[2] - a[2] * b[0]) / det;
  void pos;
  return [X, planeY, Z];
}

export const JOINT_NAMES = ["nose", "lEye", "rEye", "lEar", "rEar", "lShoulder", "rShoulder", "lElbow", "rElbow", "lWrist", "rWrist", "lHip", "rHip", "lKnee", "rKnee", "lAnkle", "rAnkle"] as const;
export const BONES: [number, number][] = [[5, 6], [5, 7], [7, 9], [6, 8], [8, 10], [5, 11], [6, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [0, 5], [0, 6]];
