import { describe, expect, it } from "vitest";
import { COACH_LABEL, drawPlacementMoves, movesFromReading, startCode } from "./pieceCoach";

const home = () => {
  const occ = new Float32Array(64), white = new Float32Array(64).fill(0.5);
  for (let sq = 0; sq < 64; sq++) {
    const code = startCode(sq);
    if (!code) continue;
    occ[sq] = 0.95; white[sq] = code[0] === "w" ? 0.95 : 0.05;
  }
  return { occ, white };
};

describe("piece placement coach", () => {
  it("names the starting pieces", () => {
    expect(startCode(0)).toBe("br"); expect(startCode(4)).toBe("bk"); expect(startCode(8)).toBe("bp");
    expect(startCode(48)).toBe("wp"); expect(startCode(55)).toBe("wp"); expect(startCode(63)).toBe("wr");
    expect(startCode(40)).toBe(""); expect(startCode(27)).toBe("");
  });

  it("stays quiet when every square looks occupied, and when the pieces are already home", () => {
    const { occ, white } = home();
    expect(movesFromReading(occ, white)).toEqual([]);
    expect(movesFromReading(new Float32Array(64).fill(0.9), new Float32Array(64).fill(0.9))).toBeNull();
  });
  it("walks a single white piece on a3 back to a2", () => {
    const occ = new Float32Array(64), white = new Float32Array(64).fill(0.5);
    occ[40] = 0.9; white[40] = 0.9;
    expect(movesFromReading(occ, white)).toEqual([{ from: 40, to: 48, code: "wp" }]);
  });

  it("sends a pawn on a3 back to a2 and a pawn on h4 back to h2", () => {
    const { occ, white } = home();
    occ[48] = 0.05; occ[55] = 0.05;
    occ[40] = 0.95; white[40] = 0.95; // a3
    occ[39] = 0.95; white[39] = 0.95; // h4
    expect(movesFromReading(occ, white)).toEqual([
      { from: 40, to: 48, code: "wp" },
      { from: 39, to: 55, code: "wp" },
    ]);
  });

  it("does not tell you to move pieces that already fill the starting squares, even when the colours are swapped", () => {
    const { occ, white } = home();
    for (let sq = 0; sq < 64; sq++) if (startCode(sq)) white[sq] = startCode(sq)[0] === "w" ? 0.05 : 0.95;
    expect(movesFromReading(occ, white)).toEqual([]);
  });

  it("draws the destination square names along the path", () => {
    const c = document.createElement("canvas").getContext("2d")!;
    const names: string[] = [];
    const fillText = c.fillText.bind(c);
    c.fillText = ((text: string, x: number, y: number) => { names.push(text); return fillText(text, x, y); }) as typeof c.fillText;
    drawPlacementMoves(c, (u, v) => ({ x: u * 80, y: v * 80 }), [{ from: 40, to: 48, code: "wp" }], 0);
    expect(names).toContain("a2");
    expect(COACH_LABEL).toMatch(/Move them like this/);
  });
});
