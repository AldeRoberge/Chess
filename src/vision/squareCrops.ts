import { applyH, boardToImage } from "./homography";
import type { GrayFrame, Pt } from "./types";

/** Side of one square crop in pixels. */
export const CROP = 32;
/** Width of the crop window in squares, centred on the square. Wide enough to take in a tall piece's lean and the neighbours. */
export const CROP_SPAN = 2;
/** Mean brightness that every frame is scaled to before cropping, so exposure does not matter. */
export const TARGET_MEAN = 118;
const SAT = 250;

export function pixel(frame: GrayFrame, x: number, y: number): number {
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
 * Where every output value of one sampling grid reads from a camera frame, worked out once: the homography,
 * and for each output the top-left source pixel and the bilinear fractions (idx -1 when it is off the image).
 * Only the pixel values change from frame to frame, so a warp needs no maths per pixel after the first frame.
 */
export interface WarpPlan {
  w: number; h: number;
  /** The corners and frame size this plan was built for. */
  sig: Float64Array;
  H: number[];
  idx: Int32Array;
  tx: Float64Array;
  ty: Float64Array;
}

/**
 * Keeps the last few plans for one output grid (a few cameras may alternate), keyed by corners and frame size.
 * `place(k)` gives the board-plane point (u, v) that output k samples.
 */
export class WarpCache {
  private plans: WarpPlan[] = [];
  private next = 0;

  constructor(private n: number, private place: (k: number) => [number, number], private slots = 4) {}

  get(frame: GrayFrame, corners: Pt[]): WarpPlan {
    for (const p of this.plans) if (matches(p, frame, corners)) return p;
    const p = this.build(frame, corners);
    if (this.plans.length < this.slots) this.plans.push(p); else { this.plans[this.next] = p; this.next = (this.next + 1) % this.slots; }
    return p;
  }

  private build(frame: GrayFrame, corners: Pt[]): WarpPlan {
    const H = boardToImage(corners), w = frame.width, h = frame.height;
    const idx = new Int32Array(this.n), tx = new Float64Array(this.n), ty = new Float64Array(this.n);
    for (let k = 0; k < this.n; k++) {
      const [u, v] = this.place(k), p = applyH(H, u, v), x = p.x, y = p.y;
      // same test as pixel(): a point off the image (or NaN) reads as NaN
      if (!(x >= 0 && y >= 0 && x < w - 1 && y < h - 1)) { idx[k] = -1; continue; }
      const x0 = Math.floor(x), y0 = Math.floor(y);
      idx[k] = y0 * w + x0; tx[k] = x - x0; ty[k] = y - y0;
    }
    const sig = new Float64Array(8);
    for (let i = 0; i < 4; i++) { sig[2 * i] = corners[i].x; sig[2 * i + 1] = corners[i].y; }
    return { w, h, sig, H, idx, tx, ty };
  }
}

function matches(p: WarpPlan, frame: GrayFrame, corners: Pt[]): boolean {
  if (p.w !== frame.width || p.h !== frame.height) return false;
  for (let i = 0; i < 4; i++) if (p.sig[2 * i] !== corners[i].x || p.sig[2 * i + 1] !== corners[i].y) return false;
  return true;
}

/** Bilinear value of output k from the frame's pixels, the same arithmetic as pixel(); NaN off the image. */
export function warpAt(p: WarpPlan, d: Uint8ClampedArray, k: number): number {
  const b = p.idx[k];
  if (b < 0) return NaN;
  const tx = p.tx[k], ty = p.ty[k], w = p.w;
  return d[b] * (1 - tx) * (1 - ty) + d[b + 1] * tx * (1 - ty) + d[b + w] * (1 - tx) * ty + d[b + w + 1] * tx * ty;
}

const cropWarp = new WarpCache(64 * CROP * CROP, (k) => {
  const sq = Math.floor(k / (CROP * CROP)), r = k % (CROP * CROP), j = Math.floor(r / CROP), i = r % CROP;
  return [(sq % 8) + 0.5 + ((i + 0.5) / CROP - 0.5) * CROP_SPAN, Math.floor(sq / 8) + 0.5 + ((j + 0.5) / CROP - 0.5) * CROP_SPAN];
});

/**
 * One CROP x CROP window per square, cut out of the board plane through the homography so every
 * crop is upright with respect to the board, whatever the camera angle. Values are exposure-normalised
 * and scaled so a typical pixel is about 0.5. Squares are in `sqName` order (0 = a8). Off-image pixels are 0.
 */
export function extractCrops(frame: GrayFrame, corners: Pt[], out = new Float32Array(64 * CROP * CROP)): Float32Array {
  const plan = cropWarp.get(frame, corners), gain = boardGain(frame, plan.H) / (2 * TARGET_MEAN);
  for (let k = 0; k < 64 * CROP * CROP; k++) {
    const v = warpAt(plan, frame.data, k);
    out[k] = Number.isFinite(v) ? Math.min(2, v * gain) : 0;
  }
  return out;
}
