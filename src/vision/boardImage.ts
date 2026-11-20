import { applyH, boardToImage } from "./homography";
import { boardGain, pixel, TARGET_MEAN } from "./squareCrops";
import type { GrayFrame, Pt } from "./types";

/** Pixels per square in the flattened board image. */
export const BOARD_PX = 16;
/** Squares of margin kept around the board on every side, so tall pieces on the edge and their lean stay in view. */
export const BOARD_MARGIN = 1;
/** Side of the flattened board image in pixels: (8 + 2 margins) squares. */
export const BOARD_SIDE = (8 + 2 * BOARD_MARGIN) * BOARD_PX;

/**
 * The whole board as one upright greyscale image: the board plane cut out through the homography, with a
 * square of margin all round, exposure-normalised like the square crops (a typical pixel is about 0.5).
 * Row-major, BOARD_SIDE x BOARD_SIDE. Off-image pixels are 0.
 */
export function extractBoard(frame: GrayFrame, corners: Pt[], out = new Float32Array(BOARD_SIDE * BOARD_SIDE)): Float32Array {
  const H = boardToImage(corners), gain = boardGain(frame, H) / (2 * TARGET_MEAN);
  for (let j = 0; j < BOARD_SIDE; j++)
    for (let i = 0; i < BOARD_SIDE; i++) {
      const p = applyH(H, (i + 0.5) / BOARD_PX - BOARD_MARGIN, (j + 0.5) / BOARD_PX - BOARD_MARGIN), v = pixel(frame, p.x, p.y);
      out[j * BOARD_SIDE + i] = Number.isFinite(v) ? Math.min(2, v * gain) : 0;
    }
  return out;
}
