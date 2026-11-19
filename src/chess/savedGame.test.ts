import { Chess } from "chess.js";
import { beforeEach, describe, expect, it } from "vitest";
import { bus } from "../core/bus";
import { Director, defaultDirectorConfig } from "../experience/director";
import { virtualTable } from "../sim/virtualTable";
import { node } from "../test/helpers";
import type { BoardBelief } from "../vision/types";
import { SAVED_GAME_KEY, clearSavedGame, loadGame, newGameGeneration, replay, requestNewGame, saveGame } from "./savedGame";
import { PositionTracker } from "./tracker";
import { playStatus } from "../ui/playStatus";

const settled = (g: Chess, conf = 0.95): BoardBelief => {
  const occ = new Float32Array(64), white = new Float32Array(64);
  g.board().flat().forEach((p, i) => { occ[i] = p ? 1 : 0; white[i] = p?.color === "w" ? 1 : 0; });
  return { t: 1, occ, white, conf: new Float32Array(64).fill(conf), fidelity: 0.9, handOver: false, settled: true, cams: 2 };
};
const after = (...moves: string[]) => replay(moves)!;

beforeEach(() => { virtualTable.reset(); bus.game = null; bus.events.length = 0; });

describe("saved game", () => {
  it("stores the moves and who was playing, and gives them back", () => {
    saveGame(["e4", "e5"], { mode: "engine", elo: 1500 }, 42);
    expect(loadGame()).toEqual({ moves: ["e4", "e5"], at: 42, mode: "engine", elo: 1500 });
    saveGame(["d4"]);
    expect(loadGame()).toMatchObject({ moves: ["d4"], mode: null, elo: undefined });
  });
  it("forgets an empty, finished or broken game, and ignores junk in storage", () => {
    saveGame(["e4"]); saveGame([]); expect(loadGame()).toBeNull();
    saveGame(["e4"]); saveGame(["f3", "e5", "g4", "Qh4#"]); expect(loadGame()).toBeNull();
    saveGame(["e4"]); saveGame(["e5"]); expect(loadGame()).toBeNull();
    for (const raw of ["{", "{}", '{"moves":[]}', '{"moves":[1]}', '{"moves":["e5"]}', '{"moves":["f3","e5","g4","Qh4#"]}']) {
      localStorage.setItem(SAVED_GAME_KEY, raw); expect(loadGame()).toBeNull();
    }
    localStorage.setItem(SAVED_GAME_KEY, '{"moves":["e4"],"mode":"x"}'); expect(loadGame()).toMatchObject({ at: 0, mode: null });
    clearSavedGame(); expect(localStorage.getItem(SAVED_GAME_KEY)).toBeNull();
  });
  it("a new game request drops the stored game and bumps the generation", () => {
    saveGame(["e4"]); const g = newGameGeneration();
    requestNewGame();
    expect(newGameGeneration()).toBe(g + 1); expect(loadGame()).toBeNull();
  });
});

describe("PositionTracker resume and set-up detection", () => {
  it("resumes a stored game with its history, and refuses an illegal one", () => {
    const t = new PositionTracker();
    expect(t.resume(["e4", "e5", "Nf3"])).toBe(true);
    expect(t.snapshot()).toMatchObject({ ply: 3, turn: "b", history: ["e4", "e5", "Nf3"] });
    expect(t.resume(["e4", "e4"])).toBe(false);
    expect(t.snapshot().ply).toBe(0);
  });
  it("starts a new game when the pieces are set back on their starting squares mid-game", () => {
    const t = new PositionTracker();
    t.resume(["e4", "e5", "Nf3", "Nc6", "Bb5"]);
    expect(t.observe(settled(new Chess())).status).toBe("pending");
    const r = t.observe(settled(new Chess()));
    expect(r).toMatchObject({ status: "synced", ply: 0 });
    expect(r.events.map((e) => e.type)).toEqual(["new-game"]);
  });
  it("does not start over on an unsure picture of the start position", () => {
    const t = new PositionTracker();
    t.resume(["e4", "e5", "Nf3", "Nc6", "Bb5"]);
    const r = t.observe(settled(new Chess(), 0.4));
    expect(r.status).not.toBe("illegal"); expect(r.ply).toBe(5); // too unsure to be a new game, and too unsure to blame the player
  });
});

describe("game nodes pick up the stored game", () => {
  it("the move tracker resumes, tells the director once, saves each move and forgets the game on New game", () => {
    saveGame(["e4", "e5"], { mode: "engine", elo: 1500 });
    const n = node("game.tracker");
    const first = n.run({}, 5)!;
    expect(first.game).toMatchObject({ ply: 2 });
    expect(first.events).toEqual([expect.objectContaining({ type: "resume", t: 5, data: expect.objectContaining({ ply: 2, mode: "engine", elo: 1500 }) })]);
    expect(virtualTable.game.history()).toEqual(["e4", "e5"]);
    expect(n.run({}, 6)!.events).toEqual([]);
    const director = { phase: "game", mode: "engine", elo: 1500 };
    const g = after("e4", "e5", "Nf3");
    n.run({ board: settled(g), director }, 7);
    expect(n.run({ board: settled(g), director }, 8)!.game.status).toBe("moved");
    expect(loadGame()).toMatchObject({ moves: ["e4", "e5", "Nf3"], mode: "engine", elo: 1500 });
    requestNewGame();
    expect(n.run({ board: settled(new Chess()), director }, 9)!.game.ply).toBe(0);
    expect(loadGame()).toBeNull();
  });
  it("the first tick with a board carries the resume event, and a set-up board starts over", () => {
    saveGame(["d4", "d5"]);
    const n = node("game.tracker");
    const out = n.run({ board: settled(after("d4", "d5")), director: { phase: "game", mode: "human" } }, 1)!;
    expect(out.events.map((e: any) => e.type)).toEqual(["resume"]);
    n.run({ board: settled(new Chess()), director: { phase: "game", mode: "human" } }, 2);
    const fresh = n.run({ board: settled(new Chess()), director: { phase: "game", mode: "human" } }, 3)!;
    expect(fresh.events.map((e: any) => e.type)).toEqual(["new-game"]);
    expect(loadGame()).toBeNull();
    expect(bus.events.some((e) => e.type === "new-game")).toBe(true);
  });
  it("forgets the game once it is over", () => {
    saveGame(["f3", "e5", "g4"]);
    const n = node("game.tracker"), mate = after("f3", "e5", "g4", "Qh4#");
    n.run({ board: settled(mate), director: { phase: "game" } }, 1);
    expect(n.run({ board: settled(mate), director: { phase: "game" } }, 2)!.game.over).toBe(true);
    expect(loadGame()).toBeNull();
  });
  it("the virtual position resumes too, saves finger moves and starts over on New game", () => {
    saveGame(["e4"]);
    const v = node("game.virtual");
    const out = v.run({}, 1)!;
    expect(out.game.ply).toBe(1);
    expect(out.events.map((e: any) => e.type)).toEqual(["resume"]);
    v.run({ drops: [{ type: "piece-drop", t: 2, data: { from: "e7", to: "e5" } }] }, 2);
    expect(loadGame()?.moves).toEqual(["e4", "e5"]);
    requestNewGame();
    expect(v.run({}, 3)!.game.ply).toBe(0);
  });
  it("a node with nothing stored starts from the beginning", () => {
    expect(node("game.tracker").run({}, 1)!.events).toEqual([]);
  });
});

describe("director on resume", () => {
  it("goes straight back into the game against the stored opponent", () => {
    const d = new Director({ ...defaultDirectorConfig(), preset: "menu" });
    const out = d.step(0, [], [], [{ type: "resume", t: 0, data: { mode: "engine", elo: 1500 } }]);
    expect(out).toMatchObject({ phase: "game", mode: "engine", elo: 1500 });
  });
  it("falls back to the preset opponent when the stored game does not say", () => {
    const d = new Director({ ...defaultDirectorConfig(), preset: "human" });
    expect(d.step(0, [], [], [{ type: "resume", t: 0, data: {} }])).toMatchObject({ phase: "game", mode: "human" });
    const e = new Director();
    expect(e.step(0, [], [], [{ type: "resume", t: 0, data: { mode: "human" } }])).toMatchObject({ phase: "game", mode: "human", elo: 1000 });
  });
});

describe("play status", () => {
  it("asks for the starting position when a new game does not match the board yet", () => {
    const base = { cameras: 1, board: { settled: true, handOver: false, cams: 1 }, startPosition: false, phase: "game", botColor: null, hint: null };
    expect(playStatus({ ...base, game: { status: "illegal", ply: 0, turn: "w", over: false, history: [] } }).title).toBe("Set up a new game");
    expect(playStatus({ ...base, game: { status: "illegal", ply: 3, turn: "b", over: false, history: [] } }).title).toBe("Not a legal move");
  });
});
