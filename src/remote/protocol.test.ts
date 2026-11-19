import { describe, expect, it } from "vitest";
import { codeFromHash, isRemoteHash, joinUrl, needsPromotion, parseCommand, positionAt, scoreSheet, sideName, targetsFrom } from "./protocol";

describe("remote protocol", () => {
  it("accepts a well-formed move and rejects everything else", () => {
    expect(parseCommand({ type: "move", from: "e2", to: "e4" })).toEqual({ type: "move", from: "e2", to: "e4" });
    expect(parseCommand({ type: "move", from: "e7", to: "e8", promotion: "n" })).toEqual({ type: "move", from: "e7", to: "e8", promotion: "n" });
    expect(parseCommand({ type: "resign" })).toEqual({ type: "resign" });
    expect(parseCommand({ type: "draw" })).toEqual({ type: "draw" });
    expect(parseCommand({ type: "takeback" })).toEqual({ type: "takeback" });
    for (const bad of [null, "e2e4", 5, {}, { type: "move" }, { type: "castle" }, { type: "move", from: "e9", to: "e4" }, { type: "move", from: "e2", to: "e4", promotion: "k" }, { type: "move", from: "e2", to: "e4", promotion: "qq" }, { type: "move", from: 1, to: 2 }])
      expect(parseCommand(bad)).toBeNull();
  });
  it("lays the moves out as a score sheet, an odd last move leaving black empty", () => {
    expect(scoreSheet([])).toEqual([]);
    expect(scoreSheet(["e4", "e5", "Nf3"])).toEqual([{ n: 1, white: "e4", black: "e5" }, { n: 2, white: "Nf3", black: null }]);
  });
  it("replays to any half-move, and stops at a move that does not apply instead of throwing", () => {
    expect(positionAt(["e4", "e5"], 0)).toMatchObject({ applied: 0, last: null });
    const p = positionAt(["e4", "e5", "Nf3"], 2); expect(p).toMatchObject({ applied: 2, last: { from: "e7", to: "e5" } });
    expect(positionAt(["e4", "Qh8"], 5).applied).toBe(1);
    expect(positionAt(["e4"], -3).applied).toBe(0);
  });
  it("lists legal targets and knows when a move promotes", () => {
    const start = positionAt([], 0).fen;
    expect(targetsFrom(start, "e2").sort()).toEqual(["e3", "e4"]);
    expect(targetsFrom(start, "e5")).toEqual([]);
    expect(targetsFrom("not a fen", "e2")).toEqual([]);
    const promo = "8/4P3/8/8/8/8/8/k6K w - - 0 1";
    expect(needsPromotion(promo, "e7", "e8")).toBe(true); expect(needsPromotion(start, "e2", "e4")).toBe(false); expect(needsPromotion("bad", "e7", "e8")).toBe(false);
  });
  it("builds and reads join addresses", () => {
    expect(joinUrl("http://10.0.0.2:5173", "12 34", "/")).toBe("http://10.0.0.2:5173/#/remote?code=12%2034");
    expect(codeFromHash("#/remote?code=4821")).toBe("4821"); expect(codeFromHash("#/remote")).toBe(""); expect(codeFromHash("#/remote?code= 7 ")).toBe("7");
    expect(isRemoteHash("#/remote")).toBe(true); expect(isRemoteHash("#/remote?code=1")).toBe(true); expect(isRemoteHash("#/table")).toBe(false); expect(isRemoteHash("#/remotely")).toBe(false);
    expect(sideName("w")).toBe("White"); expect(sideName("b")).toBe("Black");
  });
});
