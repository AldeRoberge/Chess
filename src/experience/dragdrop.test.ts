import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { DragDrop, squareAt } from "./dragdrop";
import { PositionTracker } from "../chess/tracker";

const START = new Chess().fen();
/** centre of a square in board coordinates */
const at = (sq: string) => ({ x: "abcdefgh".indexOf(sq[0]) + 0.5, y: 8 - Number(sq[1]) + 0.5 });
const touch = (sq: string, down = true, id = "f") => [{ id, ...at(sq), down }];

describe("squareAt", () => {
  it("maps board coordinates to squares and rejects the margin", () => {
    expect(squareAt(0.1, 0.1)).toBe("a8");
    expect(squareAt(7.9, 7.9)).toBe("h1");
    expect(squareAt(-0.1, 3)).toBeNull();
    expect(squareAt(3, 8.2)).toBeNull();
  });
});

describe("DragDrop", () => {
  it("picks up a piece of the side to move and plays a legal drop after the finger lifts", () => {
    const d = new DragDrop();
    const g = d.step(0, START, touch("e2"));
    expect(g.drag).toMatchObject({ from: "e2", piece: "p", color: "w" });
    expect(g.drag!.legal.sort()).toEqual(["e3", "e4"]);
    expect(g.events[0].type).toBe("piece-grab");
    d.step(100, START, touch("e3"));
    expect(d.step(200, START, touch("e4")).drag!.hover).toBe("e4");
    expect(d.step(300, START, touch("e4", false)).drag).not.toBeNull(); // within the grace period
    const out = d.step(600, START, touch("e4", false));
    expect(out.drag).toBeNull();
    expect(out.events[0]).toMatchObject({ type: "piece-drop", data: { from: "e2", to: "e4", san: "e4", uci: "e2e4" } });
  });

  it("ignores pieces of the side that is not to move, empty squares, and fingers that are not down", () => {
    const d = new DragDrop();
    expect(d.step(0, START, touch("e7")).drag).toBeNull();
    expect(d.step(10, START, touch("e4")).drag).toBeNull();
    expect(d.step(20, START, touch("e2", false)).drag).toBeNull();
    expect(d.step(30, START, touch("e1")).drag).toBeNull(); // the king has no move yet
  });

  it("needs the fingertip near the middle of the square", () => {
    const d = new DragDrop();
    expect(d.step(0, START, [{ id: "f", x: 4.99, y: 6.99, down: true }]).drag).toBeNull();
  });

  it("puts the piece back on an illegal square, off the board, or the same square", () => {
    for (const [sq, reason] of [["e5", "illegal square"], ["e2", "put back"]] as const) {
      const d = new DragDrop();
      d.step(0, START, touch("e2")); d.step(10, START, touch(sq));
      d.step(1000, START, []);
      const out = d.step(1400, START, []);
      expect(out.drag).toBeNull();
      expect(out.events[0]).toMatchObject({ type: "piece-cancel", data: { reason } });
    }
    const d = new DragDrop();
    d.step(0, START, touch("e2")); d.step(10, START, [{ id: "f", x: 4.5, y: 9.5, down: true }]);
    d.step(1000, START, []);
    expect(d.step(1400, START, []).events[0].data!.reason).toBe("off the board");
  });

  it("keeps holding through a flicker of lost contact and follows another finger that takes over", () => {
    const d = new DragDrop();
    d.step(0, START, touch("e2"));
    d.step(50, START, []);
    expect(d.step(100, START, touch("e3", true, "g")).drag).toMatchObject({ x: 4.5, hover: "e3" });
    expect(d.step(120, START, touch("e4", true, "g")).drag!.hover).toBe("e4");
  });

  it("cancels when the position changes under the finger, and when the game ends or disappears", () => {
    const d = new DragDrop();
    d.step(0, START, touch("e2"));
    const after = new Chess(); after.move("d4");
    const out = d.step(10, after.fen(), []);
    expect(out.drag).toBeNull();
    expect(out.events[0]).toMatchObject({ type: "piece-cancel", data: { reason: "position changed" } });
    d.step(20, START, touch("e2"));
    expect(d.step(30, null, []).events[0].data!.reason).toBe("no game");
    const mate = new Chess("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3");
    expect(d.step(40, mate.fen(), touch("e2")).drag).toBeNull();
    expect(d.step(50, "not a fen", touch("e2")).drag).toBeNull();
  });

  it("promotes with the configured piece", () => {
    const fen = "8/P6k/8/8/8/8/8/K7 w - - 0 1";
    const d = new DragDrop({ grabRadius: 0.75, graceMs: 0, promotion: "n" });
    d.step(0, fen, touch("a7")); d.step(10, fen, touch("a8"));
    const out = d.step(20, fen, []);
    expect(out.events[0].data).toMatchObject({ from: "a7", to: "a8", promotion: "n", uci: "a7a8n" });
  });
});

describe("PositionTracker.play", () => {
  it("applies a legal move with its events, and refuses an illegal one without changing the game", () => {
    const t = new PositionTracker();
    expect(t.play("e2", "e5", undefined, 0)).toBeNull();
    expect(t.snapshot().ply).toBe(0);
    const r = t.play("e2", "e4", undefined, 5)!;
    expect(r).toMatchObject({ status: "moved", ply: 1, turn: "b" });
    expect(r.events.map((e) => e.type)).toEqual(["move"]);
    expect(t.snapshot()).toMatchObject({ status: "synced", ply: 1, last: { san: "e4" } });
  });
  it("reports captures, check and mate (fool's mate), and draws", () => {
    const t = new PositionTracker();
    for (const [f, to] of [["f2", "f3"], ["e7", "e5"], ["g2", "g4"]] as const) t.play(f, to, undefined, 0);
    const mate = t.play("d8", "h4", undefined, 1)!;
    expect(mate.events.map((e) => e.type)).toEqual(["move", "mate"]);
    expect(mate.over).toBe(true);
    const c = new PositionTracker(); c.reset("4k3/8/8/8/8/8/8/K6R w - - 0 1");
    expect(c.play("h1", "h8", undefined, 0)!.events.map((e) => e.type)).toEqual(["move", "check"]);
    const s = new PositionTracker(); s.reset("7k/8/8/8/8/8/8/K6R b - - 100 80");
    expect(s.play("h8", "g8", undefined, 0)!.events.some((e) => e.type === "draw")).toBe(true);
  });
});
