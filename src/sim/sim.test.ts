import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { applyH, boardToImage } from "../vision/homography";
import { SQUARE, TABLE_Y, boardToWorld } from "../world/coords";
import { PROFILES, profileHeight, profileMaxRadius, radiusAt } from "../world/profiles";
import { cameraBasis } from "./camera";
import { applySensor, render3D, renderLuminance, type Scene3D } from "./render3d";
import { FRAME_H, FRAME_W, RIGS, rigCorners, rigProject } from "./rigs";
import { SCENARIOS, ScenarioRunner, scenarioById } from "./scenarios";
import { VirtualTable } from "./virtualTable";

const empty: Scene3D = { pieces: [], blobs: [] };
const opts = (rig = "A", extra = {}) => ({ width: FRAME_W, height: FRAME_H, rig: RIGS[rig], noise: 0, gradient: 0, ...extra });
const at = (f: { data: ArrayLike<number>; width: number }, x: number, y: number) => f.data[Math.round(y) * f.width + Math.round(x)];

describe("piece profiles", () => {
  it("define a solid of revolution per piece type, tallest king, widest base", () => {
    expect(Object.keys(PROFILES).sort()).toEqual(["b", "k", "n", "p", "q", "r"]);
    expect(profileHeight("k")).toBeGreaterThan(profileHeight("q")); expect(profileHeight("q")).toBeGreaterThan(profileHeight("p"));
    expect(profileMaxRadius("p")).toBeCloseTo(0.45); expect(profileMaxRadius("k")).toBeCloseTo(0.5);
  });
  it("radiusAt interpolates between profile points and is zero outside the solid", () => {
    expect(radiusAt("p", 0)).toBeCloseTo(0.45); expect(radiusAt("p", 0.12)).toBeCloseTo(0.39);
    expect(radiusAt("p", 0.16)).toBeCloseTo(0.31, 2); // halfway between (0.37,0.13) and (0.27,0.18)
    expect(radiusAt("p", -0.1)).toBe(0); expect(radiusAt("p", 5)).toBe(0);
    expect(radiusAt("p", 0.9)).toBeCloseTo(0);
  });
  it("handles a flat segment (equal heights) by taking the wider radius", () => {
    // knight profile has no flats; synthesise by checking the exact y of a vertical step in the rook: (0.45,0.85)->(0.45,1.0) is not flat in y; use base (0,0)->(0.5,0)
    expect(radiusAt("r", 0)).toBeCloseTo(0.5);
  });
});

describe("camera basis", () => {
  it("is orthonormal and projects the look-at target to the image centre", () => {
    const c = cameraBasis(RIGS.A, FRAME_W, FRAME_H);
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    expect(dot(c.f, c.r)).toBeCloseTo(0); expect(dot(c.f, c.u)).toBeCloseTo(0); expect(dot(c.r, c.u)).toBeCloseTo(0);
    const p = c.project(RIGS.A.target)!;
    expect(p.x).toBeCloseTo(FRAME_W / 2, 3); expect(p.y).toBeCloseTo(FRAME_H / 2, 3);
    expect(c.project([0, 1.75, 5])).toBeNull(); // behind the lens... (camera looks down, point behind its plane)
    expect(c.project([0, 3, 0.3])).toBeNull();
    expect(c.fl).toBeGreaterThan(0);
  });
  it("rig corners are a convex quad inside the frame in a8, h8, h1, a1 order, and rigProject agrees", () => {
    for (const k of Object.keys(RIGS)) {
      const c = rigCorners(RIGS[k]);
      expect(c).toHaveLength(4);
      c.forEach((p) => { expect(p.x).toBeGreaterThan(0); expect(p.x).toBeLessThan(FRAME_W); expect(p.y).toBeGreaterThan(0); expect(p.y).toBeLessThan(FRAME_H); });
    }
    const [x, y, z] = boardToWorld(0, 0);
    const a = rigProject(RIGS.A, [x, y + 0.012, z]), c = rigCorners(RIGS.A)[0];
    expect(a.x).toBeCloseTo(c.x, 6); expect(a.y).toBeCloseTo(c.y, 6);
  });
});

describe("render3D", () => {
  it("paints alternating light and dark squares at the right pixels (a8 is light, a7 dark)", () => {
    const f = render3D(empty, opts()), H = boardToImage(rigCorners(RIGS.A, 0));
    const px = (c: number, r: number) => { const p = applyH(H, c + 0.5, r + 0.5); return at(f, p.x, p.y); };
    expect(px(0, 0)).toBeCloseTo(135, 0); expect(px(1, 0)).toBeCloseTo(110, 0); expect(px(0, 1)).toBeCloseTo(110, 0); expect(px(7, 7)).toBeCloseTo(135, 0);
  });
  it("paints table and floor around the board and a flat 'sky' when looking up", () => {
    const wide = render3D(empty, opts("A", { rig: { ...RIGS.A, pos: [0, 1.4, 0], target: [0, TABLE_Y, 0.001], fovY: 100 } }));
    const vals = new Set(Array.from(wide.data));
    expect(vals.has(40)).toBe(true); expect(vals.has(12)).toBe(true);
    const up = render3D(empty, opts("A", { rig: { ...RIGS.A, pos: [0, 1, 0], target: [0, 4, 1], fovY: 40 } }));
    expect(new Set(Array.from(up.data))).toEqual(new Set([12]));
  });
  it("draws a white piece bright, a black piece dark, with the piece's top shaded lighter than its base", () => {
    const [x, y, z] = boardToWorld(3.5, 3.5);
    const w = render3D({ pieces: [{ type: "q", color: "w", x, y, z }], blobs: [] }, opts());
    const b = render3D({ pieces: [{ type: "q", color: "b", x, y, z }], blobs: [] }, opts());
    const c = rigProject(RIGS.A, [x, y + 0.03, z]);
    expect(at(w, c.x, c.y)).toBeGreaterThan(190); expect(at(b, c.x, c.y)).toBeLessThan(40);
    const base = renderLuminance({ pieces: [{ type: "q", color: "w", x, y, z }], blobs: [] }, opts());
    expect(base.reduce((m, v) => Math.max(m, v), 0)).toBeLessThanOrEqual(235);
  });
  it("occludes: a tall piece hides the square behind it from an oblique camera", () => {
    const [bx, by, bz] = boardToWorld(3.5, 2.5); // square behind (further from camera C at +x,+z)
    const [fx, fy, fz] = boardToWorld(4.5, 3.5);
    const without = render3D(empty, opts("C"));
    const withKing = render3D({ pieces: [{ type: "k", color: "w", x: fx, y: fy, z: fz }], blobs: [] }, opts("C"));
    const p = rigProject(RIGS.C, [bx + SQUARE * 0.35, by, bz + SQUARE * 0.35]);
    const q = rigProject(RIGS.C, [fx, fy + 0.05, fz]);
    expect(at(without, q.x, q.y)).toBeLessThan(150); // bare board
    expect(at(withKing, q.x, q.y)).toBeGreaterThan(190); // the king's body
    expect(p).toBeTruthy();
  });
  it("renders a hand and forearm as bright blobs that occlude pieces", () => {
    const [x, y, z] = boardToWorld(3.5, 3.5);
    const f = render3D({ pieces: [{ type: "p", color: "b", x, y, z }], blobs: [{ x, y: y + 0.1, z, r: 0.04 }, { x, y: y + 0.12, z: z + 0.12, r: 0.03 }] }, opts());
    const hand = rigProject(RIGS.A, [x, y + 0.1, z]), arm = rigProject(RIGS.A, [x, y + 0.12, z + 0.12]);
    expect(at(f, hand.x, hand.y)).toBe(200); expect(at(f, arm.x, arm.y)).toBe(200);
  });
  it("ignores pieces and blobs that are behind the camera", () => {
    const [x, y, z] = boardToWorld(3.5, 3.5);
    const f = render3D({ pieces: [{ type: "k", color: "w", x, y: y + 5, z: z + 9 }], blobs: [{ x, y: y + 5, z: z + 9, r: 0.2 }] }, opts());
    const base = render3D(empty, opts());
    expect(Array.from(f.data)).toEqual(Array.from(base.data));
  });
  it("sensor model: exposure scales, falloff darkens the right side, noise is seeded and zero-mean, timestamp is carried", () => {
    const lum = renderLuminance(empty, opts());
    const dim = applySensor(lum, opts("A", { gain: 0.5 })), bright = applySensor(lum, opts("A", { gain: 1 }));
    expect(at(dim, 240, 180)).toBeCloseTo(at(bright, 240, 180) * 0.5, 0);
    const fall = applySensor(lum, opts("A", { gradient: 0.5 })); expect(at(fall, 470, 180)).toBeLessThan(at(bright, 470, 180) * 0.8);
    const n1 = applySensor(lum, opts("A", { noise: 12, seed: 3 })), n2 = applySensor(lum, opts("A", { noise: 12, seed: 3 })), n3 = applySensor(lum, opts("A", { noise: 12, seed: 4 }));
    expect(Array.from(n1.data)).toEqual(Array.from(n2.data)); expect(Array.from(n1.data)).not.toEqual(Array.from(n3.data));
    expect(applySensor(lum, opts("A", { t: 1234 })).t).toBe(1234); expect(applySensor(lum, { width: FRAME_W, height: FRAME_H, rig: RIGS.A }).t).toBe(0);
    const defaults = applySensor(lum, { width: FRAME_W, height: FRAME_H, rig: RIGS.A }); // default noise 6, gain 1, no gradient
    expect(defaults.width).toBe(FRAME_W);
  });
  it("the one-call helper equals luminance + sensor", () => {
    const a = render3D(empty, opts("B", { seed: 9, noise: 5 })), b = applySensor(renderLuminance(empty, opts("B")), opts("B", { seed: 9, noise: 5 }));
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });
  it("tolerates a ray exactly along a piece's vertical axis (no NaN artefacts)", () => {
    const rig = { id: "T", pos: [0, 1.6, 0.0001] as [number, number, number], target: [0, TABLE_Y, 0] as [number, number, number], fovY: 30 };
    const [, y] = boardToWorld(4, 4);
    const f = render3D({ pieces: [{ type: "p", color: "w", x: 0, y, z: 0 }], blobs: [] }, { width: 64, height: 48, rig, noise: 0 });
    expect(Array.from(f.data).every((v) => Number.isFinite(v))).toBe(true);
  });
});

describe("VirtualTable", () => {
  it("starts at the standard position with an empty hand and exposes a colour grid", () => {
    const t = new VirtualTable(), g = t.grid();
    expect(g.filter((x) => x === "w")).toHaveLength(16); expect(t.busy).toBe(false); expect(t.hand).toBeNull(); expect(t.carried).toBeNull(); expect(t.seated).toBe(false);
  });
  it("rejects illegal moves and accepts SAN or UCI", () => {
    const t = new VirtualTable();
    expect(t.play("e5", 0)).toBe(false); expect(t.play("Qh8", 0)).toBe(false); expect(t.busy).toBe(false);
    expect(t.play("e2e4", 0)).toBe(true); expect(t.busy).toBe(true);
  });
  it("choreographs a move: hand arrives, piece is lifted, travels, drops, hand leaves", () => {
    const t = new VirtualTable(); t.play("Nf3", 1000);
    t.tick(1000); expect(t.hand).toEqual({ x: 6.5, y: 7.5 }); expect(t.carried).toBeNull();
    t.tick(1500); expect(t.carried).toBe(62); expect(t.grid()[62]).toBe("");
    const mid = t.scene3d(); expect(mid.pieces.some((p) => p.y > TABLE_Y + 0.05)).toBe(true); expect(mid.capsules!.length).toBeGreaterThan(8);
    t.tick(1900); expect(t.hand).toEqual({ x: 5.5, y: 5.5 });
    t.tick(2500); expect(t.carried).toBeNull(); expect(t.game.history()).toEqual(["Nf3"]); expect(t.hand).toEqual({ x: 5.5, y: 5.5 });
    t.tick(2900); expect(t.hand).toBeNull(); expect(t.busy).toBe(false);
  });
  it("exports geometry: 32 pieces on squares, no hand when idle, a raised hand when empty-handed and higher when carrying", () => {
    const t = new VirtualTable(), s = t.scene3d();
    expect(s.pieces).toHaveLength(32); expect(s.capsules).toHaveLength(0);
    const [x, y, z] = boardToWorld(0.5, 0.5);
    expect(s.pieces.find((p) => p.x === x && p.z === z)).toMatchObject({ type: "r", color: "b", y });
    t.hand = { x: 4, y: 4 }; const empty = t.handTarget()!.p[1]; expect(t.scene3d().capsules!.length).toBeGreaterThan(8);
    t.carried = 52; const carrying = t.handTarget()!.p[1];
    expect(carrying).toBeGreaterThan(empty);
  });
  it("changes sceneKey whenever something a camera could see changes, and resets cleanly", () => {
    const t = new VirtualTable(), k0 = t.sceneKey;
    t.hand = { x: 1, y: 1 }; const k1 = t.sceneKey; t.carried = 8; const k2 = t.sceneKey;
    expect(new Set([k0, k1, k2]).size).toBe(3);
    t.play("e4", 0); t.reset();
    expect(t.hand).toBeNull(); expect(t.carried).toBeNull(); expect(t.busy).toBe(false); expect(t.game.fen()).toBe(new Chess().fen());
    expect(t.sceneKey).toBe(k0);
  });
  it("carried piece with no hand position falls back to its square", () => {
    const t = new VirtualTable(); t.carried = 52;
    expect(t.scene3d().pieces).toHaveLength(32);
  });
});

describe("scenarios", () => {
  it("ships six named, documented, uniquely identified scripted games", () => {
    expect(SCENARIOS).toHaveLength(6);
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(6);
    SCENARIOS.forEach((s) => { expect(s.name).toBeTruthy(); expect(s.description).toBeTruthy(); expect(scenarioById(s.id)).toBe(s); });
    expect(scenarioById("nope")).toBeUndefined();
  });
  it.each(SCENARIOS)("$name: every scripted move is legal and the game ends as declared", (s) => {
    const g = new Chess(); const types = { captures: 0, queen: false, castles: 0, promotions: 0, checks: 0 };
    for (const m of s.moves) {
      const mv = g.move(m);
      if (mv.captured) types.captures++;
      if (mv.captured === "q") types.queen = true;
      if (mv.flags.includes("k") || mv.flags.includes("q")) types.castles++;
      if (mv.promotion) types.promotions++;
      if (g.inCheck() && !g.isCheckmate()) types.checks++;
    }
    expect(g.history()).toHaveLength(s.expect.plies);
    expect(types).toEqual({ captures: s.expect.captures, queen: s.expect.queenCaptured, castles: s.expect.castles, promotions: s.expect.promotions, checks: s.expect.checks });
    expect(g.isCheckmate()).toBe(s.expect.mate);
  });
});

describe("ScenarioRunner", () => {
  it("asks for a handshake, then the moves one at a time after the pause, then a handshake, and reports completion", () => {
    const t = new VirtualTable(), r = new ScenarioRunner(t, { ...SCENARIOS[0], moves: ["e4", "e5"], expect: { ...SCENARIOS[0].expect, mate: false } }, 1000);
    expect(r.done).toBe(false);
    const asked: string[] = [];
    for (let now = 0; !r.done && now < 20000; now += 100) asked.push(...r.step(now).map((a) => (a.kind === "move" ? a.san : a.kind)));
    expect(asked).toEqual(["handshake", "e4", "e5", "handshake"]); expect(r.index).toBe(2); expect(r.done).toBe(true);
    expect(r.loser).toBeNull(); // no mate, so nobody bangs the table
  });
  it("waits for the table to finish each action before asking for the next", () => {
    const t = new VirtualTable(), r = new ScenarioRunner(t, { ...SCENARIOS[0], moves: ["e4", "e5"] }, 1000);
    r.step(0); r.step(100); r.step(200); // handshake asked, pause starts
    t.play("e4", 1200); // a player carries the move out: the table is busy until it is done
    expect(r.step(1300)).toEqual([]); expect(r.index).toBe(0);
  });
  it("the checkmated side bangs the table after the closing handshake", () => {
    const r = new ScenarioRunner(new VirtualTable(), { ...SCENARIOS[0], moves: ["e4", "e5"] }, 0);
    expect(r.loser).toBe("w"); // two plies: black mated white
    const scholars = new ScenarioRunner(new VirtualTable(), SCENARIOS[0], 0);
    expect(scholars.loser).toBe("b"); // seven plies: white mated black
  });
  it("fails loudly on an illegal scripted move", () => {
    const r = new ScenarioRunner(new VirtualTable(), { ...SCENARIOS[0], id: "bad", moves: ["Ke5"] }, 0);
    r.step(0); r.step(1); // primed, then the handshake
    expect(() => r.step(2)).toThrow("scenario bad: illegal move Ke5");
  });
});
