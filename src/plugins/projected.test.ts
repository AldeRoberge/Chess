import { beforeEach, describe, expect, it } from "vitest";
import { Graph } from "../core/graph";
import { bus } from "../core/bus";
import { createRegistry } from ".";
import { node } from "../test/helpers";
import { virtualTable } from "../sim/virtualTable";
import { cameraMatrix, project } from "../vision/triangulate";
import { TABLE_Y, boardToWorld } from "../world/coords";
import { drawPieceOverlay } from "../world/pieceOverlay";
import { drawTableOverlay } from "../world/overlay";
import { Chess } from "chess.js";
import { triangulateHand } from "./projected";
import { WORKFLOWS } from "../workflows";

beforeEach(() => { bus.pieceView = null; bus.game = null; bus.events.length = 0; virtualTable.reset(); virtualTable.piecesVisible = true; });

describe("tracking.touch", () => {
  it("has a gap between touching and letting go, and passes a mouse's own `down` through", () => {
    const n = node("tracking.touch", { usePinch: false });
    const z = (v: number) => n.run({ pointers: [{ id: "a", x: 1, y: 1, z: v }] })!.pointers[0].down;
    expect([z(0.05), z(0.01), z(0.02), z(0.04), z(0.02)]).toEqual([false, true, true, false, false]);
    expect(n.run({ pointers: [{ id: "m", x: 1, y: 1, down: true }] })!.pointers[0].down).toBe(true);
    expect(n.run({ pointers: [{ id: "m", x: 1, y: 1 }] })!.pointers[0].down).toBe(false);
  });
  it("pinch grabs when enabled and merges a second source", () => {
    const n = node("tracking.touch");
    const out = n.run({ pointers: [{ id: "a", x: 1, y: 1, z: 0.2, pinch: 0.01 }], pointers2: [{ id: "b", x: 2, y: 2, z: 0.2, pinch: 0.1 }] })!.pointers;
    expect(out.map((p: any) => p.down)).toEqual([true, false]);
    expect(n.run({ pointers: [{ id: "a", x: 1, y: 1, pinch: 0.03 }] })!.pointers[0].down).toBe(true); // still closed enough to hold
    expect(n.run({ pointers: [{ id: "a", x: 1, y: 1, pinch: 0.05 }] })!.pointers[0].down).toBe(false);
  });
});

describe("triangulateHand", () => {
  const A = cameraMatrix([-1, 1.6, 1], [0, TABLE_Y, 0], 50, 480, 360), B = cameraMatrix([1, 1.6, 1], [0, TABLE_Y, 0], 50, 480, 360);
  const tip = (P: any, w: [number, number, number], t = 0) => ({ index: project(P, w), thumb: project(P, [w[0] + 0.03, w[1], w[2]]), t });
  it("finds the fingertip on the board, its height and the pinch from two cameras", () => {
    const [x, , z] = boardToWorld(2.5, 5.5), w: [number, number, number] = [x, TABLE_Y + 0.02, z];
    const p = triangulateHand([A, B, null], [tip(A, w), tip(B, w), null], 0)!;
    expect(p.x).toBeCloseTo(2.5, 1); expect(p.y).toBeCloseTo(5.5, 1); expect(p.z).toBeCloseTo(0.02, 2); expect(p.pinch).toBeCloseTo(0.03, 2);
  });
  it("needs two fresh views", () => {
    const w: [number, number, number] = [0, TABLE_Y, 0];
    expect(triangulateHand([A, B, null], [tip(A, w), null, null], 0)).toBeNull();
    expect(triangulateHand([A, B, null], [tip(A, w), tip(B, w, 0), null], 2000)).toBeNull();
  });
});

describe("tracking.hands", () => {
  it("is off by default and costs nothing", () => {
    const n = node("tracking.hands");
    expect(n.run({})).toEqual({ pointers: [] });
    expect(n.h.fidelity).toBeNull();
  });
});

describe("game.virtual + game.dragDrop", () => {
  const touch = (x: number, y: number, down: boolean) => [{ id: "m", x, y, down }];
  it("a finger drag plays the move, the engine reply is applied after its delay, and the position stands in between", () => {
    const v = node("game.virtual", { engineDelayMs: 500 }), d = node("game.dragDrop", { graceMs: 100 });
    let g = v.run({}, 0)!.game;
    expect(g).toMatchObject({ status: "synced", ply: 0 });
    d.run({ game: g, pointers: touch(4.5, 6.5, true) }, 10);                       // touch e2
    d.run({ game: g, pointers: touch(4.5, 4.5, true) }, 20);                       // slide to e4
    d.run({ game: g, pointers: [] }, 30);                                          // lift
    const drop = d.run({ game: g, pointers: [] }, 200)!;
    expect(drop.events[0].type).toBe("piece-drop");
    const out = v.run({ drops: drop.events }, 210)!;
    expect(out.game).toMatchObject({ status: "moved", ply: 1, turn: "b" });
    expect(out.events.map((e: any) => e.type)).toEqual(["move"]);
    expect(v.run({}, 220)!.game).toMatchObject({ status: "synced", ply: 1 });
    const engine = [{ type: "engine-move", t: 230, data: { uci: "e7e5", from: "e7", to: "e5", san: "e5" } }];
    expect(v.run({ engine }, 230)!.game.ply).toBe(1);                              // still waiting
    expect(v.run({}, 800)!.game).toMatchObject({ ply: 2, turn: "w", status: "moved" });
    expect(bus.game!.ply).toBe(2);
  });
  it("ignores illegal drops and unrelated events, and resets on a restart", () => {
    const v = node("game.virtual");
    v.run({ drops: [{ type: "piece-drop", t: 0, data: { from: "e2", to: "e5" } }, { type: "move", t: 0, data: {} }] }, 0);
    expect(v.run({}, 10)!.game.ply).toBe(0);
    v.run({ drops: [{ type: "piece-drop", t: 0, data: { from: "e2", to: "e4" } }] }, 20);
    expect(v.run({ control: [{ type: "scenario-start", t: 30 }] }, 30)!.game.ply).toBe(0);
    v.run({ drops: [{ type: "piece-drop", t: 0, data: { from: "e2", to: "e4" } }] }, 40);
    v.params.resync = true; expect(v.run({}, 50)!.game.ply).toBe(0); expect(v.params.resync).toBe(false);
    v.run({}, 60); expect(v.paint(140, 40).canvas).toBeTruthy();
  });
  it("only lets pieces be moved while the game is on", () => {
    const d = node("game.dragDrop"), g = node("game.virtual").run({}, 0)!.game;
    d.run({ game: g, pointers: touch(4.5, 6.5, true), director: { phase: "menu" } }, 0);
    expect(d.run({ game: g, pointers: touch(4.5, 6.5, true), director: { phase: "menu" } }, 10)!.drag).toBeNull();
    expect(d.run({ game: g, pointers: touch(4.5, 6.5, true), director: { phase: "game" } }, 20)!.drag).toMatchObject({ from: "e2" });
    expect(d.paint(140, 40).canvas).toBeTruthy();
    d.run({}, 30); d.paint(140, 40);
  });
});

describe("projection.pieces", () => {
  it("publishes what to paint, hides the physical pieces while it runs, and gives them back when removed", () => {
    const n = node("projection.pieces");
    const fen = new Chess().fen();
    n.run({ game: { fen }, drag: null });
    expect(bus.pieceView).toMatchObject({ fen, drag: null, legalDots: true });
    expect(virtualTable.piecesVisible).toBe(false);
    expect(virtualTable.scene3d().pieces).toHaveLength(0);
    n.run({});
    expect(bus.pieceView).toBeNull(); expect(virtualTable.piecesVisible).toBe(true); expect(virtualTable.scene3d().pieces).toHaveLength(32);
    n.run({ game: { fen } }); n.dispose();
    expect(bus.pieceView).toBeNull(); expect(virtualTable.piecesVisible).toBe(true);
  });
});

describe("drawPieceOverlay", () => {
  const view = (drag: any, o: any = {}) => ({ fen: new Chess().fen(), drag, legalDots: true, shadow: true, scale: 0.85, rotate: false, ...o });
  it("paints the position, the held piece and its legal squares onto a canvas", () => {
    const c = document.createElement("canvas"); c.width = c.height = 14 * 48; const ctx = c.getContext("2d")!;
    drawPieceOverlay(ctx, 48, view(null), 0);
    drawPieceOverlay(ctx, 48, view({ from: "e2", piece: "p", color: "w", x: 4.5, y: 4.2, legal: ["e3", "e4"], hover: "e4" }, { rotate: true }), 1, 180);
    drawPieceOverlay(ctx, 48, view({ from: "b1", piece: "n", color: "w", x: 2.5, y: 5.5, legal: ["a3", "c3"], hover: "a3" }, { legalDots: false, shadow: false }), 2);
    drawPieceOverlay(ctx, 48, { ...view(null), fen: "garbage" }, 3); // a bad position paints nothing instead of throwing
    drawTableOverlay(ctx, 48, 3, { game: null, director: { seat: { id: "s", x: 4, y: 10, angle: 180 } } as any, hint: null, pieces: view(null, { rotate: true }) }, 0);
  });
});

describe("the piece-less demo workflow", () => {
  it("projects the starting position, lets a drag play e4, and the engine-less run stays error-free", () => {
    const w = WORKFLOWS.find((x) => x.id === "pieceless")!, g = new Graph(createRegistry());
    g.load(w.graph);
    for (let i = 0; i < 6; i++) g.tick(i * 100);
    expect(bus.game?.fen).toBe(new Chess().fen());
    expect(bus.pieceView).not.toBeNull();
    expect([...g.stats.values()].filter((s) => s.error)).toEqual([]);
    g.nodes.forEach((n) => n.type === "projection.pieces" && createRegistry().get(n.type)!.dispose?.(null));
  });
});
