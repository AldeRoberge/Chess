import { describe, expect, it, vi } from "vitest";
import { node } from "../test/helpers";
import { cameraMatrix, project } from "../vision/triangulate";
import { TABLE_Y, boardToWorld } from "../world/coords";

const mp = vi.hoisted(() => ({ detect: (_c: unknown): { landmarks: any[] } => ({ landmarks: [] }), fail: false, closed: 0 }));
vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: { forVisionTasks: async () => { if (mp.fail) throw new Error("no model"); return {}; } },
  HandLandmarker: { createFromOptions: async () => ({ detect: (c: unknown) => mp.detect(c), close: () => { mp.closed++; } }) },
}));

const cams = ["-1.6,2.2,1.6;0,0.75,0;60", "1.6,2.2,1.6;0,0.75,0;60"].map((s) => { const [p, t, f] = s.split(";"); return cameraMatrix(p.split(",").map(Number) as any, t.split(",").map(Number) as any, Number(f), 480, 360); });
const frame = { width: 480, height: 360, data: new Uint8ClampedArray(480 * 360).fill(90), t: 0 };
/** 21 hand landmarks with the index tip (8) and thumb tip (4) where a fingertip at `w` and a thumb `gap` metres beside it would appear */
const hand = (P: number[], w: [number, number, number], gap: number) => {
  const l = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
  const i = project(P, w), t = project(P, [w[0] + gap, w[1], w[2]]);
  l[8] = { x: i.x / 480, y: i.y / 360 }; l[4] = { x: t.x / 480, y: t.y / 360 };
  return l;
};
const tick = () => new Promise((r) => setTimeout(r, 0));
const runAll = async (n: ReturnType<typeof node>, inputs: Record<string, any>, rounds = 8) => { let out: any, clock = 0; for (let i = 0; i < rounds; i++) { out = n.run(inputs, (clock += 100)); await tick(); } return out; };

describe("tracking.hands with the model running", () => {
  it("loads the model, triangulates the fingertip from two cameras, and closes the model on dispose", async () => {
    const [x, , z] = boardToWorld(3.5, 5.5), w: [number, number, number] = [x, TABLE_Y + 0.01, z];
    let call = 0; mp.detect = () => ({ landmarks: [hand(cams[call++ % 2], w, 0.02)] });
    const n = node("tracking.hands", { enabled: true });
    const out = await runAll(n, { f1: frame, f2: frame });
    expect(out.pointers).toHaveLength(1);
    expect(out.pointers[0]).toMatchObject({ id: "index" });
    expect(out.pointers[0].x).toBeCloseTo(3.5, 1); expect(out.pointers[0].y).toBeCloseTo(5.5, 1);
    expect(out.pointers[0].z).toBeCloseTo(0.01, 2); expect(out.pointers[0].pinch).toBeCloseTo(0.02, 2);
    expect(n.h.fidelity).toBe(1);
    n.dispose(); expect(mp.closed).toBe(1);
  });
  it("outputs nothing when no hand is seen or only one camera sees it", async () => {
    mp.detect = () => ({ landmarks: [] });
    const n = node("tracking.hands", { enabled: true });
    expect((await runAll(n, { f1: frame, f2: frame })).pointers).toEqual([]);
    expect(n.h.fidelity).toBe(0);
    mp.detect = () => ({ landmarks: [hand(cams[0], [0, TABLE_Y, 0], 0.02)] });
    const one = node("tracking.hands", { enabled: true });
    expect((await runAll(one, { f1: frame })).pointers).toEqual([]);
  });
  it("retries later when the model fails to load, and keeps the node alive", async () => {
    mp.fail = true;
    const n = node("tracking.hands", { enabled: true });
    expect((await runAll(n, { f1: frame, f2: frame })).pointers).toEqual([]);
    mp.fail = false;
  });
});
