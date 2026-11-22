import { boardGain, TARGET_MEAN, warpAt, WarpCache } from "./squareCrops";
import type { GrayFrame, Pt } from "./types";

/** Pixels per square in the flattened board image. */
export const BOARD_PX = 16;
/** Squares of margin kept around the board on every side, so tall pieces on the edge and their lean stay in view. */
export const BOARD_MARGIN = 1;
/** Side of the flattened board image in pixels: (8 + 2 margins) squares. */
export const BOARD_SIDE = (8 + 2 * BOARD_MARGIN) * BOARD_PX;

const boardWarp = new WarpCache(BOARD_SIDE * BOARD_SIDE, (k) => {
  const i = k % BOARD_SIDE, j = Math.floor(k / BOARD_SIDE);
  return [(i + 0.5) / BOARD_PX - BOARD_MARGIN, (j + 0.5) / BOARD_PX - BOARD_MARGIN];
});

/**
 * The whole board as one upright greyscale image: the board plane cut out through the homography, with a
 * square of margin all round, exposure-normalised like the square crops (a typical pixel is about 0.5).
 * Row-major, BOARD_SIDE x BOARD_SIDE. Off-image pixels are 0.
 */
export function extractBoard(frame: GrayFrame, corners: Pt[], out = new Float32Array(BOARD_SIDE * BOARD_SIDE)): Float32Array {
  const plan = boardWarp.get(frame, corners), gain = boardGain(frame, plan.H) / (2 * TARGET_MEAN);
  for (let k = 0; k < BOARD_SIDE * BOARD_SIDE; k++) {
    const v = warpAt(plan, frame.data, k);
    out[k] = Number.isFinite(v) ? Math.min(2, v * gain) : 0;
  }
  return out;
}
