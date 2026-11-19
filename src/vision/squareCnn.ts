import { CROP } from "./squareCrops";

/** Layer as exported by ml/train.py: weights are base64 little-endian float32. */
export interface CnnLayerJson { type: "conv" | "dense"; in: number; out: number; w: string; b: string; last?: boolean }
export interface CnnJson { crop: number; layers: CnnLayerJson[] }

interface Layer { type: "conv" | "dense"; cin: number; cout: number; w: Float32Array; b: Float32Array }

function floats(b64: string): Float32Array {
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

/**
 * The trained square classifier: three 3x3 conv + ReLU + 2x2 max-pool stages and two dense layers
 * (about 60k weights). Written out by hand so it runs in a worker or the main thread without a
 * runtime library; one board (64 squares) takes a few milliseconds.
 * Classes: 0 empty, 1 white piece, 2 black piece.
 */
export class SquareCnn {
  private layers: Layer[];
  private bufA = new Float32Array(16 * CROP * CROP);
  private bufB = new Float32Array(16 * CROP * CROP);

  constructor(json: CnnJson) {
    if (json.crop !== CROP) throw new Error(`model was trained for ${json.crop}px crops, not ${CROP}`);
    this.layers = json.layers.map((l) => ({ type: l.type, cin: l.in, cout: l.out, w: floats(l.w), b: floats(l.b) }));
  }

  /** Logits for one crop (CROP*CROP values, row-major). */
  logits(crop: Float32Array, offset = 0, out = new Float32Array(3)): Float32Array {
    let side = CROP, src = this.bufA, dst = this.bufB;
    for (let i = 0; i < CROP * CROP; i++) src[i] = crop[offset + i];
    for (const L of this.layers) {
      if (L.type === "conv") {
        convRelu(src, dst, L, side);
        pool(dst, src, L.cout, side);
        side >>= 1;
      } else {
        const n = L.cout, last = L === this.layers[this.layers.length - 1];
        const res = last ? out : dst;
        for (let o = 0; o < n; o++) {
          let s = L.b[o];
          const row = o * L.cin;
          for (let i = 0; i < L.cin; i++) s += L.w[row + i] * src[i];
          res[o] = last ? s : Math.max(0, s);
        }
        if (!last) { const t = src; src = dst; dst = t; }
      }
    }
    return out;
  }

  /** P(empty), P(white), P(black) for every square of a board, in the order extractCrops gives them. */
  classify(crops: Float32Array, out = new Float32Array(64 * 3)): Float32Array {
    const lg = new Float32Array(3);
    for (let sq = 0; sq < 64; sq++) {
      this.logits(crops, sq * CROP * CROP, lg);
      const m = Math.max(lg[0], lg[1], lg[2]);
      const e0 = Math.exp(lg[0] - m), e1 = Math.exp(lg[1] - m), e2 = Math.exp(lg[2] - m), z = e0 + e1 + e2;
      out[sq * 3] = e0 / z; out[sq * 3 + 1] = e1 / z; out[sq * 3 + 2] = e2 / z;
    }
    return out;
  }
}

function convRelu(src: Float32Array, dst: Float32Array, L: Layer, side: number) {
  const { cin, cout, w, b } = L, plane = side * side;
  for (let o = 0; o < cout; o++) {
    const base = o * plane;
    dst.fill(b[o], base, base + plane);
    for (let c = 0; c < cin; c++) {
      const sp = c * plane, wp = (o * cin + c) * 9;
      for (let ky = 0; ky < 3; ky++)
        for (let kx = 0; kx < 3; kx++) {
          const wt = w[wp + ky * 3 + kx];
          if (wt === 0) continue;
          const dy = ky - 1, dx = kx - 1;
          const y0 = Math.max(0, -dy), y1 = Math.min(side, side - dy), x0 = Math.max(0, -dx), x1 = Math.min(side, side - dx);
          for (let y = y0; y < y1; y++) {
            const di = base + y * side, si = sp + (y + dy) * side + dx;
            for (let x = x0; x < x1; x++) dst[di + x] += wt * src[si + x];
          }
        }
    }
    for (let i = base; i < base + plane; i++) if (dst[i] < 0) dst[i] = 0;
  }
}

function pool(src: Float32Array, dst: Float32Array, ch: number, side: number) {
  const h = side >> 1;
  for (let c = 0; c < ch; c++)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < h; x++) {
        const i = c * side * side + 2 * y * side + 2 * x;
        dst[c * h * h + y * h + x] = Math.max(src[i], src[i + 1], src[i + side], src[i + side + 1]);
      }
}
