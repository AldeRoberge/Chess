import { describe, expect, it } from "vitest";
import type { GrayFrame, Pt } from "./types";
import { squareToQuad } from "../ui/quadMap";
import { findCenterSeed } from "./centerSeed";

/** A checkerboard seen through the quad `c` (a8,h8,h1,a1), with the outer two rows on each side filled with noisy "pieces". */
function render(c: Pt[], W = 480, H = 360): GrayFrame {
  const data = new Uint8ClampedArray(W * H).fill(120);
  const m = squareToQuad(c), N = 8 * 24;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const u = (i + 0.5) / N, v = (j + 0.5) / N, col = Math.floor(u * 8), row = Math.floor(v * 8), p = m(u, v), x = Math.round(p.x), y = Math.round(p.y);
    const piece = (row < 2 || row > 5) && ((i * 7 + j * 13) % 5 < 2);
    const val = piece ? 30 + ((i + j) % 3) * 80 : (col + 8 - row) % 2 === 1 ? 70 : 190;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) data[yy * W + xx] = val; }
  }
  return { width: W, height: H, data, t: 0 };
}
const mid = (c: Pt[]) => squareToQuad(c)(0.5, 0.5);
const rot = (deg: number): Pt[] => {
  const a = (deg * Math.PI) / 180, cx = 240, cy = 180, s = 150;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => ({ x: cx + (x * Math.cos(a) - y * Math.sin(a)) * s, y: cy + (x * Math.sin(a) + y * Math.cos(a)) * s }));
};

describe("findCenterSeed", () => {
  for (const deg of [0, 20, 35, 70]) it(`finds the middle, size and turn of a board turned ${deg} degrees`, () => {
    const c = rot(deg), seed = findCenterSeed(render(c));
    expect(seed).not.toBeNull();
    const want = mid(c), side = Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y) / 8;
    expect(Math.hypot(seed!.center.x - want.x, seed!.center.y - want.y)).toBeLessThan(side * 0.8);
    expect(seed!.side / side).toBeGreaterThan(0.75); expect(seed!.side / side).toBeLessThan(1.3);
  });
  it("ignores strong piece fuzz and finds the faint squares", () => {
    const c = rot(0), f = render(c);
    // faint squares (about 20 grey levels apart) and a heavy dark/bright fuzz over the two top rows only, like a real start position
    const m = squareToQuad(c), N = 8 * 24;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const u = (i + 0.5) / N, v = (j + 0.5) / N, row = Math.floor(v * 8), col = Math.floor(u * 8), p = m(u, v);
      const val = row < 2 ? ((i * 7 + j * 13) % 4 < 2 ? 10 : 250) : (col + 8 - row) % 2 === 1 ? 100 : 122;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) f.data[(Math.round(p.y) + dy) * f.width + Math.round(p.x) + dx] = val;
    }
    const seed = findCenterSeed(f), want = mid(c), side = Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y) / 8;
    expect(seed).not.toBeNull();
    expect(Math.hypot(seed!.center.x - want.x, seed!.center.y - want.y)).toBeLessThan(side * 0.8);
  });
  it("finds nothing in a plain picture", () => {
    expect(findCenterSeed({ width: 320, height: 240, data: new Uint8ClampedArray(320 * 240).fill(100), t: 0 })).toBeNull();
  });
});
