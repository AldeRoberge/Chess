import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { explainMismatch } from "./mismatch";
import { sqIndex, type BoardBelief } from "../vision/types";

/** The detector's picture of exactly the start position, then edited. */
function startBelief(): BoardBelief {
  const occ = new Float32Array(64), white = new Float32Array(64), conf = new Float32Array(64).fill(0.9);
  new Chess().board().forEach((row, r) => row.forEach((p, c) => { if (p) { occ[r * 8 + c] = 1; white[r * 8 + c] = p.color === "w" ? 1 : 0; } }));
  return { t: 0, occ, white, conf, fidelity: 0.9, handOver: false, settled: true, cams: 1 };
}

describe("explainMismatch", () => {
  const fen = new Chess().fen();
  it("says nothing when the picture matches", () => {
    const m = explainMismatch(fen, [], startBelief());
    expect(m.items).toEqual([]); expect(m.summary).toBe("");
  });
  it("names an extra piece, a missing piece and a wrong colour in plain English, each with its confidence", () => {
    const b = startBelief();
    b.occ[sqIndex("e4")] = 1; b.white[sqIndex("e4")] = 1; b.conf[sqIndex("e4")] = 0.87; // an extra white piece on e4
    b.occ[sqIndex("d1")] = 0; b.conf[sqIndex("d1")] = 0.04; // the white queen is not seen
    b.white[sqIndex("b8")] = 1; b.conf[sqIndex("b8")] = 0.61; // the black knight looks white
    const m = explainMismatch(fen, ["e4", "d1", "b8"].map(sqIndex), b);
    expect(m.items.map((x) => x.kind)).toEqual(["extra", "missing", "colour"]);
    expect(m.items[0].sentence).toBe("The detector thinks there is an extra white piece on e4, but the game says that square is empty (87% sure).");
    expect(m.items[1].sentence).toContain("d1 is empty"); expect(m.items[1].sentence).toContain("white queen"); expect(m.items[1].sentence).toContain("(4% sure)");
    expect(m.items[2].short).toBe("b8: looks white, not black (61%)");
    expect(m.summary).toBe("1 extra piece, 1 missing piece, 1 wrong colour");
  });
  it("pluralises and explains a hand, and a turned board", () => {
    const b = startBelief();
    for (const s of ["a3", "b3"]) { b.occ[sqIndex(s)] = 1; b.white[sqIndex(s)] = 1; }
    const two = explainMismatch(fen, ["a3", "b3"].map(sqIndex), b);
    expect(two.summary).toBe("2 extra pieces"); expect(two.hint).toMatch(/hand|shadow/);
    const flipped = startBelief(); for (let i = 0; i < 64; i++) if (flipped.occ[i]) flipped.white[i] = 1 - flipped.white[i];
    const all = [...Array(64).keys()].filter((i) => flipped.occ[i]);
    const m = explainMismatch(fen, all, flipped);
    expect(m.summary).toBe("32 wrong colours"); expect(m.hint).toMatch(/turned|swapped|grid/);
  });
  it("copes with no reading or a bad position", () => {
    expect(explainMismatch(fen, [sqIndex("e4")], null).items).toEqual([]);
    expect(explainMismatch("nonsense", [1], startBelief()).items).toEqual([]);
  });
});
