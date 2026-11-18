import { describe, expect, it } from "vitest";
import { FORE, UPPER, armPose, restTarget, twoBoneIK, type V3 } from "./arm";
import { buildShadowMask, shadowAt } from "./shadow";
import { applySensor, rayCapsule, renderLuminance, type Scene3D } from "./render3d";
import { RIGS, rigProject } from "./rigs";
import { VirtualTable } from "./virtualTable";
import { boardToWorld, TABLE_Y } from "../world/coords";

const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("two-bone IK", () => {
  it("keeps both bone lengths and lands on a reachable target", () => {
    const s: V3 = [0, 1, 0], t: V3 = [0.2, 0.7, -0.3], r = twoBoneIK(s, t, [0.5, -1, 0], UPPER, FORE);
    expect(dist(s, r.elbow)).toBeCloseTo(UPPER, 5); expect(dist(r.elbow, r.wrist)).toBeCloseTo(FORE, 5); expect(dist(r.wrist, t)).toBeLessThan(1e-6); expect(r.stretched).toBe(false);
  });
  it("bows the elbow toward the pole", () => {
    const down = twoBoneIK([0, 1, 0], [0, 1, -0.4], [0, -1, 0], UPPER, FORE).elbow, up = twoBoneIK([0, 1, 0], [0, 1, -0.4], [0, 1, 0], UPPER, FORE).elbow;
    expect(down[1]).toBeLessThan(1); expect(up[1]).toBeGreaterThan(1);
  });
  it("clamps targets that are out of reach (straight arm, no NaN) and degenerate poles", () => {
    const far = twoBoneIK([0, 1, 0], [0, 1, -3], [0, -1, 0], UPPER, FORE);
    expect(far.stretched).toBe(true); expect(dist(far.wrist, [0, 1, 0])).toBeLessThanOrEqual(UPPER + FORE); expect(far.elbow.every(Number.isFinite)).toBe(true);
    expect(twoBoneIK([0, 1, 0], [0, 0.5, 0], [0, -1, 0], UPPER, FORE).elbow.every(Number.isFinite)).toBe(true); // pole parallel to the chain
    expect(twoBoneIK([0, 1, 0], [0, 1, 0], [1, 0, 0], UPPER, FORE).elbow.every(Number.isFinite)).toBe(true); // target on the shoulder
  });
});

describe("arm pose", () => {
  it("reaches every square from both sides without overstretching, leaning in for far ones", () => {
    for (const side of [1, -1] as const) for (const hand of ["L", "R"] as const) for (const [u, v] of [[0.5, 0.5], [7.5, 0.5], [0.5, 7.5], [7.5, 7.5], [4, 4]]) {
      const [x, , z] = boardToWorld(u, v), a = armPose({ side, hand, tip: [x, TABLE_Y + 0.07, z], grasp: 0, active: true });
      expect(a.stretched, `${side}${hand} ${u},${v}`).toBe(false);
      expect(dist(a.shoulder, a.elbow)).toBeCloseTo(UPPER, 4); expect(dist(a.elbow, a.wrist)).toBeCloseTo(FORE, 4);
      const tips = a.capsules.slice(3, 7).map((c) => c.b); // finger tips come down near the target
      expect(Math.min(...tips.map((t) => dist(t, [x, TABLE_Y + 0.07, z])))).toBeLessThan(0.07);
    }
  });
  it("curls the fingers when gripping and keeps the idle hand off the board", () => {
    const tip: V3 = [0, TABLE_Y + 0.1, 0], open = armPose({ side: 1, hand: "R", tip, grasp: 0, active: true }), grip = armPose({ side: 1, hand: "R", tip, grasp: 1, active: true });
    expect(grip.capsules[4].b[1]).toBeLessThan(open.capsules[4].b[1]);
    const idle = armPose({ side: 1, hand: "L", tip: restTarget(1, "L"), grasp: 0, active: false });
    expect(idle.wrist[2]).toBeGreaterThan(0.3); // beyond the board's near edge (0.23)
  });
});

describe("virtual table arms", () => {
  it("glides toward the piece instead of teleporting, uses the near arm, and comes from the mover's side", () => {
    const t = new VirtualTable(); t.play("Nf3", 1000); t.tick(1000);
    expect(t.side).toBe(1); expect(t.activeHand).toBe("R"); // g1 is right of centre
    const first = [...t.visual!.p] as V3; t.tick(1066); const second = [...t.visual!.p] as V3;
    expect(dist(first, second)).toBeGreaterThan(0); expect(dist(second, t.handTarget()!.p)).toBeGreaterThan(0); // moving, not there yet
    t.tick(1500); t.tick(1900); t.tick(2500); t.tick(2900);
    for (let n = 3000; n < 5000; n += 66) t.tick(n);
    expect(t.visual).toBeNull(); expect(t.arms()).toEqual([]); // arms retire once the hand is gone
    t.play("Nc6", 6000); t.tick(6000);
    expect(t.side).toBe(-1); expect(t.arms()[0].shoulder[2]).toBeLessThan(0); // black reaches in from the far end
    expect(t.arms()[0].shoulder[0]).toBeLessThan(0); // black's right arm is on -x
  });
  it("hides forearms on request, leaving only the hands", () => {
    const t = new VirtualTable(); t.hand = { x: 4, y: 4 };
    const full = t.scene3d().capsules!.length; t.forearms = false;
    expect(t.scene3d().capsules!.length).toBe(full - 4);
  });
});

describe("occlusion and shadows in the virtual camera", () => {
  const scene = (c: Scene3D["capsules"]): Scene3D => ({ pieces: [], blobs: [], capsules: c });
  const opts = (shadows = false) => ({ width: 160, height: 120, rig: RIGS.A, noise: 0, shadows });
  it("a forearm hides the board squares behind it from the camera", () => {
    const [x, , z] = boardToWorld(4, 4), y = TABLE_Y + 0.12;
    const clean = renderLuminance(scene([]), opts()), cover = renderLuminance(scene([{ a: [x - 0.05, y, z], b: [x + 0.05, y, z], r: 0.04, tone: 185 }]), opts());
    const p = rigProject({ ...RIGS.A }, [x, y, z]), i = Math.round(p.y * (120 / 360)) * 160 + Math.round(p.x * (160 / 480));
    expect(clean[i]).not.toBe(185); expect(cover[i]).toBeGreaterThan(150);
  });
  it("capsule ray hits the body and the end caps, and misses cleanly", () => {
    const c = { a: [0, 0, 0] as V3, b: [1, 0, 0] as V3, r: 0.1, tone: 1 };
    expect(rayCapsule(0.5, 1, 0, [0, -1, 0], c)!.t).toBeCloseTo(0.9, 5);
    expect(rayCapsule(-1, 0, 0, [1, 0, 0], c)!.t).toBeCloseTo(0.9, 5); // end cap
    expect(rayCapsule(0.5, 1, 1, [0, -1, 0], c)).toBeNull(); expect(rayCapsule(0.5, 1, 0, [1, 0, 0], c)).toBeNull();
  });
  it("shadows fall away from the lamp, and are only drawn when asked for", () => {
    const cap = { a: [0, TABLE_Y + 0.2, 0] as V3, b: [0.1, TABLE_Y + 0.2, 0] as V3, r: 0.03, tone: 1 };
    const m = buildShadowMask([cap], TABLE_Y);
    // the lamp is at (-0.3, 2.1, 0.4): the shadow is pushed toward +x / -z of the object, never toward the lamp
    expect(shadowAt(m, 0.1, -0.07)).toBeGreaterThan(0.5); expect(shadowAt(m, -0.4, 0.4)).toBe(0);
    expect(shadowAt(m, 5, 5)).toBe(0);
    const [x, , z] = boardToWorld(4, 4), sc = scene([{ a: [x - 0.03, TABLE_Y + 0.15, z], b: [x + 0.03, TABLE_Y + 0.15, z], r: 0.03, tone: 150 }]);
    const off = applySensor(renderLuminance(sc, opts(false)), opts(false)).data, on = applySensor(renderLuminance(sc, opts(true)), opts(true)).data;
    let darker = 0; for (let i = 0; i < off.length; i++) if (on[i] < off[i] - 5) darker++;
    expect(darker).toBeGreaterThan(20);
  });
});
