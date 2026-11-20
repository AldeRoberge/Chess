import { clamp, logit, sigmoid, type GrayFrame, type Pt } from "./types";

/** The board flattened to one upright picture (see boardImage.ts), with what made it: the camera picture and the corners used. */
export interface FlatBoard {
  cam: string;
  t: number;
  /** BOARD_SIDE x BOARD_SIDE brightness, a typical pixel about 0.5. */
  img: Float32Array;
  frame: GrayFrame;
  /** Board corners in `frame` pixels, a8 h8 h1 a1. */
  corners: Pt[];
}

/**
 * One detector's opinion of the 64 squares: is a piece there, and is it white. No piece types: from above and in grey
 * they are not reliable, and the game tracker works them out from the moves.
 * The picture-level figures come from the detectors that watch for motion (the brightness reader); others leave them out.
 */
export interface Reading {
  cam: string;
  t: number;
  /** Which detector made this ("brightness", "neural board", "blend"...). */
  source: string;
  occ: Float32Array; // P(a piece is on the square)
  white: Float32Array; // P(the piece is white), meaningful where occ is high
  /** Class probabilities per square (13 each: empty, white P N B R Q K, black P N B R Q K), when the detector reads piece types. */
  types?: Float32Array;
  quality?: number;
  motion?: number;
  handSquares?: Uint8Array;
}

export const pieceCount = (r: { occ: ArrayLike<number> }) => { let n = 0; for (let i = 0; i < 64; i++) if (r.occ[i] > 0.5) n++; return n; };

/** The most pieces of each kind (P N B R Q K) a side starts with. */
const START_COUNT = [8, 2, 2, 2, 1, 1];
/**
 * Turns per-square piece-class probabilities into one believable position: a letter per occupied square ("" for empty or
 * when nothing legal fits), never more than one king, eight pawns, no pawn on the first or last row, and an extra
 * knight, bishop, rook or queen only in place of a missing pawn (a promotion). Squares are filled most-confident first
 * per side, so a doubtful second king becomes whatever the network thinks it is next.
 */
export function legalLetters(r: { occ: ArrayLike<number>; white: ArrayLike<number> }, types: ArrayLike<number>): string[] {
  const out: string[] = new Array(64).fill("");
  for (const side of [true, false]) {
    const base = side ? 1 : 7, cand: { sq: number; k: number; p: number }[] = [];
    for (let sq = 0; sq < 64; sq++) {
      if (!(r.occ[sq] > 0.5) || (r.white[sq] > 0.5) !== side) continue;
      for (let k = 0; k < 6; k++) cand.push({ sq, k, p: types[sq * 13 + base + k] });
    }
    cand.sort((a, b) => b.p - a.p);
    const count = [0, 0, 0, 0, 0, 0], done = new Set<number>();
    const extras = () => { let e = 0; for (let k = 1; k < 5; k++) e += Math.max(0, count[k] - START_COUNT[k]); return e; };
    for (const c of cand) {
      if (done.has(c.sq)) continue;
      const row = Math.floor(c.sq / 8);
      if (c.k === 0 && (row === 0 || row === 7 || count[0] + 1 + extras() > 8)) continue;
      if (c.k === 5 && count[5] >= 1) continue;
      if (c.k >= 1 && c.k <= 4 && count[c.k] >= START_COUNT[c.k] && count[0] + extras() + 1 > 8) continue;
      count[c.k]++; done.add(c.sq); out[c.sq] = "PNBRQK"[c.k];
    }
  }
  return out;
}

/** How sure a reading is of one square: for a piece, the weaker of "a piece" and its colour; for an empty square, "empty". */
export function squareConf(r: { occ: ArrayLike<number>; white: ArrayLike<number> }, sq: number): number {
  const o = r.occ[sq], w = r.white[sq];
  return o > 0.5 ? Math.min(o, w > 0.5 ? w : 1 - w) : 1 - o;
}

/** How much two readings agree: the share of squares where both say the same thing (empty, white piece or black piece). */
export function agreement(a: Reading, b: Reading): number {
  let same = 0;
  for (let i = 0; i < 64; i++) {
    const sa = a.occ[i] > 0.5 ? (a.white[i] > 0.5 ? 1 : 2) : 0, sb = b.occ[i] > 0.5 ? (b.white[i] > 0.5 ? 1 : 2) : 0;
    if (sa === sb) same++;
  }
  return same / 64;
}

/** Where the tracked game says every piece stands: per square 0 = empty, else 1 + (white ? 0 : 6) + piece index (P N B R Q K). */
export type Expected = Uint8Array;
const PIECE_ORDER = "pnbrqk";
/** The 64 squares of a FEN (a8 first, like readings) as an `Expected` grid; null if the FEN cannot be read. */
export function expectedFromFen(fen: string | undefined | null): Expected | null {
  if (!fen) return null;
  const out = new Uint8Array(64); let sq = 0;
  for (const ch of fen.split(" ")[0]) {
    if (ch === "/") continue;
    if (ch >= "1" && ch <= "8") { sq += Number(ch); continue; }
    const k = PIECE_ORDER.indexOf(ch.toLowerCase());
    if (k < 0 || sq > 63) return null;
    out[sq++] = 1 + k + (ch === ch.toUpperCase() ? 0 : 6);
  }
  return sq === 64 ? out : null;
}

export interface BlendInput { reading: Reading | null | undefined; weight: number }
export interface BlendResult {
  reading: Reading | null;
  /** Per input: did it take part in the mix (connected, weighted, and not thrown out as implausible). */
  used: boolean[];
  /** Per input: why it was left out, or "". */
  why: string[];
  /** 1 on squares where the readings that took part disagree about a piece or its colour. */
  disagree: Uint8Array;
}

const LIMIT = 5;
/** How firmly the game position speaks for one square at weight 1 (log-odds, about 90%): a real change in the pictures still outvotes it. */
const PRIOR_LOGIT = 2.2;
/**
 * Mixes several detectors' readings square by square in the log-odds domain, each counted by its weight, so no single
 * detector can switch a square on or off alone. The first connected reading is the anchor: another reading is thrown out
 * when its piece count is not believable (over 32, or under half the anchor's), which is what a detector looking at a
 * board it was never trained on tends to give.
 * `expected` (the tracked game position) takes part as one more, gentle voter at `priorWeight`: it knows which piece stands
 * where, so it nudges occupancy, colour and piece type towards the game, without ever hiding a move the pictures show.
 * Piece types from detectors that read them (`Reading.types`) are mixed the same way and come out on the blend.
 */
export function blendReadings(inputs: BlendInput[], guard = true, expected?: Expected | null, priorWeight = 0): BlendResult {
  const used = inputs.map(() => false), why = inputs.map(() => ""), disagree = new Uint8Array(64);
  const present = inputs.map((x, i) => ({ r: x.reading, w: x.weight, i })).filter((x) => x.r);
  if (!present.length) return { reading: null, used, why, disagree };
  for (const x of present) { if (x.w <= 0) why[x.i] = "weight is 0"; }
  const live = present.filter((x) => x.w > 0);
  const anchor = live[0];
  const anchorPieces = anchor ? pieceCount(anchor.r!) : 0;
  for (const x of live) {
    const n = pieceCount(x.r!);
    if (guard && x !== anchor && (n > 32 || (anchorPieces >= 6 && n < anchorPieces * 0.5))) { why[x.i] = n > 32 ? `sees ${n} pieces` : `sees ${n} pieces, the anchor ${anchorPieces}`; continue; }
    used[x.i] = true;
  }
  if (guard && anchor && pieceCount(anchor.r!) > 32 && used.some((u, i) => u && i !== anchor.i)) { used[anchor.i] = false; why[anchor.i] = `sees ${anchorPieces} pieces`; }
  const parts = live.filter((x) => used[x.i]);
  if (!parts.length) return { reading: null, used, why, disagree };
  const pw = expected && priorWeight > 0 ? priorWeight : 0, typed = parts.filter((x) => x.r!.types), anyTypes = typed.length > 0 || pw > 0;
  const occ = new Float32Array(64), white = new Float32Array(64), types = anyTypes ? new Float32Array(64 * 13) : undefined, sum = parts.reduce((a, x) => a + x.w, 0) + pw;
  for (let sq = 0; sq < 64; sq++) {
    let zo = 0, zw = 0, seen = 0, whites = 0, blacks = 0;
    for (const x of parts) {
      zo += x.w * clamp(logit(x.r!.occ[sq]), -LIMIT, LIMIT); zw += x.w * clamp(logit(x.r!.white[sq]), -LIMIT, LIMIT);
      if (x.r!.occ[sq] > 0.5) { seen++; if (x.r!.white[sq] > 0.5) whites++; else blacks++; }
    }
    const e = pw ? expected![sq] : 0;
    if (pw) { zo += pw * (e ? PRIOR_LOGIT : -PRIOR_LOGIT); if (e) zw += pw * (e <= 6 ? PRIOR_LOGIT : -PRIOR_LOGIT); }
    occ[sq] = sigmoid(zo / sum); white[sq] = sigmoid(zw / sum);
    if (parts.length > 1 && ((seen > 0 && seen < parts.length) || (whites > 0 && blacks > 0))) disagree[sq] = 1;
    if (types) {
      // piece classes: the detectors' probabilities and the game's one-hot, weighted; empty follows the blended occupancy
      let tw = 0; const cls = new Float32Array(12);
      for (const x of typed) { tw += x.w; for (let c = 0; c < 12; c++) cls[c] += x.w * x.r!.types![sq * 13 + 1 + c]; }
      if (pw && e) { tw += pw; cls[e - 1] += pw; }
      const total = cls.reduce((a, b) => a + b, 0);
      if (tw > 0 && total > 0) for (let c = 0; c < 12; c++) types[sq * 13 + 1 + c] = (cls[c] / total) * occ[sq];
      types[sq * 13] = 1 - occ[sq];
    }
  }
  const first = parts.find((x) => x.r!.quality !== undefined)?.r ?? present.find((x) => x.r!.quality !== undefined)?.r;
  return {
    reading: { cam: parts[0].r!.cam, t: parts[0].r!.t, source: "blend", occ, white, quality: first?.quality, motion: first?.motion, handSquares: first?.handSquares, types },
    used, why, disagree,
  };
}

/** A network's class probabilities (empty, white, black per square) as a reading, tempered so a camera it has never seen cannot shout. */
export function readingFromProbs(cam: string, t: number, source: string, probs: ArrayLike<number>, temperature: number): Reading {
  const occ = new Float32Array(64), white = new Float32Array(64), T = Math.max(0.5, temperature);
  for (let sq = 0; sq < 64; sq++) {
    const e = probs[sq * 3], w = probs[sq * 3 + 1], b = probs[sq * 3 + 2];
    occ[sq] = sigmoid(logit(1 - e) / T);
    white[sq] = w + b > 1e-6 ? sigmoid(logit(w / (w + b)) / T) : 0.5;
  }
  return { cam, t, source, occ, white };
}
