import { Chess } from "chess.js";
import { beforeEach, describe, expect, it } from "vitest";
import { bus } from "./core/bus";
import { Graph } from "./core/graph";
import { createRegistry } from "./plugins";
import { layoutMenu } from "./experience/director";
import { SCENARIOS } from "./sim/scenarios";
import { virtualTable } from "./sim/virtualTable";
import { buildGraphFromConfig, defaultSetup } from "./setup/config";
import { runScenario } from "./test/rig";

beforeEach(() => { Object.assign(bus, { lines: [], events: [], game: null, board: null, director: null, scene: null, engineHint: null, cameras: [] }); });
const count = (events: { type: string; data?: any }[], type: string, pred: (d: any) => boolean = () => true) => events.filter((e) => e.type === type && pred(e.data)).length;

describe("every scripted game, played on noisy 3D camera feeds through the whole patch", () => {
  it.each(SCENARIOS)("$name", (s) => {
    const r = runScenario(s.id);
    expect(r.violations, "the tracker never accepts a wrong move").toBe(0);
    expect(r.finished).toBe(true);
    expect(r.history).toEqual(r.truth); expect(r.fen).toBe(virtualTable.game.fen());
    expect(count(r.events, "move")).toBe(s.expect.plies);
    expect(count(r.events, "capture")).toBe(s.expect.captures); expect(count(r.events, "capture", (d) => d.captured === "q") > 0).toBe(s.expect.queenCaptured);
    expect(count(r.events, "castle")).toBe(s.expect.castles); expect(count(r.events, "promotion")).toBe(s.expect.promotions);
    expect(count(r.events, "check")).toBe(s.expect.checks); expect(count(r.events, "mate")).toBe(s.expect.mate ? 1 : 0);
    // the scene reacts to the same events: thunder exactly when a queen fell
    expect(r.fired.includes("thunder")).toBe(s.expect.queenCaptured || s.expect.mate);
    expect(r.lines.length).toBeGreaterThan(0);
    for (const e of r.events.filter((x) => x.type === "move")) expect(e.data!.fidelity).toBeGreaterThan(0.3);
  });
});

describe("robustness: fine-tuning conditions", () => {
  const id = "queen-trade";
  it.each([
    ["low light (exposure 0.55)", { gain: 0.55 }],
    ["overexposed (1.5)", { gain: 1.5 }],
    ["heavy sensor noise (σ 22)", { noise: 22 }],
    ["strong lighting falloff", { gradient: 0.5 }],
    ["a single camera, forearms covering the board", { cams: ["A"] as const }],
    ["three cameras", { cams: ["A", "B", "C"] as const }],
    ["hurried players (short pauses)", { pauseMs: 900 }],
  ])("%s", (_name, opts) => {
    const r = runScenario(id, { ...(opts as any), cams: opts && "cams" in opts ? [...(opts as any).cams] : undefined });
    if (r.violations) console.log("tracking diagnostic", r.history, r.truth, r.events.filter((e) => e.type === "detection-guess" || e.type === "detection-correction").map((e) => ({ type: e.type, t: e.t, selected: e.data?.selected, cost: e.data?.cost, alternatives: e.data?.alternatives })));
    expect(r.violations).toBe(0); expect(r.history).toEqual(r.truth);
  });
  it("castling seen by one camera under an arm is committed as O-O, never as a king step that leaves the game stuck", () => {
    const r = runScenario("castle-both", { cams: ["C"] });
    expect(r.violations).toBe(0); expect(r.history).toEqual(r.truth);
  });
  it("a camera that drops out mid-game and comes back does not disturb the game", () => {
    const r = runScenario("scholars-mate", { outages: [{ cam: 1, from: 9000, to: 23000 }] });
    expect(r.violations).toBe(0); expect(r.history).toEqual(r.truth);
  });
  it("both cameras offline for a while: the tracker holds still (no phantom moves), then catches up", () => {
    const r = runScenario("scholars-mate", { outages: [{ cam: 0, from: 12000, to: 19000 }, { cam: 1, from: 12000, to: 19000 }] });
    expect(r.violations).toBe(0); expect(r.history).toEqual(r.truth);
  });
  it("terrible conditions may stall the tracker, but never make it lie", () => {
    const r = runScenario(id, { noise: 60, gain: 0.3, maxMs: 40000 });
    expect(r.violations).toBe(0);
  });
});

describe("the complete experience", () => {
  it("someone sits, hover-selects Stockfish 500, plays e4, and the machine answers on the table", async () => {
    virtualTable.reset(); virtualTable.seated = false;
    const g = new Graph(createRegistry()), cfg = defaultSetup(); buildGraphFromConfig(g, cfg);
    const person = [...g.nodes.values()].find((n) => n.type === "sim.person")!;
    let now = 1000;
    const run = async (ms: number) => { for (let t = 0; t < ms; t += 66) { now += 66; g.tick(now); await Promise.resolve(); await Promise.resolve(); } };
    await run(1500);
    expect(bus.game?.status).toBe("synced"); expect(bus.board!.fidelity).toBeGreaterThan(0.7);
    person.params.seated = true; await run(7500);
    expect(bus.director?.phase).toBe("menu"); expect(bus.lines.map((l) => l.text).some((t) => /joueur/.test(t))).toBe(true); // the narrator greets the new player (wording varies)
    const btn = layoutMenu(bus.director!.seat!, [500, 1000, 1500]).find((b) => b.id === "elo500")!;
    virtualTable.pointer = { x: btn.x, y: btn.y }; await run(2200); virtualTable.pointer = null;
    expect(bus.director).toMatchObject({ phase: "game", elo: 500, mode: "engine" }); expect(bus.scene?.scene).toBe("fire-watchtower");
    virtualTable.play("e2e4", now); await run(14000);
    expect(bus.game?.history[0]).toBe("e4"); expect(bus.game!.history.length).toBeGreaterThanOrEqual(2); expect(bus.game!.status).toBe("synced"); expect(bus.game!.fen).toBe(virtualTable.game.fen());
    expect(new Chess(bus.game!.fen).history()).toBeDefined();
  }, 240000);
  it("a kiosk preset skips the menu and goes straight to the game", async () => {
    virtualTable.reset(); virtualTable.seated = false;
    const g = new Graph(createRegistry()), cfg = defaultSetup(); cfg.opponent = { mode: "engine", elo: 1500 }; buildGraphFromConfig(g, cfg);
    [...g.nodes.values()].find((n) => n.type === "sim.person")!.params.seated = true;
    let now = 1000; for (let t = 0; t < 8000; t += 66) { now += 66; g.tick(now); await Promise.resolve(); }
    expect(bus.director).toMatchObject({ phase: "game", mode: "engine", elo: 1500 });
  });
});
