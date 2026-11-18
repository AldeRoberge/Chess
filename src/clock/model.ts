import { confOf, type ClockEstimate, type Side, type SideClock, type TimeControl } from "./types";

/** "10+5" fischer, "5|3" or "5d3" delay, "3+2b" bronstein, "90/40+30" (first period + increment), "10" sudden death, "" none. */
export function parseControl(s: string): TimeControl {
  const t = s.trim().toLowerCase().replace(/\s+/g, "");
  if (!t || t === "none") return { baseMs: 0, incMs: 0, delayMs: 0, mode: "none" };
  const m = /^(\d+(?:\.\d+)?)(?:\/\d+)?(?:([+|d])(\d+(?:\.\d+)?)(b?))?$/.exec(t);
  if (!m) return { baseMs: 0, incMs: 0, delayMs: 0, mode: "none" };
  const baseMs = Number(m[1]) * 60000, secs = m[3] ? Number(m[3]) * 1000 : 0;
  if (!m[2] || !secs) return { baseMs, incMs: 0, delayMs: 0, mode: "fischer" };
  if (m[2] === "+") return { baseMs, incMs: secs, delayMs: 0, mode: m[4] ? "bronstein" : "fischer" };
  return { baseMs, incMs: 0, delayMs: secs, mode: "delay" };
}

/** Model tuning. Sigma is a standard deviation in ms. */
export interface ClockTuning {
  /** Extra sigma per second of real time for the running side (our clock vs the physical clock). */
  drift: number;
  /** Extra sigma when a move press is only inferred from the board. */
  pressSigma: number;
  /** Baseline sigma of a reading (the digit display itself rounds to a second). */
  readSigma: number;
}
export const DEFAULT_TUNING: ClockTuning = { drift: 150, pressSigma: 400, readSigma: 500 };

export interface Reading { ms: number; conf: number; sigmaMs?: number }

/**
 * Estimates both clocks. It runs on real-world time (the timestamps it is given, never tick counts) and is corrected by camera readings
 * whenever there are any, so certainty falls while nothing is read and recovers when a reading agrees.
 */
export class ClockModel {
  ms: [number, number] = [0, 0];
  sigma: [number, number] = [0, 0];
  running: Side | null = null;
  lastRead: number | null = null;
  flagged: Side | null = null;
  private src: ["read" | "model" | "fused", "read" | "model" | "fused"] = ["model", "model"];
  private t = 0;
  private turnStart = 0;
  private lastReadMs: [number | null, number | null] = [null, null];
  private outliers: [number, number] = [0, 0];
  private evidence = 0;
  tune: ClockTuning = { ...DEFAULT_TUNING };

  constructor(public control: TimeControl = parseControl("10+0")) {}

  private idx = (s: Side) => (s === "w" ? 0 : 1);
  private other = (s: Side): Side => (s === "w" ? "b" : "w");

  reset(now: number, control = this.control) {
    this.control = control;
    this.ms = [control.baseMs, control.baseMs];
    this.sigma = [0, 0];
    this.running = null; this.lastRead = null; this.flagged = null; this.src = ["model", "model"];
    this.t = now; this.turnStart = now; this.lastReadMs = [null, null]; this.outliers = [0, 0]; this.evidence = 0;
  }

  /** Move real time forward: only the running side's clock counts down, and only it becomes less certain. */
  advance(now: number) {
    const dt = Math.max(0, now - this.t);
    this.t = now;
    if (!this.running || dt === 0) return;
    const i = this.idx(this.running);
    const spentBefore = Math.max(0, this.t - dt - this.turnStart), spentNow = spentBefore + dt;
    const dl = this.control.mode === "delay" ? this.control.delayMs : 0;
    const d = Math.max(0, spentNow - dl) - Math.max(0, spentBefore - dl); // a delay holds the clock for the first seconds of a turn
    this.ms[i] -= d;
    this.sigma[i] = Math.hypot(this.sigma[i], (this.tune.drift * dt) / 1000);
    if (this.ms[i] <= 0 && !this.flagged && confOf(this.sigma[i]) >= 0.5) this.flagged = this.running;
    if (this.ms[i] < 0) this.ms[i] = 0;
  }

  /** Game started: the side to move starts burning time. */
  start(now: number, side: Side = "w") {
    this.advance(now);
    this.running = side; this.turnStart = now;
  }

  /** `mover` just completed a move (seen on the board): their clock stops, the increment is paid, the opponent's starts. */
  press(mover: Side, now: number) {
    this.advance(now);
    if (!this.running) { // first move seen before the clock was started: the mover's thinking time before it is unknown
      this.sigma[this.idx(mover)] = Math.hypot(this.sigma[this.idx(mover)], 3000);
    } else if (this.running !== mover) this.sigma[this.idx(mover)] = Math.hypot(this.sigma[this.idx(mover)], 1500); // we missed a press: widen both
    const i = this.idx(mover), spent = now - this.turnStart;
    if (this.control.mode === "fischer") this.ms[i] += this.control.incMs;
    else if (this.control.mode === "bronstein") this.ms[i] += Math.min(this.control.incMs, Math.max(0, spent));
    this.sigma[i] = Math.hypot(this.sigma[i], this.tune.pressSigma);
    this.running = this.other(mover); this.turnStart = now; this.evidence = 0;
  }

  /** The camera read `side`'s display. Kalman update, gated by plausibility. Returns whether it was accepted. */
  observe(side: Side, r: Reading, now: number): boolean {
    this.advance(now);
    const i = this.idx(side), prev = this.lastReadMs[i];
    this.lastReadMs[i] = r.ms;
    // which side is burning time, from the displays themselves: two consecutive decreases on the non-running side flip it
    if (prev !== null && r.ms < prev - 400 && r.conf >= 0.5 && this.running !== side) {
      if (++this.evidence >= 2) { this.running = side; this.turnStart = now; this.evidence = 0; }
    } else if (this.running === side) this.evidence = 0;
    const Rs = (r.sigmaMs ?? this.tune.readSigma) + (1 - Math.min(1, Math.max(0, r.conf))) * 8000;
    const P = this.sigma[i] ** 2 || 1, R = Rs ** 2;
    const gate = 3 * Math.sqrt(P + R) + this.control.incMs + 1000;
    const hasPrior = this.lastRead !== null || this.sigma[i] > 0 || this.running !== null;
    if (hasPrior && Math.abs(r.ms - this.ms[i]) > gate) {
      if (++this.outliers[i] < 3) return false; // one-off glitch: ignore; three in a row means the model was wrong, so adopt the reading
      this.ms[i] = r.ms; this.sigma[i] = Rs; this.outliers[i] = 0; this.src[i] = "read"; this.lastRead = now; return true;
    }
    this.outliers[i] = 0;
    const K = hasPrior ? P / (P + R) : 1;
    this.ms[i] += K * (r.ms - this.ms[i]);
    this.sigma[i] = Math.sqrt((1 - K) * P + (K === 1 ? R : 0)) || Rs;
    this.src[i] = K > 0.8 ? "read" : "fused";
    this.lastRead = now;
    if (this.flagged === side && this.ms[i] > 1000) this.flagged = null;
    return true;
  }

  private side(i: 0 | 1): SideClock {
    return { ms: Math.round(this.ms[i]), sigmaMs: Math.round(this.sigma[i]), conf: Number(confOf(this.sigma[i]).toFixed(3)), src: this.src[i] };
  }

  estimate(now: number): ClockEstimate {
    this.advance(now);
    return { t: now, white: this.side(0), black: this.side(1), running: this.running, control: this.control, flagged: this.flagged, lastRead: this.lastRead };
  }
}
