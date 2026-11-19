import type { GrayFrame } from "./types";

/**
 * Picture clean-up that runs before the board reader samples the squares.
 * Everything is plain luminance maths on one frame (or a few frames of the same still board).
 */
export interface EnhanceConfig {
  denoise: "none" | "box" | "median" | "gauss"; // 3x3 box mean, 3x3 median (keeps edges), or a soft gaussian
  sharpen: number; // unsharp-mask strength (0 = off, ~0.5-1.5 typical)
  sharpenRadius: number; // blur radius (px) of the unsharp mask: bigger lifts bigger features
  flat: number; // flat-field radius in px (0 = off): divides out slow lighting gradients and glare halos
  average: number; // frames averaged together (1 = off): fewer, cleaner reads instead of many noisy ones
}

export const noEnhance = (): EnhanceConfig => ({ denoise: "none", sharpen: 0, sharpenRadius: 2, flat: 0, average: 1 });

/** Separable box blur with clamped edges. */
export function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r < 1) return src;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h), n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[row + Math.min(w - 1, Math.max(0, k))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / n;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / n;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

/** Three box passes approximate a gaussian of this radius. */
export function gaussBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r < 1) return src;
  const rr = Math.max(1, Math.round(r / 1.7));
  return boxBlur(boxBlur(boxBlur(src, w, h, rr), w, h, rr), w, h, rr);
}

function median3(src: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h), v = new Array<number>(9);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) v[k++] = src[Math.min(h - 1, Math.max(0, y + dy)) * w + Math.min(w - 1, Math.max(0, x + dx))];
      v.sort((a, b) => a - b);
      out[y * w + x] = v[4];
    }
  return out;
}

/** Average several frames of the same still board; the noise drops by sqrt(n). */
export function averageFrames(frames: GrayFrame[]): GrayFrame {
  const f = frames[0], n = f.data.length, acc = new Float32Array(n);
  for (const fr of frames) for (let i = 0; i < n; i++) acc[i] += fr.data[i];
  const data = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) data[i] = acc[i] / frames.length;
  return { width: f.width, height: f.height, data, t: frames[frames.length - 1].t };
}

/** Average-pool a frame down by an integer factor (a higher-resolution grab becomes a cleaner standard one). */
export function downscale(f: GrayFrame, k: number): GrayFrame {
  if (k <= 1) return f;
  const w = Math.floor(f.width / k), h = Math.floor(f.height / k), data = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) s += f.data[(y * k + dy) * f.width + x * k + dx];
      data[y * w + x] = s / (k * k);
    }
  return { width: w, height: h, data, t: f.t };
}

export function enhance(f: GrayFrame, c: EnhanceConfig): GrayFrame {
  if (c.denoise === "none" && !c.sharpen && !c.flat) return f;
  const { width: w, height: h } = f;
  let cur: Float32Array = Float32Array.from(f.data);
  if (c.denoise === "box") cur = boxBlur(cur, w, h, 1);
  else if (c.denoise === "gauss") cur = gaussBlur(cur, w, h, 2);
  else if (c.denoise === "median") cur = median3(cur, w, h);
  if (c.sharpen > 0) {
    const blur = gaussBlur(cur, w, h, c.sharpenRadius), out = new Float32Array(cur.length);
    for (let i = 0; i < cur.length; i++) out[i] = cur[i] + c.sharpen * (cur[i] - blur[i]);
    cur = out;
  }
  if (c.flat > 0) {
    const bg = gaussBlur(cur, w, h, c.flat);
    let mean = 0;
    for (let i = 0; i < cur.length; i++) mean += cur[i];
    mean /= cur.length;
    const out = new Float32Array(cur.length);
    for (let i = 0; i < cur.length; i++) out[i] = (cur[i] / Math.max(20, bg[i])) * mean;
    cur = out;
  }
  const data = new Uint8ClampedArray(cur.length);
  for (let i = 0; i < cur.length; i++) data[i] = cur[i];
  return { width: w, height: h, data, t: f.t };
}
