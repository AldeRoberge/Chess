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

/** Scratch for the blur's row pass. Module-private and only grown: no caller ever holds it. */
let blurTmp: Float32Array = new Float32Array(0);
/** Scratch for the frame sum in averageFrames. Module-private; the returned frame always gets its own data. */
let sumBuf: Float32Array = new Float32Array(0);

/** Separable box blur with clamped edges. */
export function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r < 1) return src;
  const out = new Float32Array(w * h);
  if (blurTmp.length < w * h) blurTmp = new Float32Array(w * h);
  boxBlurInto(src, w, h, r, out, blurTmp);
  return out;
}

/** The box blur written into `out`, using `tmp` for the row pass. `out` may be `src`: the row pass reads all of `src` first. */
function boxBlurInto(src: Float32Array, w: number, h: number, r: number, out: Float32Array, tmp: Float32Array): void {
  const n = 2 * r + 1;
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
}

/** Three box passes approximate a gaussian of this radius. The passes after the first run in place: only the result is kept. */
export function gaussBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r < 1) return src;
  const rr = Math.max(1, Math.round(r / 1.7)), out = new Float32Array(w * h);
  if (blurTmp.length < w * h) blurTmp = new Float32Array(w * h);
  boxBlurInto(src, w, h, rr, out, blurTmp);
  boxBlurInto(out, w, h, rr, out, blurTmp);
  boxBlurInto(out, w, h, rr, out, blurTmp);
  return out;
}

/** 3x3 median via the classic 19-exchange network (a plain sort of 9 per pixel is several times slower). */
export function median3(src: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  medianInto(src, w, h, out);
  return out;
}

/**
 * Fast exact 3x3 median, written straight into `out`. Each column of three is sorted once per row and
 * shared by the three windows that contain it; the median of the nine is then the median of
 * (largest low, middle middle, smallest high) of the three columns. About a third of the comparisons
 * of the exchange network, and it works on 8-bit frames directly, so the median-only clean-up never
 * round-trips through floats.
 */
function medianInto(src: ArrayLike<number>, w: number, h: number, out: { [i: number]: number }) {
  const lo = new Float32Array(w), mid = new Float32Array(w), hi = new Float32Array(w);
  for (let y = 0; y < h; y++) {
    const ym = Math.max(0, y - 1) * w, y0 = y * w, yp = Math.min(h - 1, y + 1) * w;
    for (let x = 0; x < w; x++) {
      let a = src[ym + x], b = src[y0 + x], c = src[yp + x], t = 0;
      if (a > b) { t = a; a = b; b = t; }
      if (b > c) { t = b; b = c; c = t; }
      if (a > b) { t = a; a = b; b = t; }
      lo[x] = a; mid[x] = b; hi[x] = c;
    }
    for (let x = 0; x < w; x++) {
      const xm = x > 0 ? x - 1 : 0, xp = x < w - 1 ? x + 1 : w - 1;
      // largest of the lows, smallest of the highs, middle of the middles
      let l = lo[xm]; if (lo[x] > l) l = lo[x]; if (lo[xp] > l) l = lo[xp];
      let u = hi[xm]; if (hi[x] < u) u = hi[x]; if (hi[xp] < u) u = hi[xp];
      let a = mid[xm], b = mid[x], c = mid[xp], t = 0;
      if (a > b) { t = a; a = b; b = t; }
      if (b > c) { b = c; }
      if (a > b) { b = a; }
      // median of (l, b, u)
      if (l > b) { t = l; l = b; b = t; }
      if (b > u) { b = u; }
      if (l > b) { b = l; }
      out[y0 + x] = b;
    }
  }
}

/** Average several frames of the same still board; the noise drops by sqrt(n). */
export function averageFrames(frames: GrayFrame[]): GrayFrame {
  const f = frames[0], n = f.data.length;
  if (sumBuf.length < n) sumBuf = new Float32Array(n);
  const acc = sumBuf.subarray(0, n).fill(0);
  for (const fr of frames) for (let i = 0; i < n; i++) acc[i] += fr.data[i];
  const data = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) data[i] = acc[i] / frames.length;
  return { width: f.width, height: f.height, data, t: frames[frames.length - 1].t };
}

/**
 * Area-average a frame to exactly `tw`×`th`. The same size returns the same object.
 * Each output pixel is the mean of the input pixels that cover it, so a 1280×960 grab
 * becomes the 480×360 the board reader samples without a second blur from scaling up first.
 */
export function resample(f: GrayFrame, tw: number, th: number): GrayFrame {
  if (tw === f.width && th === f.height) return f;
  if (tw < 1 || th < 1) return f;
  const data = new Uint8ClampedArray(tw * th);
  const xScale = f.width / tw, yScale = f.height / th;
  for (let y = 0; y < th; y++) {
    const y0 = y * yScale, ya = Math.floor(y0), yb = Math.min(f.height, Math.ceil(y0 + yScale));
    for (let x = 0; x < tw; x++) {
      const x0 = x * xScale, xa = Math.floor(x0), xb = Math.min(f.width, Math.ceil(x0 + xScale));
      let s = 0, n = 0;
      for (let yy = ya; yy < yb; yy++) {
        const row = yy * f.width;
        for (let xx = xa; xx < xb; xx++) { s += f.data[row + xx]; n++; }
      }
      data[y * tw + x] = n ? s / n : 0;
    }
  }
  return { width: tw, height: th, data, t: f.t };
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
  if (c.denoise === "median" && !c.sharpen && !c.flat) { // the reader's default clean-up: stay in 8 bits end to end
    const data = new Uint8ClampedArray(w * h);
    medianInto(f.data, w, h, data);
    return { width: w, height: h, data, t: f.t };
  }
  let cur: Float32Array = Float32Array.from(f.data);
  if (c.denoise === "box") cur = boxBlur(cur, w, h, 1);
  else if (c.denoise === "gauss") cur = gaussBlur(cur, w, h, 2);
  else if (c.denoise === "median") cur = median3(cur, w, h);
  // `cur` is this function's own buffer, and each pixel only reads its own value, so the two passes below update it in place.
  if (c.sharpen > 0) {
    const blur = gaussBlur(cur, w, h, c.sharpenRadius);
    for (let i = 0; i < cur.length; i++) cur[i] = cur[i] + c.sharpen * (cur[i] - blur[i]);
  }
  if (c.flat > 0) {
    const bg = gaussBlur(cur, w, h, c.flat);
    let mean = 0;
    for (let i = 0; i < cur.length; i++) mean += cur[i];
    mean /= cur.length;
    for (let i = 0; i < cur.length; i++) cur[i] = (cur[i] / Math.max(20, bg[i])) * mean;
  }
  const data = new Uint8ClampedArray(cur.length);
  for (let i = 0; i < cur.length; i++) data[i] = cur[i];
  return { width: w, height: h, data, t: f.t };
}
