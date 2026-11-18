import { describe, expect, it } from "vitest";
import { RIGS, rigCorners, FRAME_H, FRAME_W } from "../sim/rigs";
import { cameraPoseFromBoard, poseString } from "./boardPose";

describe("camera pose from the board corners", () => {
  it.each(Object.values(RIGS))("recovers rig $id's position and aim exactly from its projected board corners", (rig) => {
    const p = cameraPoseFromBoard(rigCorners(rig, 0), FRAME_W, FRAME_H, rig.fovY);
    rig.pos.forEach((v, i) => expect(p.pos[i]).toBeCloseTo(v, 4));
    const want = rig.target.map((v, i) => v - rig.pos[i]), got = p.target.map((v, i) => v - p.pos[i]);
    const n = Math.hypot(...want); want.forEach((v, i) => expect(got[i]).toBeCloseTo(v / n, 4));
  });
  it("stays within a few centimetres when the corners were marked slightly above the board (as the wizard's presets are)", () => {
    const rig = RIGS.B, p = cameraPoseFromBoard(rigCorners(rig), FRAME_W, FRAME_H, rig.fovY);
    expect(Math.hypot(p.pos[0] - rig.pos[0], p.pos[1] - rig.pos[1], p.pos[2] - rig.pos[2])).toBeLessThan(0.08);
  });
  it("tolerates a couple of pixels of corner-picking error", () => {
    const rig = RIGS.A, c = rigCorners(rig, 0).map((q, i) => ({ x: q.x + (i % 2 ? 1.5 : -1.5), y: q.y + (i < 2 ? 1 : -1) }));
    const p = cameraPoseFromBoard(c, FRAME_W, FRAME_H, rig.fovY);
    expect(Math.hypot(p.pos[0] - rig.pos[0], p.pos[1] - rig.pos[1], p.pos[2] - rig.pos[2])).toBeLessThan(0.15);
  });
  it("puts the board in front of the lens even when the corners are listed from the opposite side (corners listed from the other side)", () => {
    const rig = RIGS.A, c = rigCorners(rig, 0);
    const p = cameraPoseFromBoard([c[2], c[3], c[0], c[1]], FRAME_W, FRAME_H, rig.fovY); // board seen rotated half a turn
    expect(p.pos[1]).toBeGreaterThan(1); // still above the table
  });
  it("formats the parameter string the pose node expects", () => {
    const s = poseString(rigCorners(RIGS.A, 0), FRAME_W, FRAME_H, RIGS.A.fovY);
    expect(s).toMatch(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?;-?[\d.]+,-?[\d.]+,-?[\d.]+;42$/); expect(s.split(";")[0]).toBe("0,1.75,0.3");
  });
});
