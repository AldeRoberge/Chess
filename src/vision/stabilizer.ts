import { clamp, logit, type BoardBelief } from "./types";

export interface StabilizerConfig {
  decay: number; // 0..1 integrator memory per tick
  on: number; // log-odds to switch ON
  off: number; // log-odds to switch OFF (hysteresis)
  settleMs: number; // quiet time before the board is declared settled
  holdOnHand: boolean;
}
export const defaultStabilizerConfig = (): StabilizerConfig => ({ decay: 0.8, on: 3, off: -3, settleMs: 700, holdOnHand: true });

/**
 * Temporal filter: leaky log-odds integration + Schmitt-trigger hysteresis per square, frozen
 * while a hand is over the board, and a "settled" flag that only rises after a quiet period.
 */
export class Stabilizer {
  accOcc = new Float32Array(64);
  accWhite = new Float32Array(64);
  occ = new Uint8Array(64);
  white = new Uint8Array(64).fill(1);
  lastChange = 0;
  private started = false;

  constructor(public cfg: StabilizerConfig = defaultStabilizerConfig()) {}

  step(b: BoardBelief): BoardBelief {
    const { decay, on, off } = this.cfg;
    const frozen = this.cfg.holdOnHand && b.handOver;
    if (!this.started) { this.lastChange = b.t; this.started = true; }
    if (!frozen && b.cams > 0) {
      for (let sq = 0; sq < 64; sq++) {
        this.accOcc[sq] = clamp(this.accOcc[sq] * decay + logit(b.occ[sq]) * (1 - decay) * 3, -8, 8);
        this.accWhite[sq] = clamp(this.accWhite[sq] * decay + logit(b.white[sq]) * (1 - decay) * 3, -8, 8);
        const wasOcc = this.occ[sq];
        if (!this.occ[sq] && this.accOcc[sq] > on) this.occ[sq] = 1;
        else if (this.occ[sq] && this.accOcc[sq] < off) this.occ[sq] = 0;
        const wasWhite = this.white[sq];
        if (!this.white[sq] && this.accWhite[sq] > on * 0.5) this.white[sq] = 1;
        else if (this.white[sq] && this.accWhite[sq] < off * 0.5) this.white[sq] = 0;
        if (wasOcc !== this.occ[sq] || (this.occ[sq] && wasWhite !== this.white[sq])) this.lastChange = b.t;
      }
    } else if (frozen) {
      this.lastChange = b.t; // a hand resets the quiet timer
    }
    const occ = new Float32Array(64), white = new Float32Array(64), conf = new Float32Array(64);
    let fid = 0;
    for (let sq = 0; sq < 64; sq++) {
      occ[sq] = this.occ[sq];
      white[sq] = this.white[sq];
      conf[sq] = clamp(Math.abs(this.accOcc[sq]) / 6, 0, 1);
      fid += conf[sq];
    }
    return {
      t: b.t, occ, white, conf,
      fidelity: Math.min(b.fidelity, fid / 64),
      handOver: b.handOver,
      settled: !b.handOver && b.cams > 0 && b.t - this.lastChange >= this.cfg.settleMs,
      cams: b.cams,
    };
  }
}
