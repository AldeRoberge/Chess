import { describe, expect, it } from "vitest";
import { SCATTER_MS, SHAKE_MS, VirtualTable, performAction, type TableAction } from "./virtualTable";

const finite = (v: number[]) => v.every((x) => Number.isFinite(x));

describe("virtual table: handshake and fist", () => {
  it("both players reach across the middle for a handshake, with no NaN in any arm, and the arms go home afterwards", () => {
    const t = new VirtualTable(); t.tick(0);
    t.handshake(0); t.tick(0); t.tick(300);
    const arms = t.arms();
    expect(arms.filter((a) => a.active).map((a) => a.side).sort()).toEqual([-1, 1]); // one right hand from each side
    for (const a of arms) for (const c of a.capsules) { expect(finite(c.a)).toBe(true); expect(finite(c.b)).toBe(true); }
    t.tick(SHAKE_MS + 10);
    expect(t.busy).toBe(false); expect(t.arms()).toEqual([]);
  });

  it("a second handshake call on the same tick is ignored, so two players can both make it", () => {
    const t = new VirtualTable(); t.tick(0);
    t.handshake(0); t.handshake(0);
    expect(t.busy).toBe(true);
    t.tick(0); t.tick(SHAKE_MS + 10);
    expect(t.busy).toBe(false);
  });

  it("the checkmated side bangs with its right fist, and the last bang knocks the pieces loose", () => {
    const t = new VirtualTable(); t.tick(0);
    const pieces = t.scene3d().pieces.length;
    expect(performAction(t, { id: 1, kind: "fist", color: "b" } as TableAction, "b", 0)).toBe(true);
    t.tick(0); t.tick(600);
    const fist = t.arms().filter((a) => a.active);
    expect(fist).toHaveLength(1); expect(fist[0].side).toBe(-1); expect(fist[0].hand).toBe("R");
    expect(finite(fist[0].wrist)).toBe(true);
    expect(t.scene3d().pieces).toHaveLength(pieces); // still on the board until the last bang
    t.tick(1300 + 400); // mid-tumble
    expect(t.scene3d().pieces.every((p) => finite([p.x, p.y, p.z]))).toBe(true);
    t.tick(1300 + SCATTER_MS + 300);
    expect(t.busy).toBe(false);
    expect(t.scene3d().pieces.length).toBeLessThan(pieces); // some rolled off the table
    expect(t.scene3d().pieces.every((p) => finite([p.x, p.y, p.z]))).toBe(true);
  });

  it("a player only carries out its own colour's moves and fists, and reset clears the effects", () => {
    const t = new VirtualTable(); t.tick(0);
    expect(performAction(t, { id: 2, kind: "move", color: "b", san: "e4" }, "w", 0)).toBe(false); // black's move, white player
    expect(performAction(t, { id: 3, kind: "move", color: "w", san: "e4" }, "w", 0)).toBe(true);
    expect(performAction(t, { id: 4, kind: "fist", color: "w" }, "b", 0)).toBe(false);
    t.fistBang("w", 0); t.reset(); t.tick(100);
    expect(t.busy).toBe(false); expect(t.arms()).toEqual([]);
  });
});
