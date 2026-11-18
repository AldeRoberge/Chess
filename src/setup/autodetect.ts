import type { Pt } from "../vision/types";

/** Channels the board reader can read from: grey (luma) or one colour plane (IR cameras often show up in red). */
export type Channel = "luma" | "red" | "green" | "blue";
export const CHANNEL_NAME: Record<Channel, string> = { luma: "Gray (luma)", red: "Red", green: "Green", blue: "Blue" };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Where two lines (each through two points) cross, in image pixels; null when they are parallel. */
function vanishing(a1: Pt, b1: Pt, a2: Pt, b2: Pt): Pt | null {
  // homogeneous lines through two image points: l = p x q, with p = (x, y, 1)
  const line = (p: Pt, q: Pt) => [p.y - q.y, q.x - p.x, p.x * q.y - p.y * q.x];
  const l1 = line(a1, b1), l2 = line(a2, b2);
  const v = [l1[1] * l2[2] - l1[2] * l2[1], l1[2] * l2[0] - l1[0] * l2[2], l1[0] * l2[1] - l1[1] * l2[0]];
  if (Math.abs(v[2]) < 1e-9) return null;
  return { x: v[0] / v[2], y: v[1] / v[2] };
}

/**
 * Vertical field of view (degrees) from the four board corners (a8, h8, h1, a1) in a w x h picture.
 * The board's rows and files are two pairs of perpendicular lines, so their vanishing points v1, v2 satisfy
 * (v1 - c) . (v2 - c) = -f^2 with c the image centre and f the focal length in pixels (square pixels assumed).
 * Returns null when the corners do not show two converging pairs of edges; clamps to the slider's 30..110 range.
 */
export function estimateFov(corners: Pt[], w: number, h: number): number | null {
  const [a8, h8, h1, a1] = corners;
  const rows = vanishing(a8, h8, a1, h1), files = vanishing(a8, a1, h8, h1);
  if (!rows || !files) return null;
  const cx = w / 2, cy = h / 2;
  const f2 = -((rows.x - cx) * (files.x - cx) + (rows.y - cy) * (files.y - cy));
  if (!(f2 > 0)) return null;
  const fov = (2 * Math.atan(h / 2 / Math.sqrt(f2)) * 180) / Math.PI;
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
const stats = (xs: number[]) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return { m, v: xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length }; };

/**
 * How clearly the light and dark squares stand apart in one channel: the difference of their means over the
 * pooled spread (d'). About 1 is barely visible, 2 or more reads cleanly. A small noise floor keeps flat images finite.
 */
export function separation(squares: SquareMean[], ch: Channel): number {
  const light = stats(squares.filter((s) => !s.dark).map((s) => valueOf(s, ch)));
  const dark = stats(squares.filter((s) => s.dark).map((s) => valueOf(s, ch)));
  return Math.abs(light.m - dark.m) / Math.sqrt((light.v + dark.v) / 2 + 4);
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

/** Trust (0..2) from the separation: d' of 2 reads as the default trust of 1, a very clear board caps at 2. */
export const trustFor = (d: number) => clamp(Math.round((d / 2) * 10) / 10, 0, 2);
