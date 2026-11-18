import { afterEach, describe, expect, it, vi } from "vitest";
import { applyH, solveHomography } from "../vision/homography";
import type { GrayFrame } from "../vision/types";
import { calibrate, detectDot, dotGrid, fitHomography, quadFromLit } from "./autocal";
import { runCalibration } from "./calibrator";
import { defaultPlaneOpts, extractSurfaces } from "./planes";
import { blendShares, edgeWeight, projectToProjector, type ProjectorDef } from "./projector";
import { defaultMapping, defaultRoom, loadMapping, saveMapping } from "./store";
import { drawWarped } from "./warp2d";

const frame = (w: number, h: number, f: (x: number, y: number) => number): GrayFrame => {
  const d = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = f(x, y);
  return { width: w, height: h, data: d, t: 0 };
};

describe("plane extraction", () => {
  const grid = (f: (a: number, b: number) => [number, number, number], n = 25) => { const out: number[] = []; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out.push(...f(i / (n - 1), j / (n - 1))); return out; };
  it("has documented defaults", () => { expect(defaultPlaneOpts()).toMatchObject({ iterations: 300, tol: 0.03, maxPlanes: 12, up: [0, 1, 0] }); });
  it("labels a high horizontal plane as ceiling, low as floor, vertical as wall, and a ramp as other", () => {
    const pts = [...grid((a, b) => [a * 4, 0, b * 5]), ...grid((a, b) => [a * 4, 2.6, b * 5]), ...grid((a, b) => [0, a * 2.5, b * 5]), ...grid((a, b) => [a * 2 + 6, a * 2, b * 2])];
    const kinds = extractSurfaces(new Float32Array(pts), { minInliers: 300, maxPlanes: 6 }).map((s) => s.kind).sort();
    expect(kinds).toEqual(["ceiling", "floor", "other", "wall"]);
  });
  it("accepts plain arrays and stops when no plane has enough support", () => {
    expect(extractSurfaces(grid((a, b) => [a, 0, b], 30), { minInliers: 1000 })).toEqual([]);
    expect(extractSurfaces(grid((a, b) => [a, 0, b], 30), { minInliers: 300 })).toHaveLength(1);
  });
  it("copes with a degenerate (collinear) cloud: no triangles to fit, no planes", () => {
    const line: number[] = []; for (let i = 0; i < 400; i++) line.push(i * 0.01, 0, 0);
    expect(extractSurfaces(line, { minInliers: 100 })).toEqual([]);
  });
  it("is deterministic for a seed and reports oriented extents", () => {
    const pts = grid((a, b) => [a * 4, 0, b * 2]);
    const a = extractSurfaces(pts, { minInliers: 300 }), b = extractSurfaces(pts, { minInliers: 300 });
    expect(a).toEqual(b);
    expect(a[0].halfW * a[0].halfH).toBeCloseTo(2 * 1, 0); expect(a[0].inliers).toBeGreaterThan(300);
  });
  it("respects maxPlanes", () => {
    const pts = [...grid((a, b) => [a * 4, 0, b * 5]), ...grid((a, b) => [a * 4, 2.6, b * 5]), ...grid((a, b) => [0, a * 2.5, b * 5])];
    expect(extractSurfaces(pts, { minInliers: 300, maxPlanes: 2 })).toHaveLength(2);
  });
});

const proj = (id: string, x: number, extra: Partial<ProjectorDef> = {}): ProjectorDef => ({ id, pos: [x, 1.5, -3], target: [x, 1.5, 0], fovY: 40, aspect: 1.6, ...extra });

describe("projector math", () => {
  it("projects the target to the centre of the output and rejects points behind the lens", () => {
    const p = proj("a", 0), c = projectToProjector(p, [0, 1.5, 0])!;
    expect(c.x).toBeCloseTo(0); expect(c.y).toBeCloseTo(0); expect(c.depth).toBeCloseTo(3);
    expect(projectToProjector(p, [0, 1.5, -5])).toBeNull();
    const right = projectToProjector(p, [-0.5, 1.5, 0])!, up = projectToProjector(p, [0, 2, 0])!;
    expect(right.x).toBeGreaterThan(0); expect(up.y).toBeGreaterThan(0);
  });
  it("handles a projector aimed straight down at the table", () => {
    const down = projectToProjector({ id: "t", pos: [0, 2, 0], target: [0, 0, 0], fovY: 40, aspect: 1.6 }, [0, 0, 0])!;
    expect(down.x).toBeCloseTo(0); expect(down.y).toBeCloseTo(0);
    expect(Number.isFinite(projectToProjector({ id: "t", pos: [0, 2, 0], target: [0, 0, 0], fovY: 40, aspect: 1.6 }, [0.2, 0, 0.1])!.x)).toBe(true);
  });
  it("edge weight is 1 deep inside, eases to 0 at the frustum edge, and 0 outside", () => {
    expect(edgeWeight(0, 0)).toBe(1); expect(edgeWeight(1, 0)).toBe(0); expect(edgeWeight(0, -1)).toBe(0); expect(edgeWeight(2, 0)).toBe(0);
    expect(edgeWeight(0.9, 0)).toBeGreaterThan(0); expect(edgeWeight(0.9, 0)).toBeLessThan(1);
    expect(edgeWeight(0.5, 0, 1)).toBeLessThan(1);
  });
  it("blend shares: a single covering projector gets everything; none covering gets zero; overlaps sum to 1 in linear light", () => {
    const projs = [proj("a", -0.6), proj("b", 0.6)];
    expect(blendShares(projs, [-1.7, 1.5, 0])[0]).toBeGreaterThan(0.99);
    expect(blendShares(projs, [40, 1.5, 0])).toEqual([0, 0]);
    expect(blendShares(projs, [0, 1.5, -9])).toEqual([0, 0]); // behind both lenses
    const mid = blendShares(projs, [0, 1.5, 0], 0.25, 2.2).map((s) => s ** 2.2);
    expect(mid[0] + mid[1]).toBeCloseTo(1, 5); expect(mid[0]).toBeCloseTo(mid[1], 5);
  });
});

describe("auto-calibration maths", () => {
  it("lays out an inset grid of dots", () => {
    const g = dotGrid(1000, 500, 3, 2, 0.1);
    expect(g).toHaveLength(6); expect(g[0]).toEqual({ x: 100, y: 50 }); expect(g[5]).toEqual({ x: 900, y: 450 });
    expect(dotGrid(1280, 720)).toHaveLength(20);
  });
  it("finds a dot's centroid, and says nothing when there is no dot", () => {
    const dark = frame(50, 50, () => 5), lit = frame(50, 50, (x, y) => (Math.hypot(x - 20, y - 30) < 3 ? 200 : 5));
    const d = detectDot(dark, lit)!; expect(d.pt.x).toBeCloseTo(20, 0); expect(d.pt.y).toBeCloseTo(30, 0); expect(d.strength).toBeGreaterThan(100);
    expect(detectDot(dark, dark)).toBeNull();
    expect(detectDot(dark, frame(50, 50, (x, y) => (x === 3 && y === 3 ? 255 : 5)))).toBeNull(); // a single hot pixel is noise
  });
  it("fits with 4 points exactly and overdetermined sets by least squares; refuses fewer than 4", () => {
    const src = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], dst = src.map((p) => ({ x: p.x * 2 + 5, y: p.y * 3 + 1 }));
    const H4 = fitHomography(src, dst); expect(applyH(H4, 5, 5).x).toBeCloseTo(15, 5);
    const many = [...src, { x: 5, y: 5 }, { x: 3, y: 8 }], dstMany = many.map((p) => ({ x: p.x * 2 + 5, y: p.y * 3 + 1 }));
    const H = fitHomography(many, dstMany); expect(applyH(H, 7, 2).y).toBeCloseTo(7, 4);
    expect(() => fitHomography(src.slice(0, 3), dst.slice(0, 3))).toThrow("need >= 4");
  });
  it("calibrate keeps the points when the fit is already good, and drops outliers one by one otherwise (never below 6)", () => {
    const truth = solveHomography([{ x: 0, y: 0 }, { x: 640, y: 0 }, { x: 640, y: 480 }, { x: 0, y: 480 }], [{ x: 70, y: 40 }, { x: 590, y: 70 }, { x: 560, y: 430 }, { x: 40, y: 400 }]);
    const hits = dotGrid(640, 480).map((p) => ({ proj: p, cam: applyH(truth, p.x, p.y) }));
    expect(calibrate(hits).used).toBe(20);
    const bad = hits.map((h, i) => (i % 2 ? { ...h, cam: { x: h.cam.x + 80 * Math.sin(i), y: h.cam.y - 60 * Math.cos(i) } } : h));
    const r = calibrate(bad); expect(r.used).toBeGreaterThanOrEqual(6); expect(r.used).toBeLessThan(20);
    expect(applyH(r.projToCam, 100, 100)).toBeTruthy();
  });
  it("quadFromLit returns the four extremes of the lit region, or null if nothing is lit", () => {
    const dark = frame(80, 60, () => 0), lit = frame(80, 60, (x, y) => (x > 10 && x < 60 && y > 10 && y < 50 ? 200 : 0));
    const q = quadFromLit(dark, lit)!;
    expect(q[0].x).toBeLessThanOrEqual(12); expect(q[2].x).toBeGreaterThanOrEqual(58); expect(q[1].y).toBeLessThanOrEqual(12); expect(q[3].y).toBeGreaterThanOrEqual(48);
    expect(quadFromLit(dark, dark)).toBeNull();
  });
});

describe("calibration runner", () => {
  const dark = frame(640, 480, () => 4);
  const make = (grab: () => Promise<GrayFrame | null>, shown: any[] = []) => ({ show: (c: any) => shown.push(c), grab });
  it("gives up cleanly when the camera never delivers a frame", async () => {
    const out = await runCalibration(make(async () => null), { w: 1280, h: 720 });
    expect(out).toEqual({ result: null, footprint: null, hits: 0, missed: 0 });
  });
  it("copes with a missing white frame (no footprint) and reports too few dots as a failed solve", async () => {
    let n = 0; const shown: any[] = [], progress: number[] = [];
    const io = make(async () => (n++ === 0 ? dark : null), shown);
    const out = await runCalibration(io, { w: 1280, h: 720 }, (p) => progress.push(p));
    expect(out.footprint).toBeNull(); expect(out.result).toBeNull(); expect(out.hits).toBe(0); expect(out.missed).toBe(20);
    expect(progress.at(-1)).toBe(1); expect(shown[0]).toEqual({ kind: "black" }); expect(shown[1]).toEqual({ kind: "white" }); expect(shown.at(-1)).toEqual({ kind: "black" });
  });
  it("uses a no-op progress callback by default", async () => { await expect(runCalibration(make(async () => dark), { w: 100, h: 100 })).resolves.toMatchObject({ result: null }); });
});

describe("mapping store", () => {
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });
  it("builds a six-surface default room and a three-projector rig", () => {
    expect(defaultRoom().map((s) => s.id).sort()).toEqual(["ceiling", "floor", "wall-back", "wall-front", "wall-left", "wall-right"]);
    const m = defaultMapping(); expect(m.projectors).toHaveLength(3); expect(m.feather).toBe(0.25); expect(m.gamma).toBe(2.2); expect(m.calibration).toEqual({});
  });
  it("round-trips through localStorage and merges new defaults into old saves", () => {
    expect(loadMapping().projectors).toHaveLength(3);
    const m = defaultMapping(); m.feather = 0.4; saveMapping(m);
    expect(loadMapping().feather).toBe(0.4);
    localStorage.setItem("cx.mapping.v1", JSON.stringify({ gamma: 1.8 }));
    const merged = loadMapping(); expect(merged.gamma).toBe(1.8); expect(merged.surfaces).toHaveLength(6);
  });
  it("falls back to defaults on corrupt JSON and survives storage that throws", () => {
    localStorage.setItem("cx.mapping.v1", "{not json");
    expect(loadMapping().projectors).toHaveLength(3);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(() => saveMapping(defaultMapping())).not.toThrow();
  });
});

describe("drawWarped", () => {
  it("draws two triangles per mesh cell, mapping through the homography, and skips degenerate source triangles", () => {
    const ctx = document.createElement("canvas").getContext("2d")!, src = document.createElement("canvas");
    const spy = vi.spyOn(ctx, "drawImage");
    const H = solveHomography([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], [{ x: 10, y: 10 }, { x: 90, y: 20 }, { x: 80, y: 95 }, { x: 5, y: 70 }]);
    drawWarped(ctx, src, 100, 100, H, 4);
    expect(spy).toHaveBeenCalledTimes(4 * 4 * 2);
    spy.mockClear();
    drawWarped(ctx, src, 100, 100, H);
    expect(spy).toHaveBeenCalledTimes(12 * 12 * 2);
    spy.mockClear();
    drawWarped(ctx, src, 0, 100, H, 2); // zero-width source: nothing to draw
    expect(spy).not.toHaveBeenCalled();
  });
});
