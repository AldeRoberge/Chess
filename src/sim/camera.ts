import type { CameraRig } from "./rigs";

export interface CameraBasis {
  f: [number, number, number]; r: [number, number, number]; u: [number, number, number];
  fl: number; // focal length in px
  project(p: [number, number, number]): { x: number; y: number } | null;
}

const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const nrm = (a: number[]): [number, number, number] => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };

/** Orthonormal camera frame (same conventions as vision/triangulate cameraMatrix). */
export function cameraBasis(rig: CameraRig, w: number, h: number): CameraBasis {
  const f = nrm(sub(rig.target, rig.pos)), r = nrm(cross(f, [0, 1, 0])), u = nrm(cross(r, f));
  const fl = h / 2 / Math.tan((rig.fovY * Math.PI) / 360);
  return {
    f, r, u, fl,
    project(p) {
      const d = sub(p, rig.pos), z = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
      if (z <= 1e-6) return null;
      return { x: w / 2 + (fl * (d[0] * r[0] + d[1] * r[1] + d[2] * r[2])) / z, y: h / 2 - (fl * (d[0] * u[0] + d[1] * u[1] + d[2] * u[2])) / z };
    },
  };
}
