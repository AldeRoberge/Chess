import { clamp, logit, sigmoid, type BoardBelief, type SquareObs } from "./types";

/**
 * Multi-camera fusion in the log-odds domain (naive-Bayes, so independent cameras add evidence).
 * Per-camera weight = image quality x user trust x learned reliability x occlusion gate.
 * Reliability is an EMA of how often the camera agrees with the consensus, so a bumped or
 * dirty camera fades out automatically; an offline camera simply stops contributing.
 */
export class Fusion {
  reliability = new Map<string, number>();
  lastSeen = new Map<string, number>();
  /** Cameras whose corners are turned half way (white pieces on the top rows): their reading is turned back before it is mixed in. */
  turned = new Map<string, boolean>();

  /**
   * White starts at the bottom of the grid, so a camera that puts the white pieces on top has its corner order turned 180°.
   * Mixed in as it is, its colours cancel the other cameras' and the whole board turns into doubtful red squares.
   * The side is judged from the pieces (bottom half minus top half, -1..1), latched once it is clear, and the reading is turned back.
   */
  orient(obs: SquareObs[]): SquareObs[] {
    return obs.map((o) => {
      let sum = 0, n = 0;
      for (let sq = 0; sq < 64; sq++) if (o.occ[sq] > 0.5) { sum += (sq >= 32 ? 1 : -1) * (o.white[sq] * 2 - 1); n++; }
      const side = n >= 8 ? sum / n : 0;
      if (Math.abs(side) > 0.3) this.turned.set(o.cam, side < 0);
      return this.turned.get(o.cam) ? turnObs(o) : o;
    });
  }

  fuse(obs: SquareObs[], now: number, staleMs = 500, handMotion = 0.08): BoardBelief {
    const live = obs.filter((o) => now - o.t <= staleMs && o.quality > 0 && o.weight > 0);
    // A couple of squares of lamp flicker is not a hand. Below this, the board freezes and a real move never lands.
    const handAt = Math.max(0.06, handMotion);
    const occL = new Float32Array(64), whL = new Float32Array(64), wsum = new Float32Array(64);
    const weights: Record<string, number> = {};
    let hand = false;
    for (const o of live) {
      const rel = this.reliability.get(o.cam) ?? 0.8;
      const occluded = o.motion > handAt;
      if (occluded) hand = true;
      // an occluded camera is nearly mute; its anomalies still flag the hand
      const w = o.quality * o.weight * rel * (occluded ? 0.1 : 1);
      weights[o.cam] = w;
      for (let sq = 0; sq < 64; sq++) {
        occL[sq] += w * logit(o.occ[sq]);
        // colour evidence only counts where the camera believes there is a piece
        const wc = w * o.occ[sq];
        whL[sq] += wc * logit(o.white[sq]);
        wsum[sq] += wc;
      }
    }
    const occ = new Float32Array(64), white = new Float32Array(64), conf = new Float32Array(64);
    let fid = 0;
    for (let sq = 0; sq < 64; sq++) {
      occ[sq] = live.length ? sigmoid(occL[sq]) : 0.5;
      // Keep the weighted evidence continuous. Uncertainty is not proof of absence;
      // temporal hysteresis and legal-move matching decide when to act on it.
      white[sq] = wsum[sq] > 0 ? sigmoid(whL[sq]) : 0.5;
      const cOcc = Math.abs(occ[sq] * 2 - 1);
      const cCol = occ[sq] > 0.5 ? Math.abs(white[sq] * 2 - 1) : 1;
      conf[sq] = clamp(Math.min(cOcc, cCol), 0, 1);
      fid += conf[sq];
    }
    // learn reliability from agreement with the consensus
    for (const o of live) {
      let agree = 0;
      for (let sq = 0; sq < 64; sq++) if ((o.occ[sq] > 0.5) === (occ[sq] > 0.5)) agree++;
      const r = this.reliability.get(o.cam) ?? 0.8;
      if (o.motion <= handAt) this.reliability.set(o.cam, clamp(r + ((agree / 64) - r) * 0.02, 0.2, 1));
      this.lastSeen.set(o.cam, now);
    }
    return { t: now, occ, white, conf, fidelity: live.length ? fid / 64 : 0, handOver: hand, settled: false, cams: live.length };
  }
}

/** A reading turned half way round: square 0 swaps with 63, 1 with 62, and so on. */
export function turnObs(o: SquareObs): SquareObs {
  const flip = <T extends Float32Array | Uint8Array>(a: T): T => { const r = a.slice() as T; for (let i = 0; i < 64; i++) r[i] = a[63 - i]; return r; };
  return { ...o, occ: flip(o.occ), white: flip(o.white), handSquares: flip(o.handSquares) };
}
