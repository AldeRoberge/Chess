import { cameraMatrix, project } from "../vision/triangulate";
import type { Pt } from "../vision/types";
import { TABLE_Y, boardToWorld } from "../world/coords";

export interface CameraRig { id: string; pos: [number, number, number]; target: [number, number, number]; fovY: number }
export const FRAME_W = 480, FRAME_H = 360;

/** Three viewpoints used by the virtual cameras: overhead-ish from white, from black's left, from the right. */
export const RIGS: Record<string, CameraRig> = {
  A: { id: "A", pos: [0, 1.75, 0.3], target: [0, TABLE_Y, 0], fovY: 42 },
  B: { id: "B", pos: [-0.35, 1.7, -0.45], target: [0, TABLE_Y, 0], fovY: 44 },
  C: { id: "C", pos: [0.55, 1.6, 0.55], target: [0, TABLE_Y, 0], fovY: 46 },
};

/** Where the four board corners [a8, h8, h1, a1] land in a rig's image, measured slightly above the board (pieces' mid-height). */
export function rigCorners(rig: CameraRig, lift = 0.012): Pt[] {
  const P = cameraMatrix(rig.pos, rig.target, rig.fovY, FRAME_W, FRAME_H);
  return [[0, 0], [8, 0], [8, 8], [0, 8]].map(([u, v]) => { const w = boardToWorld(u, v); return project(P, [w[0], w[1] + lift, w[2]]); });
}

/** Image px of a world point for a rig (used to anchor the fake hand in readers' views). */
export const rigProject = (rig: CameraRig, p: [number, number, number]) => project(cameraMatrix(rig.pos, rig.target, rig.fovY, FRAME_W, FRAME_H), p);
