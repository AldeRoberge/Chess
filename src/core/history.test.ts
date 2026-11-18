import { describe, expect, it } from "vitest";
import { History } from "./history";

describe("History", () => {
  it("undoes and redoes, and a new edit clears redo", () => {
    const h = new History(0);
    expect(h.record(1, 0, "a")).toBe(true); h.record(2, 1000, "b");
    expect(h.undo()).toBe(1); expect(h.undo()).toBe(0); expect(h.undo()).toBeNull();
    expect(h.redo()).toBe(1); expect(h.canRedo).toBe(true);
    h.record(9, 5000, "c");
    expect(h.canRedo).toBe(false); expect(h.redo()).toBeNull();
  });
  it("ignores identical states and folds quick same-key edits into one step", () => {
    const h = new History({ v: 0 });
    expect(h.record({ v: 0 })).toBe(false);
    h.record({ v: 1 }, 1000, "k"); h.record({ v: 2 }, 1100, "k"); h.record({ v: 3 }, 1200, "k");
    h.record({ v: 4 }, 1300, "other"); // a different key never folds
    expect(h.undo()).toEqual({ v: 3 });
    expect(h.undo()).toEqual({ v: 0 });
  });
  it("keeps a bounded past and can be rebased", () => {
    const h = new History(0, 3);
    for (let i = 1; i <= 6; i++) h.record(i, i * 10000, "k" + i);
    let n = 0; while (h.undo() !== null) n++;
    expect(n).toBe(3);
    h.rebase(50); expect(h.canUndo).toBe(false); expect(h.redo()).toBe(4);
  });
});
