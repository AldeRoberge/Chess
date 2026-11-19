import { describe, expect, it } from "vitest";
import { findBoardCorners } from "./findBoard";
import type { GrayFrame } from "./types";

/** Flat grey picture with an axis-aligned 8x8 checkerboard of `sq` px squares at (x0, y0). */
function scene(w: number, h: number, x0: number, y0: number, sq: number): GrayFrame {
  const data = new Uint8ClampedArray(w * h).fill(120);
  for (let y = 0; y < 8 * sq; y++) for (let x = 0; x < 8 * sq; x++) {
    data[(y0 + y) * w + x0 + x] = (Math.floor(x / sq) + Math.floor(y / sq)) % 2 ? 235 : 20;
  }
  return { width: w, height: h, data, t: 0 };
}

describe("findBoardCorners", () => {
  it("finds the corners of a checkerboard on a plain background, ordered TL, TR, BR, BL", () => {
    const c = findBoardCorners(scene(320, 240, 80, 40, 20))!;
    expect(c).not.toBeNull();
    const want = [{ x: 80, y: 40 }, { x: 240, y: 40 }, { x: 240, y: 200 }, { x: 80, y: 200 }];
    c.forEach((p, i) => { expect(Math.abs(p.x - want[i].x)).toBeLessThan(14); expect(Math.abs(p.y - want[i].y)).toBeLessThan(14); });
  });

  it("returns null for a flat picture or one that is too small", () => {
    expect(findBoardCorners({ width: 320, height: 240, data: new Uint8ClampedArray(320 * 240).fill(100), t: 0 })).toBeNull();
    expect(findBoardCorners({ width: 8, height: 8, data: new Uint8ClampedArray(64), t: 0 })).toBeNull();
  });
});
