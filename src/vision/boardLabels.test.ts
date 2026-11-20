import { afterEach, describe, expect, it } from "vitest";
import { type LabelHit, labelHints, quadsFromLabels, setOcrEngine } from "./boardLabels";
import type { GrayFrame, Pt } from "./types";

// A board turned by `ang`, a square `sq` pixels wide, its a8 corner at `o`. Labels sit 0.5 square outside the edges.
function labels(o: Pt, sq: number, ang: number, opts: { letters?: boolean; digits?: boolean; top?: boolean } = {}): { hits: LabelHit[]; quad: Pt[] } {
  const c = Math.cos(ang), s = Math.sin(ang), at = (u: number, v: number): Pt => ({ x: o.x + sq * (u * c - v * s), y: o.y + sq * (u * s + v * c) });
  const hits: LabelHit[] = [];
  if (opts.letters !== false) for (let i = 0; i < 8; i++) { const p = at(i + 0.5, opts.top ? -0.5 : 8.5); hits.push({ ch: "abcdefgh"[i], ...p, conf: 90 }); }
  if (opts.digits !== false) for (let j = 0; j < 8; j++) { const p = at(-0.5, j + 0.5); hits.push({ ch: String(8 - j), ...p, conf: 90 }); }
  return { hits, quad: [at(0, 0), at(8, 0), at(8, 8), at(0, 8)] };
}
const err = (a: Pt[], b: Pt[]) => Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y)));

describe("quadsFromLabels", () => {
  it("finds the corners from letters and digits, in a8 h8 h1 a1 order", () => {
    for (const ang of [0, 0.3, -0.5, Math.PI]) {
      const { hits, quad } = labels({ x: 300, y: 200 }, 40, ang);
      const q = quadsFromLabels(hits)[0];
      expect(q, `angle ${ang}`).toBeTruthy();
      expect(err(q, quad)).toBeLessThan(1);
    }
  });
  it("ignores stray reads", () => {
    const { hits, quad } = labels({ x: 100, y: 80 }, 30, 0.1);
    hits.push({ ch: "c", x: 5, y: 400, conf: 80 }, { ch: "4", x: 700, y: 20, conf: 80 }, { ch: "h", x: 90, y: 90, conf: 40 });
    expect(err(quadsFromLabels(hits)[0], quad)).toBeLessThan(1);
  });
  it("copes with missing labels", () => {
    const { hits, quad } = labels({ x: 100, y: 80 }, 30, 0);
    const some = hits.filter((h) => !"bf37".includes(h.ch));
    expect(err(quadsFromLabels(some)[0], quad)).toBeLessThan(1);
  });
  it("guesses from letters alone, one guess per side of the board", () => {
    const { hits, quad } = labels({ x: 200, y: 100 }, 40, 0.2, { digits: false });
    const qs = quadsFromLabels(hits);
    expect(qs.length).toBe(2);
    expect(Math.min(...qs.map((q) => err(q, quad)))).toBeLessThan(1);
  });
  it("guesses from digits alone", () => {
    const { hits, quad } = labels({ x: 200, y: 100 }, 40, -0.2, { letters: false });
    expect(Math.min(...quadsFromLabels(hits).map((q) => err(q, quad)))).toBeLessThan(1);
  });
  it("gives nothing for too few labels", () => {
    expect(quadsFromLabels(labels({ x: 0, y: 0 }, 30, 0).hits.slice(0, 2))).toEqual([]);
    expect(quadsFromLabels([])).toEqual([]);
  });
});

describe("labelHints", () => {
  afterEach(() => setOcrEngine(null));
  const frame = (): GrayFrame => ({ width: 640, height: 480, data: new Uint8ClampedArray(640 * 480), t: 0 });
  it("turns the picture when the first look finds nothing", async () => {
    const { hits, quad } = labels({ x: 200, y: 100 }, 40, 0);
    const seen: number[] = [];
    setOcrEngine(async (_f, rot) => { seen.push(rot); return rot === 180 ? hits : []; });
    const q = await labelHints(frame());
    expect(seen).toEqual([0, 180]);
    expect(err(q[0], quad)).toBeLessThan(1);
  });
  it("resolves empty, and never rejects, when the reader fails", async () => {
    setOcrEngine(async () => { throw new Error("no ocr"); });
    expect(await labelHints(frame())).toEqual([]);
  });
  it("reads a picture once", async () => {
    let n = 0; setOcrEngine(async () => { n++; return []; });
    const f = frame(); await labelHints(f); const first = n; await labelHints(f);
    expect(n).toBe(first);
  });
});
