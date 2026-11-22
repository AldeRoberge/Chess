import { describe, expect, it } from "vitest";
import { toGray, unsharp } from "./sources";

// The original two-pass capture path (per-frame allocation, separate exposure pass), kept as the reference.
function grayTwoPass(px: Uint8ClampedArray, tw: number, th: number, ch: string, gain: number): Uint8ClampedArray {
  const g = new Uint8ClampedArray(tw * th);
  const n = g.length;
  if (ch === "red") for (let i = 0; i < n; i++) g[i] = px[i * 4];
  else if (ch === "green") for (let i = 0; i < n; i++) g[i] = px[i * 4 + 1];
  else if (ch === "blue") for (let i = 0; i < n; i++) g[i] = px[i * 4 + 2];
  else for (let i = 0; i < n; i++) g[i] = px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114;
  if (gain !== 1) for (let i = 0; i < n; i++) g[i] = g[i] * gain;
  return g;
}

// The original unsharp mask (fresh buffers each call), kept as the reference.
function unsharpRef(g: Uint8ClampedArray, w: number, h: number, amount: number) {
  if (w < 3 || h < 3) return;
  const tmp = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) {
    const r = y * w;
    tmp[r] = g[r] * 2 + g[r + 1];
    for (let x = 1; x < w - 1; x++) tmp[r + x] = g[r + x - 1] + g[r + x] + g[r + x + 1];
    tmp[r + w - 1] = g[r + w - 2] + g[r + w - 1] * 2;
  }
  const src = new Uint8ClampedArray(g);
  for (let y = 0; y < h; y++) {
    const up = (y > 0 ? y - 1 : 0) * w, mid = y * w, dn = (y < h - 1 ? y + 1 : h - 1) * w;
    for (let x = 0; x < w; x++) {
      const blur = (tmp[up + x] + tmp[mid + x] + tmp[dn + x]) / 9;
      g[mid + x] = src[mid + x] + amount * (src[mid + x] - blur);
    }
  }
}

function randomRgba(w: number, h: number, seed: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  let s = seed;
  for (let i = 0; i < out.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; out[i] = s & 255; }
  return out;
}

describe("webcam grayscale fold", () => {
  it("gives the same bytes as the two-pass version for every channel and exposure gain", () => {
    const w = 37, h = 23, px = randomRgba(w, h, 3);
    for (const ch of ["luma", "red", "green", "blue"]) for (const gain of [1, 0.55, 0.91, 1.7, 2.9, 4]) {
      const want = grayTwoPass(px, w, h, ch, gain), got = new Uint8ClampedArray(w * h);
      toGray(px, got, ch, gain);
      expect(Array.from(got), `${ch} gain ${gain}`).toEqual(Array.from(want));
    }
  });
});

describe("unsharp with reused scratch buffers", () => {
  it("matches the fresh-buffer reference across repeated calls of changing size", () => {
    for (const [w, h] of [[64, 48], [20, 10], [64, 48], [3, 3], [2, 9]] as const) {
      const base = randomRgba(w, h, w * 31 + h).filter((_, i) => i % 4 === 0);
      const a = new Uint8ClampedArray(base), b = new Uint8ClampedArray(base);
      unsharp(a, w, h, 1.3); unsharpRef(b, w, h, 1.3);
      expect(Array.from(a)).toEqual(Array.from(b));
    }
  });
});

describe("webcam capture loop timing (rough, logged only)", () => {
  it("times the original and the new gray + exposure + sharpen path at 1280x960, interleaved", () => {
    const w = 1280, h = 960, px = randomRgba(w, h, 7);
    const before = () => { const g = grayTwoPass(px, w, h, "luma", 0.6); unsharpRef(g, w, h, 1); return g; };
    const after = () => { const g = new Uint8ClampedArray(w * h); toGray(px, g, "luma", 0.6); unsharp(g, w, h, 1); return g; };
    for (let i = 0; i < 3; i++) { before(); after(); } // warm up
    let tb = 0, ta = 0; const rounds = 20;
    for (let i = 0; i < rounds; i++) {
      let t = performance.now(); before(); tb += performance.now() - t;
      t = performance.now(); after(); ta += performance.now() - t;
    }
    console.log(`[perf] before ${(tb / rounds).toFixed(2)} ms/frame, after ${(ta / rounds).toFixed(2)} ms/frame (${w}x${h}, interleaved)`);
    expect(ta).toBeGreaterThan(0);
  });
});
