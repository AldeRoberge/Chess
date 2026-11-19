import { describe, expect, it } from "vitest";
import type { GrayFrame, Pt } from "../vision/types";
import { squareToQuad } from "./quadMap";
import { AlignFollower, AutoAligner, candidateLayouts, evaluate } from "./autoAlign";

/** A checkerboard seen with some perspective: the unit square is mapped through the quad `c` (a8,h8,h1,a1), a1 dark. */
function render(c: Pt[], W = 480, H = 360): GrayFrame {
  const data = new Uint8ClampedArray(W * H).fill(120);
  // inverse by sampling: for every picture pixel, find (u,v) by bilinear-ish search is costly; instead paint forward at high density
  const m = squareToQuad(c), N = 8 * 24;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const u = (i + 0.5) / N, v = (j + 0.5) / N, col = Math.floor(u * 8), row = Math.floor(v * 8), p = m(u, v), x = Math.round(p.x), y = Math.round(p.y), val = (col + 8 - row) % 2 === 1 ? 70 : 190;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) data[yy * W + xx] = val; }
  }
  const tmp = new Float32Array(W * H), out = new Uint8ClampedArray(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let a = 0, n = 0; for (let k = -2; k <= 2; k++) { const xx = x + k; if (xx >= 0 && xx < W) { a += data[y * W + xx]; n++; } } tmp[y * W + x] = a / n; }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let a = 0, n = 0; for (let k = -2; k <= 2; k++) { const yy = y + k; if (yy >= 0 && yy < H) { a += tmp[yy * W + x]; n++; } } out[y * W + x] = a / n; }
  return { width: W, height: H, data: out, t: 0 };
}
const TRUE: Pt[] = [{ x: 110, y: 40 }, { x: 390, y: 55 }, { x: 410, y: 330 }, { x: 90, y: 315 }];
const worst = (a: Pt[], b: Pt[]) => Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y)));
const run = (a: AutoAligner) => { for (let i = 0; i < 5000 && a.step(50); i++); return a; };

describe("auto align", () => {
  const f = render(TRUE);
  it("offers ten different layouts", () => {
    const c = candidateLayouts(f, TRUE); expect(c).toHaveLength(10);
    expect(new Set(c.map((q) => q.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join())).size).toBeGreaterThan(5);
  });
  it("settles on the board from corners that are off", () => {
    const off = TRUE.map((p, i) => ({ x: p.x + [14, -12, 10, -16][i], y: p.y + [-10, 12, 15, -9][i] }));
    const a = run(new AutoAligner(f, off, 0));
    expect(a.phase).toBe("done"); expect(worst(a.corners, TRUE)).toBeLessThan(4.5); expect(a.progress).toBe(1); expect(a.confidence).toBeGreaterThan(0.5);
  });
  it("puts the corners in the right order when they start turned", () => {
    const turned = [TRUE[1], TRUE[2], TRUE[3], TRUE[0]];
    const a = run(new AutoAligner(f, turned, 0));
    // with no pieces on it, a board turned half way looks the same: either order is right
    expect(Math.min(worst(a.corners, TRUE), worst(a.corners, [TRUE[2], TRUE[3], TRUE[0], TRUE[1]]))).toBeLessThan(4.5);
  });
  it("follows a small camera move", () => {
    let t = 0; const fol = new AlignFollower(0, () => t);
    const fit = run(new AutoAligner(f, TRUE, 0)).corners; fol.lock(f, fit);
    const shifted = TRUE.map((p) => ({ x: p.x + 7, y: p.y + 4 })), g = render(shifted);
    expect(evaluate(g, fit).q).toBeLessThan(evaluate(f, fit).q);
    let out: Pt[] | null = null; for (let i = 0; i < 200 && !out; i++) { t += 600; out = fol.tick(g, fit, 1000); }
    expect(out).not.toBeNull(); expect(worst(out!, shifted)).toBeLessThan(4.5);
  });
  it("leaves a steady grid alone", () => {
    let t = 0; const fol = new AlignFollower(0, () => t); fol.lock(f, TRUE); t += 600;
    expect(fol.tick(f, TRUE, 1000)).toBeNull(); expect(fol.status).toBe("locked");
  });
});
