import type { Pt } from "../vision/types";
import { boardToImage } from "../vision/homography";

/** Channels the board reader can read from: grey (luma) or one colour plane (IR cameras often show up in red). */
export type Channel = "luma" | "red" | "green" | "blue";
export const CHANNEL_NAME: Record<Channel, string> = { luma: "Gray (luma)", red: "Red", green: "Green", blue: "Blue" };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Vertical field of view (degrees) from the four board corners (a8, h8, h1, a1) in a w x h picture.
 * The board is a square, so with K = diag(f, f, 1) on pixels centred on the image, the board-to-image homography H
 * gives two plane axes g1 = (h11, h21, h31) / f and g2 = (h12, h22, h32) / f that must be perpendicular and of equal
 * length. Either constraint fixes f: orthogonality gives f^2 = -(h11 h12 + h21 h22) / (h31 h32), equal length gives
 * f^2 = (h11^2 + h21^2 - h12^2 - h22^2) / (h32^2 - h31^2). Each degenerates when the board's edges run parallel in the
 * picture, so the better-conditioned one is used. Null when the corners fit no lens; clamped to the slider's 30..110.
 */
export function estimateFov(corners: Pt[], w: number, h: number): number | null {
  let H: number[];
  try { H = boardToImage(corners.map((p) => ({ x: p.x - w / 2, y: p.y - h / 2 }))); } catch { return null; }
  const [h11, h12, , h21, h22, , h31, h32] = H;
  const orth = { f2: -(h11 * h12 + h21 * h22) / (h31 * h32), den: Math.abs(h31 * h32) };
  const equal = { f2: (h11 * h11 + h21 * h21 - h12 * h12 - h22 * h22) / (h32 * h32 - h31 * h31), den: Math.abs(h32 * h32 - h31 * h31) };
  const best = orth.den >= equal.den ? orth : equal;
  if (!(best.den > 1e-12) || !(best.f2 > 0) || !Number.isFinite(best.f2)) return null;
  const fov = (2 * Math.atan(h / 2 / Math.sqrt(best.f2)) * 180) / Math.PI;
  return clamp(Math.round(fov), 30, 110);
}

/** Mean colour of one board square, sampled at a 3x3 grid inside it. */
export interface SquareMean { dark: boolean; r: number; g: number; b: number }

/** A point on the board by bilinear interpolation: u runs a->h, v runs rank 8 -> rank 1 (0..1 each). */
function boardPoint(c: Pt[], u: number, v: number): Pt {
  const [a8, h8, h1, a1] = c;
  const w00 = (1 - u) * (1 - v), w10 = u * (1 - v), w11 = u * v, w01 = (1 - u) * v;
  return { x: w00 * a8.x + w10 * h8.x + w11 * h1.x + w01 * a1.x, y: w00 * a8.y + w10 * h8.y + w11 * h1.y + w01 * a1.y };
}

/** The 64 squares of the board as they appear in the picture (RGBA image data, corners in its pixels). */
export function squareMeans(img: ImageData, corners: Pt[]): SquareMean[] {
  const { width: W, height: H, data } = img, out: SquareMean[] = [];
  for (let rank = 8; rank >= 1; rank--) {
    for (let file = 0; file < 8; file++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (const du of [-0.25, 0, 0.25]) for (const dv of [-0.25, 0, 0.25]) {
        const p = boardPoint(corners, (file + 0.5 + du) / 8, (8 - rank + 0.5 + dv) / 8);
        const x = clamp(Math.round(p.x), 0, W - 1), y = clamp(Math.round(p.y), 0, H - 1), i = (y * W + x) * 4;
        r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
      }
      // a1 is a dark square: dark when file (a = 0) + rank (1-based) is odd
      out.push({ dark: (file + rank) % 2 === 1, r: r / n, g: g / n, b: b / n });
    }
  }
  return out;
}

const valueOf = (s: SquareMean, ch: Channel) => (ch === "red" ? s.r : ch === "green" ? s.g : ch === "blue" ? s.b : 0.299 * s.r + 0.587 * s.g + 0.114 * s.b);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/**
 * How clearly the squares show in one channel, as d' (about 0.5 is barely visible, 1.5 or more reads cleanly).
 * Each square is compared with its (up to four) neighbours, which are the other colour on a board: a clean board gives
 * the same contrast everywhere, so lighting gradients cancel, and pieces (which cover a minority of squares) only
 * disturb their own squares. The median contrast is divided by the robust spread (MAD) of the contrasts.
 */
export function separation(squares: SquareMean[], ch: Channel): number {
  const v = squares.map((s) => valueOf(s, ch)), contrast: number[] = [];
  squares.forEach((s, i) => {
    const row = Math.floor(i / 8), col = i % 8, around: number[] = [];
    if (col > 0) around.push(v[i - 1]);
    if (col < 7) around.push(v[i + 1]);
    if (row > 0) around.push(v[i - 8]);
    if (row < 7) around.push(v[i + 8]);
    const mean = around.reduce((a, b) => a + b, 0) / around.length;
    contrast.push((s.dark ? -1 : 1) * (v[i] - mean)); // signed so that a clean board reads positive
  });
  const m = median(contrast), mad = median(contrast.map((c) => Math.abs(c - m)));
  return Math.abs(m) / Math.sqrt((1.4826 * mad) ** 2 + 4);
}

/** d' of the board in one channel, read from a picture. */
export const boardSeparation = (img: ImageData, corners: Pt[], ch: Channel) => separation(squareMeans(img, corners), ch);

/**
 * The channel in which the board stands out most. Grey is kept unless a colour plane beats it by 15%, so a plain
 * camera stays on luma and an IR camera (red-dominant, grey elsewhere) moves to the channel that shows the squares.
 */
export function detectChannel(img: ImageData, corners: Pt[]): { channel: Channel; separation: number } {
  const sq = squareMeans(img, corners);
  let channel: Channel = "luma", best = separation(sq, "luma");
  for (const ch of ["red", "green", "blue"] as const) {
    const d = separation(sq, ch);
    if (d > best * 1.15) { channel = ch; best = d; }
  }
  return { channel, separation: best };
}

/** Trust (0..2) from the separation: d' of 1.5 reads as the default trust of 1, a very clear board caps at 2. */
export const trustFor = (d: number) => clamp(Math.round((d / 1.5) * 10) / 10, 0, 2);
