import { applyH, boardToImage } from "./homography";
import { clamp, sigmoid, type GrayFrame, type Pt, type SquareObs } from "./types";

export interface SamplerConfig {
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
  grid: 4,
  patch: 0.5,
});

/**
 * Per-camera board reader. Learns a per-square "empty" reference (light/dark baselines taken from
 * the four empty ranks of the starting position), then scores each square from the signed
 * luminance delta: |delta| -> occupancy, sign -> colour (white pieces are IR-bright, black are IR-dark).
 * The reference slowly adapts on squares believed empty so lighting drift does not create phantom pieces.
 */
export class BoardSampler {
  ref = new Float32Array(64).fill(NaN);
  prev = new Float32Array(64).fill(NaN);
  private H: number[] = [];
  private key = "";
  private pts: Pt[][] = [];

  constructor(public cam: string, public cfg: SamplerConfig = defaultSamplerConfig()) {}

  private prepare() {
    const key = JSON.stringify(this.cfg.corners) + this.cfg.grid + this.cfg.patch;
    if (key === this.key) return;
    this.key = key;
    this.H = boardToImage(this.cfg.corners);
    const { grid, patch } = this.cfg;
    this.pts = [];
    for (let sq = 0; sq < 64; sq++) {
      const cx = (sq % 8) + 0.5, cy = Math.floor(sq / 8) + 0.5;
      const list: Pt[] = [];
      for (let j = 0; j < grid; j++)
        for (let i = 0; i < grid; i++) {
          const u = cx + ((i + 0.5) / grid - 0.5) * patch;
          const v = cy + ((j + 0.5) / grid - 0.5) * patch;
          list.push(applyH(this.H, u, v));
        }
      this.pts.push(list);
    }
  }

  /** Mean luminance of each square's centre patch. */
  measure(frame: GrayFrame): Float32Array {
    this.prepare();
    const out = new Float32Array(64);
    for (let sq = 0; sq < 64; sq++) {
      let s = 0, n = 0;
      for (const p of this.pts[sq]) {
        const x = Math.round(p.x), y = Math.round(p.y);
        if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) continue;
        s += frame.data[y * frame.width + x];
        n++;
      }
      out[sq] = n ? s / n : NaN;
    }
    return out;
  }

  /** Learn empty-square references from a frame of the starting position (ranks 3-6 are empty). */
  calibrateFromStart(frame: GrayFrame) {
    const m = this.measure(frame);
    let light = 0, ln = 0, dark = 0, dn = 0;
    for (let sq = 16; sq < 48; sq++) {
      const isLight = ((sq % 8) + Math.floor(sq / 8)) % 2 === 0;
      if (isLight) { light += m[sq]; ln++; } else { dark += m[sq]; dn++; }
      this.ref[sq] = m[sq];
    }
    for (let sq = 0; sq < 64; sq++) {
      if (sq >= 16 && sq < 48) continue;
      const isLight = ((sq % 8) + Math.floor(sq / 8)) % 2 === 0;
      this.ref[sq] = isLight ? light / ln : dark / dn;
    }
  }

  calibrateEmpty(frame: GrayFrame) {
    this.ref.set(this.measure(frame));
  }

  get calibrated() {
    return !Number.isNaN(this.ref[0]);
  }

  read(frame: GrayFrame, weight = 1): SquareObs {
    const m = this.measure(frame);
    const occ = new Float32Array(64), white = new Float32Array(64).fill(0.5);
    const hand = new Uint8Array(64);
    let moving = 0, bad = 0;
    const { threshold, softness } = this.cfg;
    for (let sq = 0; sq < 64; sq++) {
      const v = m[sq];
      if (Number.isNaN(v) || !this.calibrated) { occ[sq] = 0.5; bad++; continue; }
      const ref = this.ref[sq], thr = ref * threshold, soft = Math.max(1, ref * softness);
      const d = v - ref;
      occ[sq] = sigmoid((Math.abs(d) - thr) / soft);
      white[sq] = sigmoid(d / (soft * 2));
      if (v >= 250 || v <= 3) bad++;
      const p = this.prev[sq];
      if (!Number.isNaN(p) && Math.abs(v - p) > thr * 1.2) { moving++; hand[sq] = 1; }
      // adapt reference slowly where the square looks empty
      if (occ[sq] < 0.05) this.ref[sq] += (v - this.ref[sq]) * 0.01;
    }
    this.prev.set(m);
    return {
      cam: this.cam, t: frame.t,
      quality: clamp(1 - (bad / 64) * 2, 0, 1),
      weight, occ, white,
      motion: moving / 64,
      handSquares: hand,
    };
  }
}
