import { describe, expect, it } from "vitest";
import type { Engine } from "../chess/engine";
import { LiveGame } from "./liveGame";
import type { TableAction } from "./virtualTable";
import { virtualTable } from "./virtualTable";

/** Scholar's mate, as the engine would answer it, move by move (UCI). */
const MATE = ["e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7"];

function fakeEngine(ucis: string[]) {
  const elos: number[] = [];
  let i = 0;
  const engine: Engine = {
    setElo(e) { elos.push(e); },
    async bestMove() { return ucis[i++]; },
    dispose() {},
  };
  return { engine, elos };
}

/** Steps the game like the frame loop would: time moves on and the engine's promise gets to resolve in between. */
async function run(g: LiveGame, ticks = 4000) {
  const acts: TableAction[] = [];
  let t = 0;
  for (let k = 0; k < ticks && !g.done; k++, t += 50) {
    acts.push(...g.step(t));
    await new Promise((r) => setTimeout(r, 0));
  }
  return acts;
}

describe("LiveGame", () => {
  it("asks the engine for every move and hands them to the table, then shakes hands and the mated side bangs the table", async () => {
    virtualTable.reset();
    const { engine } = fakeEngine(MATE);
    const g = new LiveGame(virtualTable, engine, { w: 400, b: 400 }, 100);
    const acts = await run(g);
    expect(g.done).toBe(true); expect(g.error).toBeNull(); expect(g.index).toBe(7);
    expect(acts.map((a) => a.kind)).toEqual(["handshake", ...MATE.map(() => "move"), "handshake", "fist"]);
    const moves = acts.filter((a): a is Extract<TableAction, { kind: "move" }> => a.kind === "move");
    expect(moves.map((m) => m.san)).toEqual(["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#"]);
    expect(moves.map((m) => m.color)).toEqual(["w", "b", "w", "b", "w", "b", "w"]);
    const fist = acts[acts.length - 1] as Extract<TableAction, { kind: "fist" }>;
    expect(fist.color).toBe("b"); // Qxf7# leaves Black to move, mated
    expect(new Set(acts.map((a) => a.id)).size).toBe(acts.length); // every action has its own id
  });

  it("uses each side's Elo when that side is to move", async () => {
    virtualTable.reset();
    const { engine, elos } = fakeEngine(MATE);
    const g = new LiveGame(virtualTable, engine, { w: 400, b: 1200 }, 100);
    await run(g);
    expect(elos.slice(0, 2)).toEqual([400, 1200]);
  });

  it("a held game asks for nothing while held, and goes on after release", async () => {
    virtualTable.reset();
    const { engine } = fakeEngine(MATE);
    const g = new LiveGame(virtualTable, engine, { w: 400, b: 400 }, 500);
    let t = 0;
    const tick = async (n: number) => {
      const out: TableAction[] = [];
      for (let k = 0; k < n; k++, t += 50) { out.push(...g.step(t)); await new Promise((r) => setTimeout(r, 0)); }
      return out;
    };
    for (let k = 0; k < 400 && g.index < 2; k++) await tick(1); // play two moves first
    expect(g.index).toBeGreaterThanOrEqual(2); expect(g.done).toBe(false);
    g.setHeld(true, t);
    const before = g.index;
    expect(await tick(400)).toEqual([]); expect(g.index).toBe(before);
    g.setHeld(false, t);
    await tick(400); expect(g.index).toBeGreaterThan(before);
  });

  it("an engine failure ends the game and keeps the error", async () => {
    virtualTable.reset();
    const engine: Engine = { setElo() {}, async bestMove() { throw new Error("worker gone"); }, dispose() {} };
    const g = new LiveGame(virtualTable, engine, { w: 400, b: 400 }, 100);
    await run(g, 300);
    expect(g.done).toBe(true); expect(g.error).toContain("worker gone");
  });
});
