import { describe, expect, it } from "vitest";
import type { GrayFrame, Pt } from "../vision/types";
import { squareToQuad } from "./quadMap";
import { traceSquareGuide } from "./boardGuide";
import { AlignFollower, AutoAligner, candidateLayouts, evaluate, rememberLayout, rememberedLayouts } from "./autoAlign";

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
  it("retains an already good alignment without exploring replacement layouts", () => {
    expect(evaluate(f, TRUE).q).toBeGreaterThanOrEqual(0.7);
    const a = new AutoAligner(f, TRUE, 0);
    run(a);
    expect(a.phase).toBe("done");
    expect(a.corners).toEqual(TRUE);
    expect(a.label).toBe("Kept existing alignment");
  });
  it("guesses from the picture and from earlier alignments, not from shifted copies", () => {
    const c = candidateLayouts(f, TRUE);
    expect(c.length).toBeGreaterThan(0);
    expect(c.length).toBeLessThanOrEqual(6);
    expect(c.some((q) => worst(q, TRUE) < 1)).toBe(true);
    const shift = (a: Pt[], b: Pt[]) => {
      const dx = a[0].x - b[0].x, dy = a[0].y - b[0].y;
      return a.every((p, i) => Math.abs(p.x - b[i].x - dx) < 1.5 && Math.abs(p.y - b[i].y - dy) < 1.5);
    };
    for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) expect(shift(c[i], c[j])).toBe(false);
  });
  it("remembers an alignment and tries it again next time, including at another resolution", () => {
    const box = new Map<string, string>();
    const store = { getItem: (k: string) => box.get(k) ?? null, setItem: (k: string, v: string) => { box.set(k, v); } };
    rememberLayout(TRUE, 480, 360, store);
    expect(worst(rememberedLayouts(480, 360, store)[0], TRUE)).toBeLessThan(0.01);
    expect(rememberedLayouts(960, 720, store)[0][0].x).toBeCloseTo(TRUE[0].x * 2, 4);
    const old = TRUE.map((p) => ({ x: p.x + 40, y: p.y - 25 }));
    rememberLayout(old, 480, 360, store);
    rememberLayout(old, 480, 360, store);
    const both = rememberedLayouts(480, 360, store);
    expect(both).toHaveLength(2);
    expect(worst(both[0], old)).toBeLessThan(0.01);
    const c = candidateLayouts(f, null, both);
    expect(c.some((q) => worst(q, old) < 1)).toBe(true);
    expect(c.some((q) => worst(q, TRUE) < 40)).toBe(true);
    expect(rememberedLayouts(10, 10, { getItem: () => "{", setItem: () => {} })).toEqual([]);
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
  it("follows a small camera move, easing toward it instead of jumping", () => {
    let t = 0; const fol = new AlignFollower(0, () => t);
    const fit = run(new AutoAligner(f, TRUE, 0)).corners; fol.lock(f, fit);
    const shifted = TRUE.map((p) => ({ x: p.x + 7, y: p.y + 4 })), g = render(shifted);
    expect(evaluate(g, fit).q).toBeLessThan(evaluate(f, fit).q);
    let cur = fit, first: Pt[] | null = null;
    for (let i = 0; i < 80 && worst(cur, shifted) >= 4.5; i++) {
      t += 20;
      const step = fol.tick(g, cur, 1000);
      if (!step) continue;
      if (!first) first = step;
      cur = step;
    }
    expect(first).not.toBeNull();
    expect(worst(first!, fit)).toBeLessThan(worst(shifted, fit) * 0.5);
    expect(worst(cur, shifted)).toBeLessThan(4.5);
  });
  it("takes its perspective from the square edges, including when the rim is covered", () => {
    const skew = [{ x: TRUE[0].x + 16, y: TRUE[0].y - 6 }, { x: TRUE[1].x - 8, y: TRUE[1].y + 10 }, { x: TRUE[2].x - 14, y: TRUE[2].y + 12 }, { x: TRUE[3].x + 11, y: TRUE[3].y - 9 }];
    const g = traceSquareGuide(f, skew);
    expect(g).not.toBeNull();
    expect(worst(g!.corners, TRUE)).toBeLessThan(8);
    const covered = { ...f, data: new Uint8ClampedArray(f.data) }, m = squareToQuad(TRUE);
    for (let v = 0; v <= 1.001; v += 0.003) for (let u = 0; u <= 1.001; u += 0.003) {
      const r = Math.min(7, Math.floor(v * 8)), c = Math.min(7, Math.floor(u * 8));
      if (r >= 2 && r <= 5 && c >= 2 && c <= 5) continue;
      const p = m(Math.min(u, 0.999), Math.min(v, 0.999)), x = Math.round(p.x), y = Math.round(p.y);
      if (x >= 0 && y >= 0 && x < covered.width && y < covered.height) covered.data[y * covered.width + x] = 110;
    }
    const mid = traceSquareGuide(covered, skew);
    expect(mid).not.toBeNull();
    expect(worst(mid!.corners, TRUE)).toBeLessThan(10);
  });
  it("leaves a steady grid alone", () => {
    let t = 0; const fol = new AlignFollower(0, () => t); fol.lock(f, TRUE); t += 600;
    expect(fol.tick(f, TRUE, 1000)).toBeNull(); expect(fol.status).toBe("locked");
  });
});

describe("alignConcurrency", () => {
  it("scales with threads, leaves one for the page, caps at 8 and stays at least 1", async () => {
    const { alignConcurrency } = await import("./autoAlign");
    expect(alignConcurrency({ hardwareConcurrency: 32 })).toBe(8);
    expect(alignConcurrency({ hardwareConcurrency: 8 })).toBe(7);
    expect(alignConcurrency({ hardwareConcurrency: 1 })).toBe(1);
    expect(alignConcurrency({ hardwareConcurrency: 16, deviceMemory: 2 })).toBe(2);
  });
});

describe("AlignBatch", () => {
  it("aligns several boards, never more than the limit at once", async () => {
    const { AlignBatch } = await import("./autoAlign");
    const fr = render(TRUE), off = TRUE.map((p, i) => ({ x: p.x + [10, -8, 7, -9][i], y: p.y + [-7, 8, 9, -6][i] }));
    // Scheduling must not depend on coverage overhead or other work on the machine.
    let clock = 0;
    const b = new AlignBatch([1, 2, 3, 4, 5].map((n) => ({ id: `c${n}`, frame: fr, start: off })), 3, 0, () => ++clock, 2);
    let peak = 0; const seen = new Set<number>();
    for (let i = 0; i < 5000 && b.step(50); i++) { peak = Math.max(peak, b.active); seen.add(b.active); }
    expect(peak).toBe(3); expect(seen.has(2)).toBe(true); // starts with 2, then scales up to the limit
    expect(b.results.size).toBe(5);
    for (const r of b.results.values()) { expect(r.phase).toBe("done"); expect(worst(r.corners, TRUE)).toBeLessThan(4.5); }
  }, 60000);
});

describe("AutoAligner with board labels", () => {
  it("waits for the OCR reading, then tries its corners first", async () => {
    const { AutoAligner, candidateLayouts } = await import("./autoAlign");
    const f = { width: 200, height: 200, data: new Uint8ClampedArray(200 * 200).fill(128), t: 0 };
    const guess = [{ x: 20, y: 20 }, { x: 180, y: 20 }, { x: 180, y: 180 }, { x: 20, y: 180 }];
    expect(candidateLayouts(f, null, [], [guess])[0]).toEqual(guess);
    let release: (q: typeof guess[]) => void = () => {};
    const a = new AutoAligner(f, null, 0);
    a.expectLabels(new Promise((r) => { release = r; }));
    a.step(5);
    expect(a.label).toMatch(/letters/);
    expect(a.done).toBe(false);
    release([guess]);
    await Promise.resolve(); await Promise.resolve();
    for (let i = 0; i < 400 && a.step(50); i++);
    expect(a.done).toBe(true);
  });
  it("carries on without labels when the reading fails", async () => {
    const { AutoAligner } = await import("./autoAlign");
    const f = { width: 100, height: 100, data: new Uint8ClampedArray(100 * 100).fill(128), t: 0 };
    const a = new AutoAligner(f, null, 0);
    a.expectLabels(Promise.reject(new Error("x")));
    await Promise.resolve(); await Promise.resolve();
    for (let i = 0; i < 100 && a.step(50); i++);
    expect(a.done).toBe(true);
  });
});
