import { CROP } from "./squareCrops";

/** Layer as exported by ml/train.py: weights are base64 little-endian float32. */
export interface CnnLayerJson { type: "conv" | "dense"; in: number; out: number; stride?: number; w: string; b: string; last?: boolean }
export interface CnnJson { crop: number; layers: CnnLayerJson[] }

interface Layer { type: "conv" | "dense"; cin: number; cout: number; stride: number; w: Float32Array; b: Float32Array }

function floats(b64: string): Float32Array {
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

/**
 * The trained square classifier: three stride-2 3x3 conv + ReLU stages and two dense layers
 * (about 40k weights, 200k multiply-adds per square). Written out by hand so it runs in a worker or
 * the main thread without a runtime library.
 * Classes: 0 empty, 1 white piece, 2 black piece.
 */
export class SquareCnn {
  private layers: Layer[];
  private bufA = new Float32Array(4096);
  private bufB = new Float32Array(4096);
  private padded = new Float32Array(4096);
  private lg = new Float32Array(3);

  constructor(json: CnnJson) {
    if (json.crop !== CROP) throw new Error(`model was trained for ${json.crop}px crops, not ${CROP}`);
    this.layers = json.layers.map((l) => ({ type: l.type, cin: l.in, cout: l.out, stride: l.stride ?? 1, w: floats(l.w), b: floats(l.b) }));
  }

  /** Logits for one crop (CROP*CROP values, row-major). */
  logits(crop: Float32Array, offset = 0, out = new Float32Array(3)): Float32Array {
    let side = CROP, src = this.bufA, dst = this.bufB;
    for (let i = 0; i < CROP * CROP; i++) src[i] = crop[offset + i];
    for (const L of this.layers) {
      if (L.type === "conv") {
        convRelu(src, dst, this.padded, L, side);
        side = Math.ceil(side / L.stride);
        const t = src; src = dst; dst = t;
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
    const lg = this.lg;
    for (let sq = 0; sq < 64; sq++) {
      this.logits(crops, sq * CROP * CROP, lg);
      const m = Math.max(lg[0], lg[1], lg[2]);
      const e0 = Math.exp(lg[0] - m), e1 = Math.exp(lg[1] - m), e2 = Math.exp(lg[2] - m), z = e0 + e1 + e2;
      out[sq * 3] = e0 / z; out[sq * 3 + 1] = e1 / z; out[sq * 3 + 2] = e2 / z;
    }
    return out;
  }
}

/** 3x3 convolution with one pixel of zero padding and ReLU. `src` holds `cin` planes of side x side; the result has ceil(side / stride) pixels a side. */
function convRelu(src: Float32Array, dst: Float32Array, pad: Float32Array, L: Layer, side: number) {
  const { cin, cout, w, b, stride } = L, ps = side + 2, out = Math.ceil(side / stride);
  for (let c = 0; c < cin; c++) {
    const po = c * ps * ps;
    pad.fill(0, po, po + ps * ps);
    for (let y = 0; y < side; y++) {
      const si = c * side * side + y * side, di = po + (y + 1) * ps + 1;
      for (let x = 0; x < side; x++) pad[di + x] = src[si + x];
    }
  }
  for (let o = 0; o < cout; o++) {
    const wo = o * cin * 9, bias = b[o];
    for (let oy = 0; oy < out; oy++)
      for (let ox = 0; ox < out; ox++) {
        let sum = bias, wi = wo;
        for (let c = 0; c < cin; c++) {
          const at = c * ps * ps + oy * stride * ps + ox * stride;
          sum += w[wi] * pad[at] + w[wi + 1] * pad[at + 1] + w[wi + 2] * pad[at + 2]
            + w[wi + 3] * pad[at + ps] + w[wi + 4] * pad[at + ps + 1] + w[wi + 5] * pad[at + ps + 2]
            + w[wi + 6] * pad[at + 2 * ps] + w[wi + 7] * pad[at + 2 * ps + 1] + w[wi + 8] * pad[at + 2 * ps + 2];
          wi += 9;
        }
        dst[o * out * out + oy * out + ox] = sum > 0 ? sum : 0;
      }
  }
}

/**
 * Per-camera memory for the classifier. A board that is standing still looks the same frame after
 * frame, so a square is only run through the network when a piece-sized part of its crop has changed
 * since the last time, or every `refresh` reads as a safety net (staggered so they never all land at once).
 */
export class SquareCache {
  private prev = new Float32Array(64 * CROP * CROP);
  private age = new Uint8Array(64);
  private known = new Uint8Array(64);
  private probs = new Float32Array(64 * 3);
  private lg = new Float32Array(3);
  /** Squares the network actually ran on in the last call. */
  ran = 0;

  constructor(private net: SquareCnn, private tol = 0.06, private refresh = 15) {
    for (let sq = 0; sq < 64; sq++) this.age[sq] = (sq * 7) % refresh;
  }

  /** Forget everything (the corners moved, so the old crops no longer line up). */
  reset() { this.known.fill(0); }

  classify(crops: Float32Array): Float32Array {
    const B = 4, nb = CROP / B;
    this.ran = 0;
    for (let sq = 0; sq < 64; sq++) {
      const at = sq * CROP * CROP;
      let stale = !this.known[sq] || ++this.age[sq] >= this.refresh;
      if (!stale) {
        // largest change of any 4x4 block's mean: noise averages out inside a block, a piece does not
        for (let by = 0; by < nb && !stale; by++)
          for (let bx = 0; bx < nb; bx++) {
            let d = 0;
            for (let y = 0; y < B; y++) { const i = at + (by * B + y) * CROP + bx * B; for (let x = 0; x < B; x++) d += crops[i + x] - this.prev[i + x]; }
            if (Math.abs(d) / (B * B) > this.tol) { stale = true; break; }
          }
      }
      if (!stale) continue;
      this.prev.set(crops.subarray(at, at + CROP * CROP), at);
      this.known[sq] = 1; this.age[sq] = 0; this.ran++;
      const lg = this.net.logits(crops, at, this.lg), m = Math.max(lg[0], lg[1], lg[2]);
      const e0 = Math.exp(lg[0] - m), e1 = Math.exp(lg[1] - m), e2 = Math.exp(lg[2] - m), z = e0 + e1 + e2;
      this.probs[sq * 3] = e0 / z; this.probs[sq * 3 + 1] = e1 / z; this.probs[sq * 3 + 2] = e2 / z;
    }
    return this.probs;
  }
}

const logit = (p: number) => { const q = Math.min(0.999, Math.max(0.001, p)); return Math.log(q / (1 - q)); };
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
/** The network is tempered (logits divided by this) so a camera it has never seen cannot shout. */
const TEMPERATURE = 2;
/** Share of the final log-odds that comes from the network; the rest stays with the brightness reader. */
const NET_SHARE = 0.6;

/**
 * Mixes the network's reading into the brightness reader's, in place, in the log-odds domain so neither
 * can zero a square on its own. Returns false (and leaves the brightness reading untouched) when the
 * network's piece count is not believable: more than 32, or less than half of what the brightness reader sees.
 * That is what a camera the model has never seen tends to look like, and one such camera must not wipe the board in fusion.
 */
export function blendReadings(occ: Float32Array, white: Float32Array, probs: Float32Array): boolean {
  let rules = 0, net = 0;
  for (let sq = 0; sq < 64; sq++) { if (occ[sq] > 0.5) rules++; if (probs[sq * 3] < 0.5) net++; }
  if (net > 32 || (rules >= 6 && net < rules * 0.5)) return false;
  for (let sq = 0; sq < 64; sq++) {
    const e = probs[sq * 3], w = probs[sq * 3 + 1], b = probs[sq * 3 + 2];
    const netOcc = Math.max(-3, Math.min(3, logit(1 - e) / TEMPERATURE));
    occ[sq] = sigmoid(NET_SHARE * netOcc + (1 - NET_SHARE) * logit(occ[sq]));
    if (w + b > 1e-6) {
      const netWhite = Math.max(-3, Math.min(3, logit(w / (w + b)) / TEMPERATURE));
      white[sq] = sigmoid(NET_SHARE * netWhite + (1 - NET_SHARE) * logit(white[sq]));
    }
  }
  return true;
}
