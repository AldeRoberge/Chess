import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import { armPose, restTarget } from "../sim/arm";
import { HAND_JOINT_NAMES } from "./joints";
import { jointDistance } from "./kinematics";
import { HAND_POSE_RECIPES, lerpRecipe } from "./poses";
import { HandRig } from "./rig";

const load = async (side: "left" | "right") => {
  const b = readFileSync(`public/models/hands/${side}.glb`);
  const ab = new ArrayBuffer(b.length); new Uint8Array(ab).set(b); // a fresh buffer: jsdom and node disagree about whose ArrayBuffer Buffer.buffer is
  return (await new GLTFLoader().parseAsync(ab, "")).scene;
};
const mat = new THREE.MeshBasicMaterial();
const reach = (hand: "L" | "R", grasp: number, grip: "pinch" | "fist") => armPose({ side: 1, hand, tip: [0.1, 0.8, 0.1], grasp, active: true, grip });

describe("hand rig (Hexalt generic-hand GLBs)", () => {
  it("finds all 25 skinned joints in both meshes", async () => {
    for (const side of ["left", "right"] as const) {
      const rig = new HandRig(await load(side), side, mat), names = new Set<string>();
      rig.root.traverse((o) => names.add(o.name));
      for (const j of HAND_JOINT_NAMES) expect(names.has(j)).toBe(true);
    }
  });
  it("blends recipes between open and grip", () => {
    const o = HAND_POSE_RECIPES.open, g = HAND_POSE_RECIPES.grip;
    expect(lerpRecipe(o, g, 0).index.pip).toBeCloseTo(o.index.pip);
    expect(lerpRecipe(o, g, 1).index.pip).toBeCloseTo(g.index.pip);
    expect(lerpRecipe(o, g, 2).index.pip).toBeCloseTo(g.index.pip); // clamped
  });
  it("places the wrist at the arm's wrist and closes the fingers with the grasp", async () => {
    const rig = new HandRig(await load("right"), "right", mat), tip = () => jointDistance(rig.fingerPose({ grasp: 0, grip: "fist", active: true }), "index-finger-tip", "wrist");
    const open = reach("R", 0, "fist"); rig.place(open);
    expect(rig.root.position.toArray()).toEqual(open.wrist);
    const reachOpen = tip();
    const fist = reach("R", 1, "fist"); rig.place(fist);
    expect(jointDistance(rig.fingerPose(fist), "index-finger-tip", "wrist")).toBeLessThan(reachOpen);
  });
  it("pinches thumb and index to the piece gap, cached, and curls an idle hand a little", async () => {
    const rig = new HandRig(await load("left"), "left", mat), p = reach("L", 1, "pinch");
    const a = rig.fingerPose(p), gap = jointDistance(a, "thumb-tip", "index-finger-tip");
    expect(gap).toBeGreaterThan(0.005); expect(gap).toBeLessThan(0.05);
    expect(rig.fingerPose(p)).toBe(a);
    const half = rig.fingerPose({ grasp: 0.5, grip: "pinch", active: true });
    expect(jointDistance(half, "thumb-tip", "index-finger-tip")).toBeGreaterThan(gap);
    const idle = armPose({ side: 1, hand: "L", tip: restTarget(1, "L"), grasp: 0, active: false });
    expect(rig.fingerPose(idle)).not.toBe(a);
    expect(() => rig.place(idle)).not.toThrow(); rig.dispose();
  });
});
