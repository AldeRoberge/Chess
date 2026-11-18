import { Chess } from "chess.js";
import { beforeEach, describe, expect, it } from "vitest";
import { bus } from "../core/bus";
import { virtualTable } from "../sim/virtualTable";
import { drawTableOverlay } from "../world/overlay";
import { node } from "../test/helpers";
import { wrongSquare } from "./fumbler";

const placement = (fen: string) => fen.split(" ")[0];

beforeEach(() => { virtualTable.reset(); bus.reconcile = null; bus.outline = false; bus.engineHint = null; bus.botColor = null; });

describe("VirtualTable.relocate", () => {
  it("puts the piece down wherever it is told, legal or not, and refuses an empty or taken square", () => {
    expect(virtualTable.relocate(52, 36, 0)).toBe(true); // e2 → e4
    for (let t = 0; t <= 3000; t += 100) virtualTable.tick(t);
    expect(placement(virtualTable.game.fen())).toBe("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR");
    expect(virtualTable.relocate(52, 44, 4000)).toBe(false); // e2 is empty now
    expect(virtualTable.relocate(60, 51, 4000)).toBe(false); // d2 is taken
  });
});

describe("wrongSquare", () => {
  it("picks an empty square next to the right one, never the right one or the piece's own", () => {
    const c = new Chess();
    for (const pick of [0, 0.3, 0.99]) {
      const sq = wrongSquare(c, "e2", "e4", pick)!;
      expect(sq).not.toBe("e4"); expect(sq).not.toBe("e2"); expect(c.get(sq as any)).toBeFalsy();
      expect(Math.abs(sq.charCodeAt(0) - 101)).toBeLessThanOrEqual(1); expect(Math.abs(Number(sq[1]) - 4)).toBeLessThanOrEqual(1);
    }
    expect(wrongSquare(new Chess("8/8/8/8/8/8/8/k6K w - - 0 1"), "a1", "a1", 0)).not.toBeNull();
  });
});

describe("sim.fumbler", () => {
  const run = (errorRate: number) => {
    const w = new Chess(); w.move("e4");
    virtualTable.game = new Chess(w.fen());
    bus.botColor = "b"; bus.engineHint = { from: "e7", to: "e5" };
    const expected = new Chess(w.fen()); expected.move("e5");
    const n = node("sim.fumbler", { errorRate, thinkMs: 300 });
    let fen = w.fen(), sawReconcile: { from: string; to: string; wrong: string } | null = null, red = false, settledAt = -1;
    for (let t = 0; t <= 30000; t += 100) {
      virtualTable.tick(t);
      if (placement(virtualTable.game.fen()) === placement(expected.fen())) { fen = expected.fen(); if (settledAt < 0) settledAt = t; }
      if (bus.reconcile && !sawReconcile) sawReconcile = { ...bus.reconcile };
      if (bus.reconcile) { // what the projector would paint right now
        const c = document.createElement("canvas"); c.width = c.height = 14 * 48;
        drawTableOverlay(c.getContext("2d")!, 48, 3, { game: null, director: null, hint: bus.engineHint, outline: bus.outline, reconcile: bus.reconcile }, t / 1000); red = true;
      }
      n.run({ game: { fen, turn: fen.split(" ")[1], status: "synced", over: false }, director: { phase: "game" } }, t);
      if (settledAt >= 0 && t > settledAt + 500) break;
    }
    return { n, sawReconcile, red, settledAt, board: placement(virtualTable.game.fen()), want: placement(expected.fen()) };
  };

  it("carries the bot's piece straight to its square when it does not slip", () => {
    const r = run(0);
    expect(r.sawReconcile).toBeNull(); expect(r.board).toBe(r.want); expect(bus.outline).toBe(true);
  });
  it("puts the piece on the wrong square, is asked to reconcile, puts it back and plays the bot's move", () => {
    const r = run(1);
    expect(r.sawReconcile).not.toBeNull(); expect(r.sawReconcile!.to).toBe("e5"); expect(r.sawReconcile!.wrong).not.toBe("e5");
    expect(r.red).toBe(true);
    expect(r.board).toBe(r.want); expect(bus.reconcile).toBeNull();
    expect(r.n.state.mistakes).toBe(1);
    r.n.paint(); r.n.dispose(); expect(bus.outline).toBe(false);
  });
});

describe("board outline", () => {
  it("is drawn only when asked, and changes colour when reconciling", () => {
    const px = 24, size = 14 * px, edge = (o: any) => {
      const c = document.createElement("canvas"); c.width = c.height = size; const ctx = c.getContext("2d")!;
      drawTableOverlay(ctx, px, 3, { game: null, director: null, hint: null, ...o }, 0); return (ctx as any).__getDrawCalls?.().length ?? 0;
    };
    expect(edge({ outline: true })).toBeGreaterThan(edge({}));
    expect(edge({ outline: true, reconcile: { from: "e7", to: "e5", wrong: "d5" } })).toBeGreaterThan(edge({ outline: true }));
  });
});
