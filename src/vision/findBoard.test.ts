import { describe, expect, it } from "vitest";
import { applyH, boardToImage, invertH } from "./homography";
import { findBoardCorners, findCheckerCorners, orientBoardCorners } from "./findBoard";
import type { GrayFrame, Pt } from "./types";

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

/** Perspective board plus the clutter that used to steal the quad: grain, a cable, a lamp glare, and pieces. */
function cluttered(corners: Pt[], pieces: boolean): GrayFrame {
  const W = 480, H = 360, data = new Uint8ClampedArray(W * H), inv = invertH(boardToImage(corners));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453, speckle = 70 + (n - Math.floor(n)) * 110;
    let lum = speckle;
    if (Math.abs((x - y) - 30) < 3 && x < 140) lum = 25; // cable on the bare table
    const p = applyH(inv, x + 0.5, y + 0.5);
    if (p.x >= 0 && p.y >= 0 && p.x < 8 && p.y < 8) {
      const file = Math.min(7, Math.floor(p.x)), fromTop = Math.min(7, Math.floor(p.y));
      lum = (file + fromTop) % 2 === 0 ? 225 : 28;
      const rank = 8 - fromTop;
      if (pieces && (rank <= 2 || rank >= 7) && Math.hypot(p.x - file - 0.5, p.y - fromTop - 0.5) < 0.34) lum = rank <= 2 ? 245 : 12;
    } else if ((x - 240) ** 2 + (y - 345) ** 2 < 40 ** 2) lum = 250; // lamp below the board
    data[y * W + x] = lum;
  }
  return { width: W, height: H, data, t: 0 };
}

const closeTo = (got: Pt[], want: Pt[], tol: number) => {
  got.forEach((p, i) => expect(Math.hypot(p.x - want[i].x, p.y - want[i].y), `corner ${i}`).toBeLessThan(tol));
};

describe("findCheckerCorners", () => {
  const side: Pt[] = [
    { x: 400, y: 48 }, { x: 436, y: 278 }, { x: 168, y: 312 }, { x: 118, y: 64 }, // a8, h8, h1, a1 — white on the left
  ];

  it("stays on the board when the table, a cable and a lamp are busier than a plain background", () => {
    const found = findCheckerCorners(cluttered(side, true));
    expect(found).not.toBeNull();
    // picture order, not chess order: the top-left of this quad is a1, which the old finder would have labelled a8
    const tl = side.reduce((a, b) => (a.x + a.y <= b.x + b.y ? a : b));
    expect(Math.hypot(found![0].x - tl.x, found![0].y - tl.y)).toBeLessThan(22);
    found!.forEach((p) => {
      const d = Math.min(...side.map((q) => Math.hypot(p.x - q.x, p.y - q.y)));
      expect(d).toBeLessThan(22);
    });
  });

  it("names a8 from the pieces when white is on the left, and when white is at the top", () => {
    const named = orientBoardCorners(cluttered(side, true), findCheckerCorners(cluttered(side, true))!);
    closeTo(named, side, 22);
    const whiteAtTop: Pt[] = [{ x: 400, y: 300 }, { x: 78, y: 292 }, { x: 64, y: 42 }, { x: 392, y: 48 }];
    closeTo(orientBoardCorners(cluttered(whiteAtTop, true), findCheckerCorners(cluttered(whiteAtTop, true))!), whiteAtTop, 22);
  });

  it("puts rank 1 at the bottom of an empty upright board", () => {
    const upright: Pt[] = [{ x: 70, y: 36 }, { x: 410, y: 44 }, { x: 400, y: 310 }, { x: 60, y: 300 }];
    closeTo(orientBoardCorners(cluttered(upright, false), findCheckerCorners(cluttered(upright, false))!), upright, 22);
  });
});
