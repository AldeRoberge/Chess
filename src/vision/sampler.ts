import { applyH, boardToImage } from "./homography";
import { clamp, sigmoid, type GrayFrame, type Pt, type SquareObs } from "./types";

export interface SamplerConfig {
  shapeWeight?: number; // texture/edge evidence strength
  colorWeight?: number; // brightness evidence strength
  positionWeight?: number; // perspective correction strength
  corners: Pt[]; // [a8,h8,h1,a1] in image pixels
  threshold: number; // |delta| that counts as "piece present", as a fraction of the square's empty brightness (exposure-independent)
  softness: number; // sigmoid softness, same units
  grid: number; // sample points per axis in each square's centre patch
  patch: number; // fraction of the square sampled (0..1)
}

export const defaultSamplerConfig = (): SamplerConfig => ({
  corners: [{ x: 40, y: 20 }, { x: 440, y: 20 }, { x: 440, y: 340 }, { x: 40, y: 340 }],
  threshold: 0.22,
  softness: 0.06,
  grid: 8,
  patch: 0.6,
});

const SAT = 250; // pixels at or above this are clipped glare, not a piece
const GHOST_Z = 3; // evidence (in softness units) above which a square is clearly a piece and the ghost guard stays out of it
const GHOST_LOOK = 0.35; // how far (ln brightness) a square's dark/bright ends may sit from both learned piece looks
const TEX_ONLY = 0.1; // weight of texture evidence when the brightness did not move
const RIM = 0.44; // how far from a square's centre (in square widths) the corner samples sit — outside a piece's base, inside the square

/**
 * Per-camera board reader.
 *
 * The empty board is learned from the four open ranks of the starting position. Those ranks keep
 * their own brightness (so a lamp that stays put is not a piece). The ranks that are full of pieces
 * at the start get a smooth lighting estimate fitted to the open ranks, so a bright near side and a
 * dark far side are not read as pieces.
 *
 * A square is occupied when its middle differs from that empty brightness, OR — the case a plain
 * average misses — when the middle differs from the square's own corners. A white piece on a light
 * square and a black piece on a dark square barely change the average, but they still stand out
 * from the wood around them. A blown-out glare spot, which lifts the whole square evenly, is left
 * undecided instead of being called a white piece.
 *
 * The middle is shifted slightly toward the far side of an oblique camera, where the piece body
 * actually appears.
 */
export class BoardSampler {
  ref = new Float32Array(64).fill(NaN);
  rimRef = new Float32Array(64).fill(NaN);
  prev = new Float32Array(64).fill(NaN);
  /** Texture of an empty square (std-dev of its middle) as measured at calibration; NaN until learned. */
  spreadGate = NaN;
  /** (ln dark end, ln bright end) of the middle relative to the empty square, for white and black pieces on light [0] and dark [1] squares, learned from the start position. */
  private spreadByColor = [NaN, NaN];
  private tone: { w: [number, number][]; b: [number, number][] } | null = null;
  leanU = 0;
  leanV = 0;
  private H: number[] = [];
  private key = "";
  private crownPts: Pt[][] = [];
  private rimPts: Pt[][] = [];

  constructor(public cam: string, public cfg: SamplerConfig = defaultSamplerConfig()) {}

  private prepare() {
    const key = JSON.stringify(this.cfg.corners) + this.cfg.grid + this.cfg.patch + (this.cfg.positionWeight ?? 1);
    if (key === this.key) return;
    this.key = key;
    this.H = boardToImage(this.cfg.corners);
    this.lean();
    const { grid, patch } = this.cfg;
    this.crownPts = [];
    this.rimPts = [];
    for (let sq = 0; sq < 64; sq++) {
      const cx = (sq % 8) + 0.5, cy = Math.floor(sq / 8) + 0.5;
      const crown: Pt[] = [];
      for (let j = 0; j < grid; j++)
        for (let i = 0; i < grid; i++) {
          const u = clamp(cx + ((i + 0.5) / grid - 0.5) * patch + this.leanU, sq % 8 + 0.08, sq % 8 + 0.92);
          const v = clamp(cy + ((j + 0.5) / grid - 0.5) * patch + this.leanV, Math.floor(sq / 8) + 0.08, Math.floor(sq / 8) + 0.92);
          crown.push(applyH(this.H, u, v));
        }
      const rim: Pt[] = [];
      for (let k = 0; k < 8; k++) {
        const a = ((k + 0.5) * Math.PI) / 4;
        rim.push(applyH(this.H, cx + Math.cos(a) * RIM, cy + Math.sin(a) * RIM));
      }
      this.crownPts.push(crown);
      this.rimPts.push(rim);
    }
  }

  /** Shift of the centre patch, in squares, toward where a standing piece's body lands. */
  lean(): { u: number; v: number } {
    const c = this.cfg.corners;
    if (c.length !== 4) return { u: this.leanU, v: this.leanV };
    const len = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
    const rank8 = len(c[0], c[1]), rank1 = len(c[3], c[2]);
    const fileA = len(c[0], c[3]), fileH = len(c[1], c[2]);
    // The longer image edge is closer to the camera. Piece tops lean toward the far, shorter edge.
    const rank = (rank1 - rank8) / (rank1 + rank8 || 1);
    const file = (fileA - fileH) / (fileA + fileH || 1);
    this.leanU = clamp(file, -1, 1) * 0.2 * (this.cfg.positionWeight ?? 1);
    this.leanV = clamp(-rank, -1, 1) * 0.2 * (this.cfg.positionWeight ?? 1);
    return { u: this.leanU, v: this.leanV };
  }

  private pixel(frame: GrayFrame, x: number, y: number): number | null {
    if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) return null;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(frame.width - 1, x0 + 1), y1 = Math.min(frame.height - 1, y0 + 1);
    const tx = x - x0, ty = y - y0;
    const w = frame.width, d = frame.data;
    const a = d[y0 * w + x0], b = d[y0 * w + x1], c = d[y1 * w + x0], e = d[y1 * w + x1];
    return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + e * tx * ty;
  }

  /** Median of the unclipped samples. 255 means the patch is blown out; NaN means it isn't on the image. */
  private medianAt(frame: GrayFrame, pts: Pt[]): number {
    const vals: number[] = [];
    let sat = 0;
    for (const p of pts) {
      const v = this.pixel(frame, p.x, p.y);
      if (v === null) continue;
      if (v >= SAT) { sat++; continue; }
      vals.push(v);
    }
    if (vals.length * 2 < pts.length) return sat * 2 >= pts.length ? 255 : NaN;
    vals.sort((a, b) => a - b);
    const m = vals.length >> 1;
    return vals.length % 2 ? vals[m] : (vals[m - 1] + vals[m]) / 2;
  }

  /** Median brightness of each square's centre patch (what the hover and the tests read). */
  measure(frame: GrayFrame): Float32Array {
    this.prepare();
    const out = new Float32Array(64);
    for (let sq = 0; sq < 64; sq++) out[sq] = this.medianAt(frame, this.crownPts[sq]);
    return out;
  }

  /** Std-dev and the dark / bright ends of the unclipped samples. An empty square is flat; any piece (even white on white) has shading and edges. */
  private statsAt(frame: GrayFrame, pts: Pt[]): { spread: number; lo: number; hi: number } {
    const vals: number[] = [];
    for (const p of pts) {
      const v = this.pixel(frame, p.x, p.y);
      if (v === null || v >= SAT) continue;
      vals.push(v);
    }
    if (vals.length < 4) return { spread: NaN, lo: NaN, hi: NaN };
    const n = vals.length, m = vals.reduce((a, v) => a + v, 0) / n;
    const sd = Math.sqrt(vals.reduce((a, v) => a + (v - m) * (v - m), 0) / n);
    vals.sort((x, y) => x - y);
    return { spread: sd, lo: vals[Math.floor(n * 0.15)], hi: vals[Math.min(n - 1, Math.floor(n * 0.85))] };
  }

  private squares(frame: GrayFrame): { crown: Float32Array; rim: Float32Array; spread: Float32Array; lo: Float32Array; hi: Float32Array } {
    this.prepare();
    const crown = new Float32Array(64), rim = new Float32Array(64), spread = new Float32Array(64), lo = new Float32Array(64), hi = new Float32Array(64);
    for (let sq = 0; sq < 64; sq++) {
      crown[sq] = this.medianAt(frame, this.crownPts[sq]);
      rim[sq] = this.medianAt(frame, this.rimPts[sq]);
      const st = this.statsAt(frame, this.crownPts[sq]);
      spread[sq] = st.spread; lo[sq] = st.lo; hi[sq] = st.hi;
    }
    return { crown, rim, spread, lo, hi };
  }

  /**
   * Which difference to trust. `drive` is positive for a white piece, negative for a black one;
   * `gate` is how large |drive| must be. The corner cue wins when the middle stands out from the
   * square's own border — that is the same-colour piece a single average cannot see.
   */
  private cue(crown: number, rim: number, ref: number, rim0: number): { drive: number; gate: number } {
    const thr = Math.max(ref * this.cfg.threshold, 12);
    const thrRim = Math.max(ref * this.cfg.threshold * 0.42, 9);
    const dRef = crown - ref;
    // How much the middle stands out from its border, beyond the contrast an empty square already has (blur from the neighbouring colour).
    const dRim = crown - rim - (Number.isFinite(rim0) && Number.isFinite(ref) ? ref - rim0 : 0);
    const useRim = Number.isFinite(rim) && Number.isFinite(rim0)
      && Math.abs(dRim) >= thrRim
      && dRef * dRim >= 0
      && Math.abs(dRef) >= thrRim * 0.3 // the middle itself must move too: a darkened border alone is a shadow or a neighbour
      && Math.abs(dRim) > Math.abs(rim - rim0) * 0.45;
    return useRim ? { drive: dRim, gate: thrRim } : { drive: dRef, gate: thr };
  }

  /** For the hover card: the brightnesses and the difference that actually decided this square. */
  diagnose(frame: GrayFrame, sq: number): { crown: number; rim: number; ref: number; drive: number; gate: number; spread: number; spreadGate: number } {
    this.prepare();
    const crown = this.medianAt(frame, this.crownPts[sq]);
    const rim = this.medianAt(frame, this.rimPts[sq]);
    const ref = this.ref[sq];
    const scored = this.cue(crown, rim, ref, this.rimRef[sq]);
    return { crown, rim, ref, drive: scored.drive, gate: scored.gate, spread: this.statsAt(frame, this.crownPts[sq]).spread, spreadGate: this.spreadGate };
  }

  /** Learn empty-square references from a frame of the starting position (ranks 3-6 are empty). */
  calibrateFromStart(frame: GrayFrame) {
    const { crown, rim, spread, lo, hi } = this.squares(frame);
    const light = this.fit(crown, true), dark = this.fit(crown, false);
    const lightRim = this.fit(rim, true), darkRim = this.fit(rim, false);
    for (let sq = 0; sq < 64; sq++) {
      const file = sq % 8, row = Math.floor(sq / 8);
      const plane = ((file + row) % 2 === 0 ? light : dark);
      const planeRim = ((file + row) % 2 === 0 ? lightRim : darkRim);
      const open = sq >= 16 && sq < 48;
      // Open ranks: trust the measurement, unless it is a spike the smooth light cannot explain (a piece or a lamp).
      const pred = plane(file, row), predRim = planeRim(file, row);
      const spike = Number.isFinite(crown[sq]) && Math.abs(crown[sq] - pred) > Math.max(36, Math.abs(pred) * 0.28);
      this.ref[sq] = open && !spike ? crown[sq] : pred;
      this.rimRef[sq] = open && !spike ? rim[sq] : predRim;
    }
    // Texture of an empty square: 95th percentile over the open ranks (pieces and spikes aside), with room for sensor noise.
    const flat = [];
    for (let sq = 16; sq < 48; sq++) if (Number.isFinite(spread[sq])) flat.push(spread[sq]);
    flat.sort((a, b) => a - b);
    this.spreadGate = flat.length >= 8 ? Math.max(flat[Math.floor(flat.length * 0.9)] * 2.2, flat[Math.floor(flat.length * 0.9)] + 7) : NaN;
    // Dark squares often carry more sensor noise than light squares. Keep their
    // noise floors separate so one colour cannot hide pieces on the other.
    for (let k = 0; k < 2; k++) {
      const samples: number[] = [];
      for (let sq = 16; sq < 48; sq++)
        if ((sq % 8 + Math.floor(sq / 8)) % 2 === k && Number.isFinite(spread[sq])) samples.push(spread[sq]);
      samples.sort((a, b) => a - b);
      const noise = samples[Math.floor(samples.length * 0.9)];
      this.spreadByColor[k] = samples.length >= 8 ? Math.max(noise * 2.2, noise + 7) : this.spreadGate;
    }
    // What a white and a black piece look like next to an empty square, per square colour: the pieces' own start squares.
    const ln = (v: number, ref: number) => Math.log(Math.max(1, v) / Math.max(1, ref));
    const med = (xs: number[]) => { xs.sort((a, b) => a - b); return xs.length ? xs[xs.length >> 1] : NaN; };
    const lvl = (from: number, to: number, lightSq: boolean): [number, number] => {
      const d: number[] = [], u: number[] = [];
      for (let sq = from; sq < to; sq++) if (((sq % 8 + Math.floor(sq / 8)) % 2 === 0) === lightSq && Number.isFinite(lo[sq]) && Number.isFinite(this.ref[sq])) { d.push(ln(lo[sq], this.ref[sq])); u.push(ln(hi[sq], this.ref[sq])); }
      return [med(d), med(u)];
    };
    const w = [lvl(48, 64, true), lvl(48, 64, false)], b = [lvl(0, 16, true), lvl(0, 16, false)];
    // Only trust the learned look when white and black are clearly different on both square colours.
    this.tone = [0, 1].every((k) => w[k].concat(b[k]).every(Number.isFinite) && Math.hypot(w[k][0] - b[k][0], w[k][1] - b[k][1]) > 0.3) ? { w, b } : null;
  }

  /** Brightness of one colour as a + b·file + c·row, fitted to the open ranks with spikes left out. */
  private fit(values: Float32Array, light: boolean): (file: number, row: number) => number {
    const samples: { f: number; r: number; v: number }[] = [];
    for (let sq = 16; sq < 48; sq++) {
      const f = sq % 8, r = Math.floor(sq / 8);
      if ((f + r) % 2 === 0 !== light || !Number.isFinite(values[sq])) continue;
      samples.push({ f, r, v: values[sq] });
    }
    if (!samples.length) return () => NaN;
    const sorted = samples.map((s) => s.v).sort((a, b) => a - b);
    const mid = sorted[sorted.length >> 1];
    const dev = sorted.map((v) => Math.abs(v - mid)).sort((a, b) => a - b);
    const mad = dev[dev.length >> 1] || 1;
    const keep = samples.filter((s) => Math.abs(s.v - mid) < Math.max(22, mad * 3.5));
    const use = keep.length >= 6 ? keep : samples;
    const mean = use.reduce((a, s) => a + s.v, 0) / use.length;
    let n = 0, sf = 0, sr = 0, sv = 0, sff = 0, srr = 0, sfr = 0, sfv = 0, srv = 0;
    for (const s of use) { n++; sf += s.f; sr += s.r; sv += s.v; sff += s.f * s.f; srr += s.r * s.r; sfr += s.f * s.r; sfv += s.f * s.v; srv += s.r * s.v; }
    const sol = solve3(
      [[n, sf, sr], [sf, sff, sfr], [sr, sfr, srr]],
      [sv, sfv, srv],
    );
    if (!sol) return () => mean;
    return (f, r) => sol[0] + sol[1] * f + sol[2] * r;
  }

  calibrateEmpty(frame: GrayFrame) {
    const { crown, rim } = this.squares(frame);
    this.spreadGate = NaN;
    this.spreadByColor = [NaN, NaN];
    this.tone = null;
    this.ref.set(crown);
    this.rimRef.set(rim);
  }

  get calibrated() {
    return !Number.isNaN(this.ref[0]);
  }

  read(frame: GrayFrame, weight = 1): SquareObs {
    const { crown, rim, spread, lo, hi } = this.squares(frame);
    const occ = new Float32Array(64), white = new Float32Array(64).fill(0.5);
    const hand = new Uint8Array(64);
    let moving = 0, bad = 0;
    const softOf = (ref: number) => Math.max(1, ref * this.cfg.softness);
    for (let sq = 0; sq < 64; sq++) {
      const v = crown[sq], edge = rim[sq], ref = this.ref[sq];
      const p = this.prev[sq];
      if (Number.isNaN(v) || !this.calibrated || !Number.isFinite(ref)) { occ[sq] = 0.5; bad++; this.prev[sq] = v; continue; }
      const { drive, gate } = this.cue(v, edge, ref, this.rimRef[sq]);
      const soft = softOf(ref);
      // Glare is light the square did not have when it was learned empty. A pale square that is bright by nature
      // (v close to its own empty reference) is just an empty square, not a lamp wash-out.
      const lifted = v - ref > Math.max(12, ref * 0.05);
      // A lamp lifts the square and its border together; a piece (even a clipped white one) stands out from the wood around its base.
      const rim0 = this.rimRef[sq], standMin = Math.max(ref * this.cfg.threshold * 0.42, 9);
      const stands = Number.isFinite(edge) && Number.isFinite(rim0) && Math.abs(v - edge - (ref - rim0)) >= standMin;
      const blown = (v >= SAT && lifted && !stands) || (v >= 235 && Math.abs(v - edge) < gate && drive > gate);
      if (blown) { occ[sq] = 0.5; white[sq] = 0.5; bad++; }
      else {
        if (v <= 3) bad++;
        let zBright = (Math.abs(drive) - gate) / soft;
        // Texture: an empty square is flat, a piece is not. A king's cross is this kind of evidence, and a smooth shadow is not.
        const textureGate = this.spreadByColor[(sq % 8 + Math.floor(sq / 8)) % 2] ?? this.spreadGate;
        const zTex = Number.isFinite(textureGate) && Number.isFinite(spread[sq]) ? (spread[sq] - textureGate) / Math.max(1.5, textureGate * 0.25) : -Infinity;
        if (this.tone && v > 3 && Number.isFinite(lo[sq])) {
          const k = ((sq % 8) + Math.floor(sq / 8)) % 2, d = Math.log(Math.max(1, lo[sq]) / Math.max(1, ref)), u = Math.log(Math.max(1, hi[sq]) / Math.max(1, ref));
          const dw = Math.hypot(d - this.tone.w[k][0], u - this.tone.w[k][1]), db = Math.hypot(d - this.tone.b[k][0], u - this.tone.b[k][1]);
          white[sq] = sigmoid((db - dw) / 0.3);
          // Ghost guard: a shadow, a lamp gradient or a wobbly corner shifts the square's brightness, but it looks like neither a
          // white nor a black piece. It may only discount the brightness cue — a textured piece (the king) still counts.
          const alike = Math.min(dw, db), empty = Math.hypot(d, u);
          // Only a flat square may be wiped: a king under different light does not match the learned
          // piece tone, but it still has edges. A smooth shadow has neither, and stays empty.
          const flat = !(zTex > -0.5);
          if (flat && zBright < GHOST_Z && alike > GHOST_LOOK && alike > empty * 0.9) zBright -= (alike - GHOST_LOOK) / 0.1;
        } else white[sq] = sigmoid(drive / (soft * 2));
        // A square flatter than bare wood is a lamp or the wood a piece just left, not a piece. Brightness
        // alone must not keep that square occupied, or the king that stepped away never leaves its home.
        if (!stands && drive > 0 && zTex > -Infinity && zTex < -0.5) zBright = Math.min(zBright, zTex);
        // A lamp that washes the square out is not a vote. Calling it empty erases the knight under the glare
        // and outvotes the camera that can still see it. Leave it undecided.
        const glare = v >= 220 && lifted && !stands && !(zTex > -0.5);
        if (glare) { occ[sq] = 0.5; white[sq] = 0.5; bad++; }
        else {
          // Texture with no brightness change at all is usually a neighbour's edge or shadow falling in the patch, so it speaks softly.
          const texOnly = Math.abs(drive) < gate * 0.3 && !stands;
          occ[sq] = sigmoid(Math.max(zBright * (this.cfg.colorWeight ?? 1), zTex === -Infinity ? -Infinity : zTex * (this.cfg.shapeWeight ?? 1) * (texOnly && zTex > 0 ? TEX_ONLY : 1)));
        }
      }
      const thr = Math.max(ref * this.cfg.threshold, 12);
      // Glare flickers on its own. Counting it as a hand freezes the board, so a move on those squares never lands.
      if (!blown && v < 220 && !Number.isNaN(p) && Math.abs(v - p) > thr * 1.2) { moving++; hand[sq] = 1; }
      if (occ[sq] < 0.05 && !blown) {
        this.ref[sq] += (v - this.ref[sq]) * 0.01;
        if (Number.isFinite(edge)) this.rimRef[sq] += (edge - this.rimRef[sq]) * 0.01;
      }
      this.prev[sq] = v;
    }
    return {
      cam: this.cam, t: frame.t,
      // Unreadable squares reduce the vote proportionally; half a bright board
      // must not mute the readable pieces on the other half.
      quality: clamp(1 - bad / 64, 0, 1),
      weight, occ, white,
      motion: moving / 64,
      handSquares: hand,
    };
  }
}

/** 3×3 linear solve. Null when the rows are degenerate (a flat fit falls back to the mean). */
function solve3(A: number[][], y: number[]): number[] | null {
  const m = [0, 1, 2].map((i) => [...A[i], y[i]]);
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) < 1e-8) return null;
    if (pivot !== col) { const t = m[col]; m[col] = m[pivot]; m[pivot] = t; }
    const div = m[col][col];
    for (let c = col; c < 4; c++) m[col][c] /= div;
    for (let r = 0; r < 3; r++) if (r !== col) {
      const f = m[r][col];
      for (let c = col; c < 4; c++) m[r][c] -= f * m[col][c];
    }
  }
  return [m[0][3], m[1][3], m[2][3]];
}
