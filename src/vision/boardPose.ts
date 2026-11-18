import { SQUARE, TABLE_Y } from "../world/coords";
import { solveHomography } from "./homography";
import type { Pt } from "./types";

export interface CameraPose { pos: [number, number, number]; target: [number, number, number] }

const norm = (a: number[]) => Math.hypot(a[0], a[1], a[2]);
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: number[]) => { const l = norm(a); return a.map((v) => v / l); };

/**
 * Planar pose estimation: the four board corners (a8, h8, h1, a1 in image px) are a known 46 cm square,
 * so the homography board->image decomposes into the camera's rotation and position (K from the
 * field of view, principal point at the image centre). Returns world-space position and a look-at
 * target one metre ahead, ready for the pose node's "pos;target;fov" parameter.
 */
export function cameraPoseFromBoard(corners: Pt[], w: number, h: number, fovY: number): CameraPose {
  const s = SQUARE * 4;
  const H = solveHomography([{ x: -s, y: -s }, { x: s, y: -s }, { x: s, y: s }, { x: -s, y: s }], corners);
  const fl = h / 2 / Math.tan((fovY * Math.PI) / 360), cx = w / 2, cy = h / 2;
  // B = K^-1 H, column by column
  const col = (k: number) => [(H[k] - cx * H[6 + k]) / fl, (H[3 + k] - cy * H[6 + k]) / fl, H[6 + k]];
  let b1 = col(0), b2 = col(1), b3 = col(2);
  const lambda = 2 / (norm(b1) + norm(b2));
  b1 = b1.map((v) => v * lambda); b2 = b2.map((v) => v * lambda); b3 = b3.map((v) => v * lambda);
  // solveHomography fixes h33 = 1, so b3's depth component is 1 > 0: the board is always in front of the lens
  // orthonormalise the rotation (noise makes b1, b2 slightly non-orthogonal)
  const r1 = unit(b1), r2 = unit(b2.map((v, i) => v - dot(b2, r1) * r1[i])), r3 = cross(r1, r2);
  // r1..r3 are the columns of R (plane -> camera). Camera centre C = -R^T t; optical axis = R^T (0,0,1).
  // Plane frame: X = world x, Y = world z, Z = -world y.
  const C = [r1, r2, r3].map((r) => -dot(r, b3));
  const f = [r1[2], r2[2], r3[2]];
  const pos: [number, number, number] = [C[0], TABLE_Y - C[2], C[1]];
  return { pos, target: [pos[0] + f[0], pos[1] - f[2], pos[2] + f[1]] };
}

/** The pose node's "x,y,z;tx,ty,tz;fov" parameter string. */
export function poseString(corners: Pt[], w: number, h: number, fovY: number): string {
  const p = cameraPoseFromBoard(corners, w, h, fovY), r = (v: number) => Math.round(v * 1000) / 1000;
  return `${p.pos.map(r).join(",")};${p.target.map(r).join(",")};${fovY}`;
}
