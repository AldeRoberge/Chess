export interface GrayFrame {
  width: number;
  height: number;
  data: Uint8ClampedArray; // 1 byte / pixel luminance (IR or visible)
  t: number;
}
export type Pt = { x: number; y: number };

/** Square index: 0 = a8, 7 = h8, 56 = a1, 63 = h1 (same order as chess.js board()). */
export const sqName = (i: number) => "abcdefgh"[i % 8] + (8 - Math.floor(i / 8));
export const sqIndex = (name: string) => (8 - Number(name[1])) * 8 + "abcdefgh".indexOf(name[0]);

/** One camera's reading of the board. */
export interface SquareObs {
  cam: string;
  t: number;
  quality: number; // 0..1 image-level trust
  weight: number; // user trust multiplier
  occ: Float32Array; // P(occupied)
  white: Float32Array; // P(white | occupied)
  motion: number; // 0..1 fraction of squares changing frame-to-frame (hand / occlusion)
  handSquares: Uint8Array; // 1 where this camera sees an anomaly
}

/** Fused (or stabilised) belief about the 64 squares. */
export interface BoardBelief {
  t: number;
  occ: Float32Array;
  white: Float32Array;
  conf: Float32Array; // 0..1 per square
  fidelity: number; // mean conf
  handOver: boolean;
  settled: boolean; // nothing changed for a while & no hand
  cams: number;
}

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
export const logit = (p: number) => {
  const q = clamp(p, 0.001, 0.999);
  return Math.log(q / (1 - q));
};
