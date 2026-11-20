import { BOARD_MARGIN, BOARD_PX, BOARD_SIDE } from "./boardImage";

/** Layer as exported by ml/train_board.py: weights are base64 little-endian float32 in PyTorch's [out][in][ky][kx] order. */
export interface BoardLayerJson { k: 1 | 3; in: number; out: number; stride: number; relu: boolean; w: string; b: string }
export interface BoardCnnJson { side: number; classes?: number; layers: BoardLayerJson[] }
/** Piece classes in the order the model outputs them: 0 empty, 1-6 white pawn..king, 7-12 black pawn..king. */
export const PIECE_CLASSES = 13;
export const PIECE_NAMES = ["empty", "P", "N", "B", "R", "Q", "K", "p", "n", "b", "r", "q", "k"];

export interface Layer { k: 1 | 3; cin: number; cout: number; stride: number; relu: boolean; w: Float32Array; b: Float32Array }

export function floats(b64: string): Float32Array {
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

/**
 * The trained whole-board reader: the flattened board image (boardImage.ts) goes through four stride-2 conv stages,
 * two 3x3 stages that let each square's cell look at its neighbours, and a 1x1 classifier, and comes out as one
 * (empty, white, black) triple per square. About 8M multiply-adds for the whole board, against 13M for 64 square crops.
 */
export class BoardCnn {
  private layers: Layer[];
  private bufA: Float32Array;
  private bufB: Float32Array;
  private padded: Float32Array;
  /** Output classes per square: 13 (empty + 6 piece types x 2 colours) or 3 (empty, white, black) for an older model. */
  readonly classes: number;

  constructor(json: BoardCnnJson) {
    if (json.side !== BOARD_SIDE) throw new Error(`model was trained for ${json.side}px boards, not ${BOARD_SIDE}`);
    this.classes = json.classes ?? 3;
    this.layers = json.layers.map((l) => ({ k: l.k, cin: l.in, cout: l.out, stride: l.stride, relu: l.relu, w: floats(l.w), b: floats(l.b) }));
    let side = BOARD_SIDE, act = BOARD_SIDE * BOARD_SIDE, pad = 0;
    for (const L of this.layers) {
      if (L.k === 3) pad = Math.max(pad, (side + 2) * (side + 2) * L.cin);
      side = Math.ceil(side / L.stride);
      act = Math.max(act, side * side * L.cout);
    }
    this.bufA = new Float32Array(act); this.bufB = new Float32Array(act); this.padded = new Float32Array(pad);
  }

  /** Logits for the whole board, class-major (classes x 8 x 8), as PyTorch's output with the margin cells dropped. */
  logits(board: Float32Array, out = new Float32Array(this.classes * 64)): Float32Array {
    let side = BOARD_SIDE, src = this.bufA, dst = this.bufB;
    src.set(board.subarray(0, BOARD_SIDE * BOARD_SIDE));
    for (const L of this.layers) {
      const o = Math.ceil(side / L.stride);
      if (L.k === 3) conv3(src, dst, this.padded, L, side); else conv1(src, dst, L, side);
      side = o;
      const t = src; src = dst; dst = t;
    }
    // src now holds `classes` planes of side x side (10 x 10): the interior 8 x 8 are the squares
    for (let c = 0; c < this.classes; c++)
      for (let r = 0; r < 8; r++)
        for (let f = 0; f < 8; f++) out[c * 64 + r * 8 + f] = src[c * side * side + (r + BOARD_MARGIN) * side + f + BOARD_MARGIN];
    return out;
  }

  /**
   * P(empty), P(white), P(black) for every square, in `sqName` order (a8 first), like SquareCnn.classify.
   * With a 13-class model the colours are sums over the piece types. `types`, when given, receives all
   * `classes` probabilities per square (square-major) so the piece type can be read as well.
   */
  classify(board: Float32Array, out = new Float32Array(64 * 3), types?: Float32Array): Float32Array {
    const lg = this.logits(board), n = this.classes, e = new Float32Array(n);
    for (let sq = 0; sq < 64; sq++) {
      let m = -Infinity; for (let c = 0; c < n; c++) m = Math.max(m, lg[c * 64 + sq]);
      let z = 0; for (let c = 0; c < n; c++) { e[c] = Math.exp(lg[c * 64 + sq] - m); z += e[c]; }
      if (types) for (let c = 0; c < n; c++) types[sq * n + c] = e[c] / z;
      let white = 0, black = 0;
      if (n === 3) { white = e[1]; black = e[2]; } else { for (let c = 1; c <= 6; c++) { white += e[c]; black += e[c + 6]; } }
      out[sq * 3] = e[0] / z; out[sq * 3 + 1] = white / z; out[sq * 3 + 2] = black / z;
    }
    return out;
  }
}

export function conv1(src: Float32Array, dst: Float32Array, L: Layer, side: number) {
  const { cin, cout, w, b } = L, n = side * side;
  for (let o = 0; o < cout; o++)
    for (let p = 0; p < n; p++) {
      let s = b[o];
      for (let c = 0; c < cin; c++) s += w[o * cin + c] * src[c * n + p];
      dst[o * n + p] = L.relu && s < 0 ? 0 : s;
    }
}

/** 3x3 convolution with one pixel of zero padding, optional ReLU; the result is ceil(side / stride) pixels a side. */
export function conv3(src: Float32Array, dst: Float32Array, pad: Float32Array, L: Layer, side: number) {
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
        dst[o * out * out + oy * out + ox] = L.relu && sum < 0 ? 0 : sum;
      }
  }
}

/**
 * Per-camera memory for the board reader: a board that stands still looks the same frame after frame, so the network
 * only runs when a piece-sized part of the picture has changed since the last run, or every `refresh` reads as a safety net.
 */
export class BoardCache {
  private prev = new Float32Array(BOARD_SIDE * BOARD_SIDE);
  private probs = new Float32Array(64 * 3);
  /** All class probabilities per square (square-major) from the last run of the network. */
  readonly types: Float32Array;
  private age = 0;
  private known = false;
  /** Whether the network ran in the last call. */
  ran = false;

  constructor(readonly net: BoardCnn, private tol = 0.06, private refresh = 8) { this.types = new Float32Array(64 * net.classes); }

  reset() { this.known = false; }

  classify(board: Float32Array): Float32Array {
    let stale = !this.known || ++this.age >= this.refresh;
    if (!stale) {
      // largest change of any block's mean (half a square a side): noise averages out inside a block, a piece does not
      const B = BOARD_PX / 2, nb = BOARD_SIDE / B;
      for (let by = 0; by < nb && !stale; by++)
        for (let bx = 0; bx < nb; bx++) {
          let d = 0;
          for (let y = 0; y < B; y++) { const i = (by * B + y) * BOARD_SIDE + bx * B; for (let x = 0; x < B; x++) d += board[i + x] - this.prev[i + x]; }
          if (Math.abs(d) / (B * B) > this.tol) { stale = true; break; }
        }
    }
    this.ran = stale;
    if (!stale) return this.probs;
    this.prev.set(board); this.known = true; this.age = 0;
    return this.net.classify(board, this.probs, this.types);
  }
}
