import { describe, expect, it } from "vitest";
import { boardHover, boardSquareAt, cropFrame, frameHover } from "./hover";
import type { BoardBelief } from "../vision/types";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const belief = (): BoardBelief => {
  const occ = new Float32Array(64), white = new Float32Array(64).fill(0.5), conf = new Float32Array(64).fill(0.9);
  for (let i = 0; i < 16; i++) { occ[i] = 0.95; white[i] = 0.05; occ[48 + i] = 0.95; white[48 + i] = 0.95; }
  return { t: 0, occ, white, conf, fidelity: 0.9, handOver: false, settled: true, cams: 2 };
};

describe("preview hover", () => {
  it("maps a point on a drawn board to its square", () => {
    expect(boardSquareAt({ x: 5, y: 5 }, 80, 80)).toBe(0); // a8
    expect(boardSquareAt({ x: 75, y: 75 }, 80, 80)).toBe(63); // h1
    expect(boardSquareAt({ x: 100, y: 5 }, 80, 80)).toBeNull();
    expect(boardSquareAt({ x: 25, y: 5 }, 120, 80)).toBe(0); // board is centred: 20 px margin
  });

  it("describes the square, the tracked piece and the camera evidence", () => {
    const info = boardHover({ x: 45, y: 75 }, 80, 80, belief(), { title: "Fusion", fen: START })!; // e1
    expect(info.title).toBe("e1");
    expect(info.rows!.find((r) => r.label === "Tracked piece")!.value).toBe("white king");
    expect(info.rows!.find((r) => r.label === "Cameras vs. game")!.value).toBe("agree");
    expect(info.mark).toBeTypeOf("function");
  });

  it("flags a disagreement between cameras and the game", () => {
    const b = belief(); b.occ[60] = 0.02; // e1 looks empty although the game has a king there
    const info = boardHover({ x: 45, y: 75 }, 80, 80, b, { title: "Fusion", fen: START })!;
    expect(info.rows!.find((r) => r.label === "Cameras vs. game")).toMatchObject({ value: "disagree", tone: "bad" });
  });

  it("reads the pixel under the pointer and crops around it", () => {
    const data = new Uint8ClampedArray(40 * 30).map((_, i) => i % 256);
    const f = { width: 40, height: 30, data, t: 0 };
    const info = frameHover({ x: 40, y: 30 }, 80, 60, [80, 60], f, "Camera")!;
    expect(info.title).toBe("pixel 20, 15");
    expect(info.rows![0].value).toBe(`${data[15 * 40 + 20]} / 255`);
    expect(info.preview!.frame!.width).toBe(25);
    expect(cropFrame(f, 0, 0).data[12 * 25 + 12]).toBe(data[0]);
  });
});
