import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bus } from "../core/bus";
import { defaultMapping } from "../mapping/store";
import { virtualTable } from "../sim/virtualTable";
import { initialSceneState } from "../scene/types";
import type { TrackResult } from "../chess/tracker";
import type { DirectorOut } from "../experience/director";
import { Chess } from "chess.js";

const gl = vi.hoisted(() => ({ made: [] as any[] }));
vi.mock("three", async (orig) => {
  const actual = await orig<typeof import("three")>();
  class FakeRenderer { shadowMap = { enabled: false, type: 0, autoUpdate: true, needsUpdate: false }; ratio = 1; renders = 0; cleared: any[] = []; size: number[] = []; disposed = false; constructor(public opts: any) { gl.made.push(this); }
    setPixelRatio(r: number) { this.ratio = r; } getPixelRatio() { return this.ratio; } setSize(w: number, h: number) { this.size = [w, h]; this.opts.canvas.width = w * this.ratio; this.opts.canvas.height = h * this.ratio; }
    setClearColor(...a: any[]) { this.cleared = a; } rt: any = null; setRenderTarget(t: any) { this.rt = t; } clear() {} render() { if (!this.rt) this.renders++; } dispose() { this.disposed = true; } }
  return { ...actual, WebGLRenderer: FakeRenderer };
});

import * as THREE from "three";
import { makeBlendMaterial, projectorCamera } from "./blend";
import { SQUARE, TABLE_Y, boardToWorld, worldToBoard } from "./coords";
import { drawTableOverlay } from "./overlay";
import { ProjectorOutput } from "./output";
import { pieceGeometry } from "./pieces";
import { surfaceMesh } from "./surfaces";
import { WorldView } from "./view";

beforeEach(() => { gl.made.length = 0; });
afterEach(() => { vi.restoreAllMocks(); });

describe("coordinates", () => {
  it("maps board to world and back, with white on +z and the origin at the board centre", () => {
    expect(boardToWorld(4, 4)).toEqual([0, TABLE_Y, 0]); expect(boardToWorld(0, 8)[2]).toBeCloseTo(4 * SQUARE); expect(boardToWorld(0, 0)[0]).toBeCloseTo(-4 * SQUARE);
    const w = boardToWorld(1.5, 6.25), b = worldToBoard(w[0], w[2]); expect(b.x).toBeCloseTo(1.5); expect(b.y).toBeCloseTo(6.25);
  });
});

describe("projector camera & blend shader", () => {
  const p = { id: "a", pos: [0, 2, 3] as [number, number, number], target: [0, 1, 0] as [number, number, number], fovY: 40, aspect: 1.6 };
  it("builds a perspective camera looking at the target, with optional roll", () => {
    const c = projectorCamera(p); expect(c.fov).toBe(40); expect(c.aspect).toBe(1.6); expect(c.position.toArray()).toEqual([0, 2, 3]);
    const dir = new THREE.Vector3(); c.getWorldDirection(dir); expect(dir.z).toBeLessThan(0);
    const rolled = projectorCamera({ ...p, rollDeg: 30 }); expect(rolled.rotation.z).not.toBeCloseTo(c.rotation.z);
  });
  it("packs every projector's view-projection, this projector's index, and tuning into the material", () => {
    const tex = new THREE.Texture(), projs = [p, { ...p, id: "b", pos: [1, 2, 3] as [number, number, number] }];
    const m = makeBlendMaterial(tex, projs, 1, 0.3, 2.4);
    expect(m.uniforms.count.value).toBe(2); expect(m.uniforms.self.value).toBe(1); expect(m.uniforms.feather.value).toBe(0.3); expect(m.uniforms.gamma.value).toBe(2.4); expect(m.uniforms.map.value).toBe(tex);
    const [a, b] = m.uniforms.vps.value as THREE.Matrix4[]; expect(a.equals(b)).toBe(false); expect(m.fragmentShader).toContain("pow(mine / sum");
    expect(makeBlendMaterial(tex, Array(6).fill(p), 0, 0.2, 2.2).uniforms.count.value).toBe(4); // capped at four projectors
  });
});

describe("pieces and surfaces", () => {
  it("builds one cached lathe geometry per piece type", () => {
    expect(pieceGeometry("q")).toBe(pieceGeometry("q")); expect(pieceGeometry("k")).not.toBe(pieceGeometry("p")); expect(pieceGeometry("n").attributes.position.count).toBeGreaterThan(10);
  });
  it("places a plane mesh on a surface's centre with its axes as the basis", () => {
    const s = defaultMapping().surfaces.find((x) => x.id === "wall-back")!;
    const m = surfaceMesh(s, new THREE.MeshBasicMaterial());
    expect(m.matrixAutoUpdate).toBe(false); expect(m.userData.surface).toBe(s);
    const pos = new THREE.Vector3().setFromMatrixPosition(m.matrix); expect(pos.toArray()).toEqual(s.center);
    expect((m.geometry as THREE.PlaneGeometry).parameters.width).toBeCloseTo(s.halfW * 2);
  });
});

describe("table overlay", () => {
  const ctx = () => document.createElement("canvas").getContext("2d")!;
  const game = (over: Partial<TrackResult> = {}): TrackResult => ({ status: "synced", fen: new Chess().fen(), turn: "w", ply: 0, over: false, last: null, history: [], diff: [], fidelity: 1, moveFidelity: 1, events: [], ...over });
  const menu = (over: Partial<DirectorOut> = {}): DirectorOut => ({ phase: "menu", menu: [{ id: "elo500", label: "Ordinateur 500", x: 3, y: 9, r: 0.55, mode: "engine", elo: 500 }, { id: "human", label: "Deux joueurs", x: 5, y: 9, r: 0.55, mode: "human" }], progress: { elo500: 0.5, human: 0 }, mode: null, elo: 1000, events: [], seat: { id: "s", x: 4, y: 10, angle: 0 }, ...over });
  it("clears first (unless told not to) and draws nothing for an empty state", () => {
    const c = ctx(), clear = vi.spyOn(c, "clearRect"), fill = vi.spyOn(c, "fillRect");
    drawTableOverlay(c, 40, 3, { game: null, director: null, hint: null }, 0); expect(clear).toHaveBeenCalled(); expect(fill).not.toHaveBeenCalled();
    clear.mockClear(); drawTableOverlay(c, 40, 3, { game: null, director: null, hint: null }, 0, false); expect(clear).not.toHaveBeenCalled();
  });
  it("highlights the last move, a lifted piece, illegal squares (pulsing), and the engine's hint with an arrow", () => {
    const c = ctx(), fill = vi.spyOn(c, "fillRect"), stroke = vi.spyOn(c, "strokeRect"), line = vi.spyOn(c, "lineTo");
    drawTableOverlay(c, 40, 3, { game: game({ last: { from: "e2", to: "e4" } as any, lifted: "g1", status: "illegal", diff: [10, 20] }), director: null, hint: { from: "e7", to: "e5" } }, 1.3);
    expect(fill).toHaveBeenCalledTimes(5); expect(stroke).toHaveBeenCalledTimes(2); expect(line).toHaveBeenCalled();
    drawTableOverlay(c, 40, 3, { game: game({ status: "illegal", diff: [1] }), director: null, hint: null }, 0); // illegal squares only when illegal
    stroke.mockClear(); drawTableOverlay(c, 40, 3, { game: game({ status: "synced", diff: [1] }), director: null, hint: null }, 0); expect(stroke).not.toHaveBeenCalled();
  });
  it("draws the hover menu with progress rings, rotated labels, and multi-word captions; only in the menu phase", () => {
    const c = ctx(), text = vi.spyOn(c, "fillText"), arc = vi.spyOn(c, "arc");
    drawTableOverlay(c, 40, 3, { game: null, director: menu(), hint: null }, 0);
    expect(text).toHaveBeenCalledWith("Ordinateur", 0, expect.any(Number)); expect(text).toHaveBeenCalledWith("500", 0, expect.any(Number)); expect(text).toHaveBeenCalledWith("Deux", 0, expect.any(Number));
    expect(arc.mock.calls.length).toBe(3); // two discs + one progress ring (the idle button has no ring)
    arc.mockClear(); drawTableOverlay(c, 40, 3, { game: null, director: menu({ seat: null }), hint: null }, 0); expect(arc).toHaveBeenCalled(); // no seat: unrotated labels
    drawTableOverlay(c, 40, 3, { game: null, director: menu({ progress: {} }), hint: null }, 0); // buttons with no recorded progress
    text.mockClear(); drawTableOverlay(c, 40, 3, { game: null, director: menu({ phase: "game" }), hint: null }, 0); expect(text).not.toHaveBeenCalled();
  });
});

describe("ProjectorOutput", () => {
  const cfg = defaultMapping();
  it("renders the scene from the projector's viewpoint, black elsewhere, at the chosen resolution scale", () => {
    const cv = document.createElement("canvas"), out = new ProjectorOutput(cv, cfg, 1, 0.5), r = gl.made[0];
    expect(r.ratio).toBe(0.5);
    out.resize(800, 450); expect(r.size).toEqual([800, 450]);
    out.render(initialSceneState("winter-forest"), { game: null, director: null, hint: null }, 1000); out.render(initialSceneState(), { game: null, director: null, hint: null }, 1100);
    expect(r.renders).toBe(2); expect(r.cleared[0]).toBe(0x000000);
    out.dispose(); expect(r.disposed).toBe(true);
  });
  it("defaults to full-resolution output, and can be rebuilt after the mapping changes", () => {
    const out = new ProjectorOutput(document.createElement("canvas"), cfg, 0); expect(gl.made[0].ratio).toBe(0.5);
    const next = { ...cfg, projectors: cfg.projectors.slice(0, 2), surfaces: cfg.surfaces.slice(0, 3) };
    out.rebuild(next, 1); out.render(initialSceneState(), { game: null, director: null, hint: null }, 0);
  });
});

describe("WorldView", () => {
  const mk = () => { const cv = document.createElement("canvas"); Object.defineProperty(cv, "clientWidth", { value: 640, configurable: true }); Object.defineProperty(cv, "clientHeight", { value: 480, configurable: true }); return cv; };
  beforeEach(() => { bus.game = null; bus.scene = null; bus.poses = []; bus.director = null; bus.engineHint = null; virtualTable.reset(); });
  it("builds the room, table, board, chairs and projector rigs; resizes to its element; renders a frame", () => {
    const v = new WorldView(mk(), defaultMapping()), r = gl.made[0];
    v.render(100); expect(r.renders).toBe(1); expect(r.size).toEqual([640, 480]);
    v.render(200); expect(r.size).toEqual([640, 480]);
    v.dispose(); expect(r.disposed).toBe(true);
  });
  it("skips resizing while the element has no size", () => {
    const cv = document.createElement("canvas"); const v = new WorldView(cv, defaultMapping()); v.render(0); expect(gl.made[0].size).toEqual([]); v.dispose();
  });
  it("shows the live game: 32 pieces, rebuilt only when the position or carried piece changes; people as skeleton lines and joint dots", () => {
    const v = new WorldView(mk(), defaultMapping()) as any;
    v.render(0); const first = v.pieces.children.length; expect(first).toBe(32);
    const g = new Chess(); g.move("e4"); g.move("d5"); g.move("exd5");
    bus.game = { fen: g.fen() } as any; v.render(100); expect(v.pieces.children.length).toBe(31);
    const key = v.pieceKey; v.render(200); expect(v.pieceKey).toBe(key);
    virtualTable.carried = 5; v.render(300); expect(v.pieceKey).not.toBe(key);
    bus.poses = [{ id: "p", joints: [[0, 1, 0], [0, 1.1, 0], null, null, null, [0.1, 0.9, 0], ...Array(11).fill(null)] }]; v.render(400); expect(v.people.children.length).toBeGreaterThan(0);
    bus.poses = []; v.render(500); expect(v.people.children.length).toBe(0);
  });
  it("draws live content and the table overlay when a scene is running, and honours the projection and frusta toggles", () => {
    const v = new WorldView(mk(), defaultMapping()) as any;
    bus.scene = initialSceneState("fire-watchtower"); bus.director = null;
    v.render(0); v.render(30); v.render(100);
    v.showFrusta = false; v.render(200); expect(v.frusta.visible).toBe(false);
    v.showProjection = false; v.setMapping(defaultMapping()); v.render(300); bus.scene = null; v.render(400);
    expect(v.room.children.length).toBe(4); expect(v.frusta.children.length).toBe(6); // three projector frusta + bodies
  });
  it("replaces the room when a new mapping (e.g. a scanned room) arrives", () => {
    const v = new WorldView(mk(), defaultMapping()) as any, m = defaultMapping(); m.surfaces = m.surfaces.slice(0, 2); m.projectors = m.projectors.slice(0, 1);
    v.setMapping(m); expect(v.room.children.length).toBe(2); expect(v.frusta.children.length).toBe(2);
  });
});
