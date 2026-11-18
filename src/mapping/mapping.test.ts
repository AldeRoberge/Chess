import { describe, expect, it } from "vitest";
import { applyH, solveHomography } from "../vision/homography";
import { cameraMatrix, project, rayToPlane, triangulate } from "../vision/triangulate";
import type { GrayFrame } from "../vision/types";
import { calibrate, detectDot, dotGrid, quadFromLit } from "./autocal";
import { extractSurfaces } from "./planes";
import { blendShares } from "./projector";

describe("room scan -> surfaces", () => {
  it("finds floor, ceiling and walls in a box point cloud", () => {
    const pts: number[] = [];
    const W = 4, H = 2.5, D = 5;
    for (let i = 0; i < 25; i++) for (let j = 0; j < 25; j++) {
      const a = (i / 24) * W, b = (j / 24) * D, c = (j / 24) * H;
      pts.push(a, 0, b); pts.push(a, H, b); // floor, ceiling
      pts.push(0, c, (i / 24) * D); pts.push(W, c, (i / 24) * D); // side walls
      pts.push(a, c, 0); pts.push(a, c, D); // front/back
    }
    const s = extractSurfaces(new Float32Array(pts), { minInliers: 300, maxPlanes: 8 });
    const kinds = s.map((x) => x.kind);
    expect(kinds).toContain("floor");
    expect(kinds).toContain("ceiling");
    expect(kinds.filter((k) => k === "wall").length).toBe(4);
    const floor = s.find((x) => x.kind === "floor")!;
    expect(floor.halfW * floor.halfH).toBeGreaterThan(0.75 * (W * D) / 4);
  });
});

describe("projector auto-calibration", () => {
  const frame = (w: number, h: number, f: (x: number, y: number) => number): GrayFrame => {
    const d = new Uint8ClampedArray(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = f(x, y);
    return { width: w, height: h, data: d, t: 0 };
  };
  it("recovers camera->projector from dots seen through a known warp, ignoring a bad hit", () => {
    const truth = solveHomography([{ x: 0, y: 0 }, { x: 640, y: 0 }, { x: 640, y: 480 }, { x: 0, y: 480 }], [{ x: 70, y: 40 }, { x: 590, y: 70 }, { x: 560, y: 430 }, { x: 40, y: 400 }]); // projector px -> camera px
    const dark = frame(640, 480, () => 5);
    const hits = dotGrid(640, 480).map((p) => {
      const c = applyH(truth, p.x, p.y);
      const lit = frame(640, 480, (x, y) => (Math.hypot(x - c.x, y - c.y) < 4 ? 220 : 5));
      return { proj: p, cam: detectDot(dark, lit)!.pt };
    });
    hits[3] = { ...hits[3], cam: { x: hits[3].cam.x + 60, y: hits[3].cam.y - 40 } }; // outlier
    const r = calibrate(hits);
    expect(r.rmsError).toBeLessThan(2);
    expect(r.used).toBeLessThan(20);
    const probe = applyH(truth, 320, 240);
    const back = applyH(r.camToProj, probe.x, probe.y);
    expect(Math.hypot(back.x - 320, back.y - 240)).toBeLessThan(2);
  });
  it("finds the lit table quad", () => {
    const dark = frame(100, 100, () => 0);
    const lit = frame(100, 100, (x, y) => (x > 20 && x < 80 && y > 30 && y < 70 ? 200 : 0));
    const q = quadFromLit(dark, lit)!;
    expect(q[0].x).toBeLessThanOrEqual(31); expect(q[2].x).toBeGreaterThanOrEqual(70);
  });
});

describe("projector blending", () => {
  it("shares sum to ~1 in linear light across an overlap and a single projector gets everything", () => {
    const mk = (id: string, x: number) => ({ id, pos: [x, 1.5, -3] as [number, number, number], target: [x, 1.5, 0] as [number, number, number], fovY: 40, aspect: 1.6 });
    const projs = [mk("a", -0.6), mk("b", 0.6)];
    const mid = blendShares(projs, [0, 1.5, 0]).map((s) => Math.pow(s, 2.2));
    expect(mid[0] + mid[1]).toBeCloseTo(1, 5);
    expect(blendShares(projs, [-1.7, 1.5, 0])[0]).toBeGreaterThan(0.99);
  });
});

describe("3D pose placement", () => {
  it("triangulates a joint from two cameras and from the floor ray of one", () => {
    const A = cameraMatrix([-3, 2, -3], [0, 1, 0], 60, 640, 480), B = cameraMatrix([3, 2, -3], [0, 1, 0], 60, 640, 480);
    const X: [number, number, number] = [0.4, 1.2, 0.3];
    const t = triangulate([A, B], [project(A, X), project(B, X)])!;
    expect(Math.hypot(t[0] - X[0], t[1] - X[1], t[2] - X[2])).toBeLessThan(1e-6);
    const foot: [number, number, number] = [0.5, 0, 0.8];
    const g = rayToPlane([-3, 2, -3], A, project(A, foot), 0)!;
    expect(Math.hypot(g[0] - foot[0], g[2] - foot[2])).toBeLessThan(1e-6);
  });
});

import { runCalibration } from "./calibrator";
describe("calibration runner", () => {
  it("drives the projector through black/white/dots and solves, skipping unseen dots", async () => {
    const truth = solveHomography([{ x: 0, y: 0 }, { x: 1280, y: 0 }, { x: 1280, y: 720 }, { x: 0, y: 720 }], [{ x: 80, y: 60 }, { x: 560, y: 50 }, { x: 540, y: 400 }, { x: 100, y: 420 }]);
    let cmd: any = { kind: "black" };
    const make = (f: (x: number, y: number) => number): GrayFrame => { const d = new Uint8ClampedArray(640 * 480); for (let y = 0; y < 480; y++) for (let x = 0; x < 640; x++) d[y * 640 + x] = f(x, y); return { width: 640, height: 480, data: d, t: 0 }; };
    const io = {
      show: (c: any) => { cmd = c; },
      grab: async () => {
        if (cmd.kind === "black") return make(() => 4);
        if (cmd.kind === "white") return make((x, y) => (x > 80 && x < 560 && y > 55 && y < 410 ? 200 : 4));
        const c = applyH(truth, cmd.x, cmd.y);
        if (cmd.x < 200 && cmd.y < 100) return make(() => 4); // dot hidden behind an obstacle
        return make((x, y) => (Math.hypot(x - c.x, y - c.y) < 4 ? 230 : 4));
      },
    };
    const out = await runCalibration(io, { w: 1280, h: 720 });
    expect(out.missed).toBeGreaterThan(0);
    expect(out.result!.rmsError).toBeLessThan(2);
    expect(out.footprint![0].x).toBeLessThan(90);
  });
});
