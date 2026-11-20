import { conv1, conv3, floats, type Layer } from "./boardCnn";
import { VIEW_SIDE } from "./boardView";

/** Layer as exported by ml/train_view.py: k 3 and 1 are convolutions, k 0 is a dense layer on the flattened map. */
export interface ViewLayerJson { k: 0 | 1 | 3; in: number; out: number; stride: number; relu: boolean; w: string; b: string }
export interface ViewCnnJson { side: number; classes: number; layers: ViewLayerJson[] }

/**
 * The masked-view board reader: it gets the board as the camera sees it, perspective and all, with everything outside the
 * board blacked out (boardView.ts). Convolutions bring the picture down to a small map, then dense layers decide which
 * part of it is which square, which a straightened board would not need. Output is (empty, white, black) per square.
 */
export class ViewCnn {
  private convs: Layer[];
  private dense: { cin: number; cout: number; relu: boolean; w: Float32Array; b: Float32Array }[];
  private bufA: Float32Array;
  private bufB: Float32Array;
  private padded: Float32Array;

  constructor(json: ViewCnnJson) {
    if (json.side !== VIEW_SIDE) throw new Error(`model was trained for ${json.side}px views, not ${VIEW_SIDE}`);
    const conv = json.layers.filter((l) => l.k !== 0), dense = json.layers.filter((l) => l.k === 0);
    this.convs = conv.map((l) => ({ k: l.k as 1 | 3, cin: l.in, cout: l.out, stride: l.stride, relu: l.relu, w: floats(l.w), b: floats(l.b) }));
    this.dense = dense.map((l) => ({ cin: l.in, cout: l.out, relu: l.relu, w: floats(l.w), b: floats(l.b) }));
    let side = VIEW_SIDE, act = side * side, pad = 0;
    for (const L of this.convs) {
      if (L.k === 3) pad = Math.max(pad, (side + 2) * (side + 2) * L.cin);
      side = Math.ceil(side / L.stride); act = Math.max(act, side * side * L.cout);
    }
    for (const D of this.dense) act = Math.max(act, D.cout);
    this.bufA = new Float32Array(act); this.bufB = new Float32Array(act); this.padded = new Float32Array(pad);
  }

  /** Logits, class-major (3 x 64), as PyTorch's output. */
  logits(view: Float32Array, out = new Float32Array(3 * 64)): Float32Array {
    let side = VIEW_SIDE, src = this.bufA, dst = this.bufB;
    src.set(view.subarray(0, VIEW_SIDE * VIEW_SIDE));
    for (const L of this.convs) {
      if (L.k === 3) conv3(src, dst, this.padded, L, side); else conv1(src, dst, L, side);
      side = Math.ceil(side / L.stride);
      const t = src; src = dst; dst = t;
    }
    for (const D of this.dense) {
      for (let o = 0; o < D.cout; o++) {
        let s = D.b[o]; const wo = o * D.cin;
        for (let i = 0; i < D.cin; i++) s += D.w[wo + i] * src[i];
        dst[o] = D.relu && s < 0 ? 0 : s;
      }
      const t = src; src = dst; dst = t;
    }
    out.set(src.subarray(0, 3 * 64));
    return out;
  }

  /** P(empty), P(white), P(black) for every square in `sqName` order (a8 first). */
  classify(view: Float32Array, out = new Float32Array(64 * 3)): Float32Array {
    const lg = this.logits(view);
    for (let sq = 0; sq < 64; sq++) {
      const a = lg[sq], b = lg[64 + sq], c = lg[128 + sq], m = Math.max(a, b, c), ea = Math.exp(a - m), eb = Math.exp(b - m), ec = Math.exp(c - m), z = ea + eb + ec;
      out[sq * 3] = ea / z; out[sq * 3 + 1] = eb / z; out[sq * 3 + 2] = ec / z;
    }
    return out;
  }
}
