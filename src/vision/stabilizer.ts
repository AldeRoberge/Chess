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
  private occDirection = new Int8Array(64);
  private whiteDirection = new Int8Array(64);
  private occSince = new Float64Array(64);
  private whiteSince = new Float64Array(64);

  /** Weak evidence needs time, rather than an amplitude it can never reach. */
  private sustained(value: number, sq: number, t: number, direction: Int8Array, since: Float64Array): number {
    // Keep a dead band: an unreadable square (0.5) must never become a vote.
    const next = value >= 0.56 ? 1 : value <= 0.44 ? -1 : 0;
    if (!next || direction[sq] !== next) { direction[sq] = next; since[sq] = t; return 0; }
    return t - since[sq] >= Math.max(300, this.cfg.settleMs) ? next : 0;
  }

  constructor(public cfg: StabilizerConfig = defaultStabilizerConfig()) {}

  step(b: BoardBelief): BoardBelief {
    const { decay, on, off } = this.cfg;
    const frozen = this.cfg.holdOnHand && b.handOver;
    if (!this.started) { this.lastChange = b.t; this.started = true; }
    if (!frozen && b.cams > 0) {
      for (let sq = 0; sq < 64; sq++) {
        this.accOcc[sq] = clamp(this.accOcc[sq] * decay + logit(b.occ[sq]) * (1 - decay) * 5, -8, 8);
        this.accWhite[sq] = clamp(this.accWhite[sq] * decay + logit(b.white[sq]) * (1 - decay) * 3, -8, 8);
        const wasOcc = this.occ[sq];
        const occVote = this.sustained(b.occ[sq], sq, b.t, this.occDirection, this.occSince);
        if (!this.occ[sq] && (this.accOcc[sq] > on || occVote > 0)) this.occ[sq] = 1;
        else if (this.occ[sq] && (this.accOcc[sq] < off || occVote < 0)) this.occ[sq] = 0;
        const wasWhite = this.white[sq];
        const whiteVote = this.sustained(b.white[sq], sq, b.t, this.whiteDirection, this.whiteSince);
        if (!this.white[sq] && (this.accWhite[sq] > on * 0.5 || whiteVote > 0)) this.white[sq] = 1;
        else if (this.white[sq] && (this.accWhite[sq] < off * 0.5 || whiteVote < 0)) this.white[sq] = 0;
        if (wasOcc !== this.occ[sq] || (this.occ[sq] && wasWhite !== this.white[sq])) this.lastChange = b.t;
      }
    } else if (frozen) {
      this.lastChange = b.t; // a hand resets the quiet timer
    }
    if (frozen || b.cams === 0) {
      this.occDirection.fill(0); this.whiteDirection.fill(0);
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
