import { boardGain, pixel, TARGET_MEAN } from "./squareCrops";
import { boardToImage } from "./homography";
import type { GrayFrame, Pt } from "./types";

/** What the Mask Board node hands on: the masked view and where it came from. */
export interface BoardView { cam: string; t: number; img: Float32Array }

/** Side of the masked board view in pixels. */
export const VIEW_SIDE = 160;
/** Squares of padding kept around the board outline before everything else is blacked out. */
export const VIEW_PAD = 0.75;

/**
 * The board as the camera sees it, not straightened: the picture is turned in its own plane so the board's a8 -> h8 edge
 * runs left to right (so a camera on either side gives the same upright layout), cropped to the board's bounding box
 * plus padding, and everything outside the padded outline is set to black. The perspective stays, so a network reading it
 * has to learn the board from every angle. Exposure is normalised like the other readers (a typical pixel is about 0.5).
 * `corners` are a8, h8, h1, a1 in picture pixels. Row-major VIEW_SIDE x VIEW_SIDE; the picture is fitted without stretching.
 */
export function extractView(frame: GrayFrame, corners: Pt[], out = new Float32Array(VIEW_SIDE * VIEW_SIDE)): Float32Array {
  out.fill(0);
  const cx = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4, cy = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4;
  const ang = Math.atan2(corners[1].y - corners[0].y, corners[1].x - corners[0].x), ca = Math.cos(-ang), sa = Math.sin(-ang);
  // the outline grown about its centre by the padding (a square is about an eighth of the board)
  const edge = (Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y) + Math.hypot(corners[2].x - corners[1].x, corners[2].y - corners[1].y) + Math.hypot(corners[3].x - corners[2].x, corners[3].y - corners[2].y) + Math.hypot(corners[0].x - corners[3].x, corners[0].y - corners[3].y)) / 4;
  const grow = 1 + (2 * VIEW_PAD) / 8 * (edge > 0 ? 1 : 0);
  const poly = corners.map((p) => ({ x: cx + (p.x - cx) * grow, y: cy + (p.y - cy) * grow }));
  const rot = (p: Pt) => ({ x: (p.x - cx) * ca - (p.y - cy) * sa, y: (p.x - cx) * sa + (p.y - cy) * ca });
  const rp = poly.map(rot);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of rp) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  const span = Math.max(x1 - x0, y1 - y0, 1e-6), scale = VIEW_SIDE / span, ox = (VIEW_SIDE - (x1 - x0) * scale) / 2, oy = (VIEW_SIDE - (y1 - y0) * scale) / 2;
  const gain = boardGain(frame, boardToImage(corners)) / (2 * TARGET_MEAN);
  // point-in-convex-polygon in the rotated frame: all cross products share a sign
  const inside = (x: number, y: number) => {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = rp[i], b = rp[(i + 1) % 4], c = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
      if (c !== 0) { const s = c > 0 ? 1 : -1; if (sign && s !== sign) return false; sign = s; }
    }
    return true;
  };
  for (let j = 0; j < VIEW_SIDE; j++)
    for (let i = 0; i < VIEW_SIDE; i++) {
      const rx = (i + 0.5 - ox) / scale + x0, ry = (j + 0.5 - oy) / scale + y0;
      if (!inside(rx, ry)) continue;
      const sx = cx + rx * ca + ry * sa, sy = cy - rx * sa + ry * ca, v = pixel(frame, sx, sy);
      out[j * VIEW_SIDE + i] = Number.isFinite(v) ? Math.min(2, v * gain) : 0;
    }
  return out;
}

