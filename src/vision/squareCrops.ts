import { applyH, boardToImage } from "./homography";
import type { GrayFrame, Pt } from "./types";

/** Side of one square crop in pixels. */
export const CROP = 32;
/** Width of the crop window in squares, centred on the square. Wide enough to take in a tall piece's lean and the neighbours. */
export const CROP_SPAN = 2;
/** Mean brightness that every frame is scaled to before cropping, so exposure does not matter. */
const TARGET_MEAN = 118;
const SAT = 250;

function pixel(frame: GrayFrame, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= frame.width - 1 || y >= frame.height - 1) return NaN;
  const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0, w = frame.width, d = frame.data;
  return d[y0 * w + x0] * (1 - tx) * (1 - ty) + d[y0 * w + x0 + 1] * tx * (1 - ty) + d[(y0 + 1) * w + x0] * (1 - tx) * ty + d[(y0 + 1) * w + x0 + 1] * tx * ty;
}

/** Exposure gain: the board's mean brightness (sampled at square centres, glare ignored) mapped to TARGET_MEAN. */
export function boardGain(frame: GrayFrame, H: number[]): number {
  let sum = 0, n = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = applyH(H, (sq % 8) + 0.5, Math.floor(sq / 8) + 0.5), v = pixel(frame, p.x, p.y);
    if (Number.isFinite(v) && v < SAT) { sum += v; n++; }
  }
  return n >= 8 ? TARGET_MEAN / Math.max(8, sum / n) : 1;
}

/**
 * One CROP x CROP window per square, cut out of the board plane through the homography so every
 * crop is upright with respect to the board, whatever the camera angle. Values are exposure-normalised
 * and scaled so a typical pixel is about 0.5. Squares are in `sqName` order (0 = a8). Off-image pixels are 0.
 */
export function extractCrops(frame: GrayFrame, corners: Pt[], out = new Float32Array(64 * CROP * CROP)): Float32Array {
  const H = boardToImage(corners), gain = boardGain(frame, H) / (2 * TARGET_MEAN);
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
