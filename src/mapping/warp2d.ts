import { applyH } from "../vision/homography";

/**
 * Draws `src` through homography H (src px -> dst px) using an n x n mesh of affine-mapped
 * triangles. Canvas2D has no perspective transform; with n >= 12 the error is sub-pixel.
 */
export function drawWarped(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, H: number[], n = 12) {
  const P = (i: number, j: number) => applyH(H, (i / n) * sw, (j / n) * sh);
  const tri = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, u0: number, v0: number, u1: number, v1: number, u2: number, v2: number) => {
    ctx.save();
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.closePath(); ctx.clip();
    const d = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
    if (Math.abs(d) < 1e-9) { ctx.restore(); return; }
    const a = ((x1 - x0) * (v2 - v0) - (x2 - x0) * (v1 - v0)) / d, c = ((x2 - x0) * (u1 - u0) - (x1 - x0) * (u2 - u0)) / d;
    const b = ((y1 - y0) * (v2 - v0) - (y2 - y0) * (v1 - v0)) / d, e = ((y2 - y0) * (u1 - u0) - (y1 - y0) * (u2 - u0)) / d;
    ctx.transform(a, b, c, e, x0 - a * u0 - c * v0, y0 - b * u0 - e * v0);
    ctx.drawImage(src, 0, 0);
    ctx.restore();
  };
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const p00 = P(i, j), p10 = P(i + 1, j), p01 = P(i, j + 1), p11 = P(i + 1, j + 1);
      const u0 = (i / n) * sw, u1 = ((i + 1) / n) * sw, v0 = (j / n) * sh, v1 = ((j + 1) / n) * sh;
      tri(p00.x, p00.y, p10.x, p10.y, p01.x, p01.y, u0, v0, u1, v0, u0, v1);
      tri(p10.x, p10.y, p11.x, p11.y, p01.x, p01.y, u1, v0, u1, v1, u0, v1);
    }
}
