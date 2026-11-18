import { applyH, solveHomography } from "../vision/homography";
import type { GrayFrame, Pt } from "../vision/types";

/** Grid of calibration dots in projector pixel space, inset from the edges. */
export function dotGrid(w: number, h: number, cols = 5, rows = 4, inset = 0.1): Pt[] {
  const out: Pt[] = [];
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++)
      out.push({ x: w * (inset + (1 - 2 * inset) * (i / (cols - 1))), y: h * (inset + (1 - 2 * inset) * (j / (rows - 1))) });
  return out;
}

/** Brightness-weighted centroid of (frame - dark) above a threshold; null when no dot is visible. */
export function detectDot(dark: GrayFrame, lit: GrayFrame, minDelta = 40): { pt: Pt; strength: number } | null {
  let sx = 0, sy = 0, sw = 0, n = 0;
  for (let y = 0; y < lit.height; y++)
    for (let x = 0; x < lit.width; x++) {
      const d = lit.data[y * lit.width + x] - dark.data[y * dark.width + x];
      if (d > minDelta) { sx += x * d; sy += y * d; sw += d; n++; }
    }
  if (n < 4) return null;
  return { pt: { x: sx / sw, y: sy / sw }, strength: sw / n };
}

/** Least-squares homography from N>=4 pairs (normal equations on the DLT system, h33 = 1). */
export function fitHomography(src: Pt[], dst: Pt[]): number[] {
  if (src.length < 4) throw new Error("need >= 4 correspondences");
  if (src.length === 4) return solveHomography(src, dst);
  const AtA = Array.from({ length: 8 }, () => new Array(9).fill(0));
  const acc = (row: number[], rhs: number) => {
    for (let i = 0; i < 8; i++) { for (let j = 0; j < 8; j++) AtA[i][j] += row[i] * row[j]; AtA[i][8] += row[i] * rhs; }
  };
  for (let k = 0; k < src.length; k++) {
    const { x, y } = src[k], { x: u, y: v } = dst[k];
    acc([x, y, 1, 0, 0, 0, -u * x, -u * y], u);
    acc([0, 0, 0, x, y, 1, -v * x, -v * y], v);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(AtA[r][c]) > Math.abs(AtA[p][c])) p = r;
    [AtA[c], AtA[p]] = [AtA[p], AtA[c]];
    const d = AtA[c][c];
    for (let k = c; k < 9; k++) AtA[c][k] /= d;
    for (let r = 0; r < 8; r++) if (r !== c) { const f = AtA[r][c]; for (let k = c; k < 9; k++) AtA[r][k] -= f * AtA[c][k]; }
  }
  return [...AtA.map((r) => r[8]), 1];
}

export interface CalibrationResult {
  camToProj: number[];
  projToCam: number[];
  rmsError: number; // in projector pixels
  used: number;
}

/** Fits camera->projector from dot hits, rejecting outliers (iteratively drops the worst point). */
export function calibrate(hits: { proj: Pt; cam: Pt }[], maxRms = 2): CalibrationResult {
  let pts = [...hits];
  for (;;) {
    const H = fitHomography(pts.map((p) => p.cam), pts.map((p) => p.proj));
    const errs = pts.map((p) => { const q = applyH(H, p.cam.x, p.cam.y); return Math.hypot(q.x - p.proj.x, q.y - p.proj.y); });
    const rms = Math.sqrt(errs.reduce((a, e) => a + e * e, 0) / errs.length);
    if (rms <= maxRms || pts.length <= 6) {
      return { camToProj: H, projToCam: fitHomography(pts.map((p) => p.proj), pts.map((p) => p.cam)), rmsError: rms, used: pts.length };
    }
    pts.splice(errs.indexOf(Math.max(...errs)), 1);
  }
}

/** Approximate quad (TL,TR,BR,BL) of the lit region: extreme points along both diagonals. */
export function quadFromLit(dark: GrayFrame, lit: GrayFrame, minDelta = 40): Pt[] | null {
  let a = { v: 1e9, p: { x: 0, y: 0 } }, b = { v: -1e9, p: { x: 0, y: 0 } }, c = { v: -1e9, p: { x: 0, y: 0 } }, d = { v: 1e9, p: { x: 0, y: 0 } };
  let any = false;
  for (let y = 0; y < lit.height; y++)
    for (let x = 0; x < lit.width; x++) {
      if (lit.data[y * lit.width + x] - dark.data[y * dark.width + x] <= minDelta) continue;
      any = true;
      const s = x + y, df = x - y;
      if (s < a.v) a = { v: s, p: { x, y } }; // TL
      if (s > b.v) b = { v: s, p: { x, y } }; // BR
      if (df > c.v) c = { v: df, p: { x, y } }; // TR
      if (df < d.v) d = { v: df, p: { x, y } }; // BL
    }
  return any ? [a.p, c.p, b.p, d.p] : null;
}
