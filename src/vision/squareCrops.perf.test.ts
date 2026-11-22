import { describe, expect, it } from "vitest";
import { applyH, boardToImage } from "./homography";
import { BOARD_MARGIN, BOARD_PX, BOARD_SIDE, extractBoard } from "./boardImage";
import { boardGain, CROP, CROP_SPAN, extractCrops, pixel, TARGET_MEAN } from "./squareCrops";
import type { GrayFrame, Pt } from "./types";

/** The per-pixel reference the warp tables replace (same arithmetic, kept here to prove the outputs are identical). */
function refCrops(frame: GrayFrame, corners: Pt[]): Float32Array {
  const out = new Float32Array(64 * CROP * CROP), H = boardToImage(corners), gain = boardGain(frame, H) / (2 * TARGET_MEAN);
  for (let sq = 0; sq < 64; sq++) {
    const cu = (sq % 8) + 0.5, cv = Math.floor(sq / 8) + 0.5, base = sq * CROP * CROP;
    for (let j = 0; j < CROP; j++)
      for (let i = 0; i < CROP; i++) {
        const p = applyH(H, cu + ((i + 0.5) / CROP - 0.5) * CROP_SPAN, cv + ((j + 0.5) / CROP - 0.5) * CROP_SPAN), v = pixel(frame, p.x, p.y);
        out[base + j * CROP + i] = Number.isFinite(v) ? Math.min(2, v * gain) : 0;
      }
  }
  return out;
}

function refBoard(frame: GrayFrame, corners: Pt[]): Float32Array {
  const out = new Float32Array(BOARD_SIDE * BOARD_SIDE), H = boardToImage(corners), gain = boardGain(frame, H) / (2 * TARGET_MEAN);
  for (let j = 0; j < BOARD_SIDE; j++)
    for (let i = 0; i < BOARD_SIDE; i++) {
      const p = applyH(H, (i + 0.5) / BOARD_PX - BOARD_MARGIN, (j + 0.5) / BOARD_PX - BOARD_MARGIN), v = pixel(frame, p.x, p.y);
      out[j * BOARD_SIDE + i] = Number.isFinite(v) ? Math.min(2, v * gain) : 0;
    }
  return out;
}

function randomFrame(w: number, h: number, seed: number): GrayFrame {
  let s = seed;
  const data = new Uint8ClampedArray(w * h);
  for (let i = 0; i < data.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; data[i] = s % 256; }
  return { width: w, height: h, data, t: 0 };
}

const corners: Pt[] = [{ x: 40.3, y: 20.7 }, { x: 441.2, y: 19.1 }, { x: 452.8, y: 339.5 }, { x: 31.6, y: 343.9 }];
const offImage: Pt[] = [{ x: -30, y: 10 }, { x: 500, y: -5 }, { x: 520, y: 400 }, { x: -40, y: 390 }];

function time(fn: () => void, reps: number): number {
  fn();
  const t0 = performance.now();
  for (let r = 0; r < reps; r++) fn();
  return (performance.now() - t0) / reps;
}

describe("warp tables for the square crops and the board image", () => {
  it("match the per-pixel reference bit for bit, including corners running off the frame", () => {
    for (const cs of [corners, offImage]) {
      const f1 = randomFrame(480, 360, 7), f2 = randomFrame(480, 360, 99);
      for (const f of [f1, f2, f1]) {
        expect(extractCrops(f, cs)).toEqual(refCrops(f, cs));
        expect(extractBoard(f, cs)).toEqual(refBoard(f, cs));
      }
    }
  });

  it("are faster than the per-pixel reference (measured per frame)", () => {
    const f = randomFrame(480, 360, 3);
    const refC = time(() => refCrops(f, corners), 5), newC = time(() => extractCrops(f, corners), 20);
    const refB = time(() => refBoard(f, corners), 5), newB = time(() => extractBoard(f, corners), 20);
    console.log(`extractCrops: ${refC.toFixed(2)} ms -> ${newC.toFixed(2)} ms; extractBoard: ${refB.toFixed(2)} ms -> ${newB.toFixed(2)} ms`);
    expect(newC).toBeLessThan(refC);
    expect(newB).toBeLessThan(refB);
  });
});
