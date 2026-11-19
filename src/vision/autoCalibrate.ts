/**
 * Decides when a board reader is so unsure of the board that it should find the corners again by itself.
 *
 * Fed one reading per camera frame. It asks for a calibration when the reading stays very poor for a while: the grid
 * does not sit on the squares, most squares cannot be read, or (before the first move) the start position is never
 * recognised. It never loops: each attempt is followed by a cooldown, there is a cap on attempts, and a dismiss holds
 * it off until the board reads well again.
 */
export interface WatchReading {
  /** Graph time in ms. */
  now: number;
  /** How well the grid sits on the squares, 0..1 (autoAlign's `evaluate().q`). */
  fit: number;
  /** Share of the squares the reader could read, 0..1. */
  quality: number;
  /** The reader sees the pieces in the starting position (or the tracker has synced to it). */
  startSeen: boolean;
  /** A game is under way (a move has been played): the start position is no longer expected. */
  started: boolean;
  /** No hand or motion over the board. A moving picture is never judged. */
  still: boolean;
}

export interface WatchConfig {
  lowFit: number; lowQuality: number;
  /** How long a poor fit or unreadable board must last before calibrating. */
  lowForMs: number;
  /** How long, before the first move, the start position may go unrecognised. */
  startWaitMs: number;
  cooldownMs: number;
  maxAttempts: number;
  /** A board that reads this well counts as recovered (resets the attempts and any dismiss). */
  goodFit: number; goodQuality: number;
}

export const defaultWatchConfig = (): WatchConfig => ({
  lowFit: 0.35, lowQuality: 0.3, lowForMs: 6000, startWaitMs: 15000, cooldownMs: 30000, maxAttempts: 3, goodFit: 0.55, goodQuality: 0.6,
});

export type WatchReason = "fit" | "unreadable" | "no-start";

export class CalibrationWatch {
  cfg: WatchConfig;
  attempts = 0;
  /** Held off by the person until the board reads well again. */
  dismissed = false;
  running = false;
  private lowSince: number | null = null;
  private noStartSince: number | null = null;
  private lastEnd = -Infinity;
  constructor(cfg: Partial<WatchConfig> = {}) { this.cfg = { ...defaultWatchConfig(), ...cfg }; }

  /** The board reads well right now. */
  healthy(r: WatchReading) { return r.fit >= this.cfg.goodFit && r.quality >= this.cfg.goodQuality && (r.started || r.startSeen); }

  /** Feeds one reading. Returns why a calibration should start now, or null. */
  feed(r: WatchReading): WatchReason | null {
    if (this.healthy(r)) { this.lowSince = this.noStartSince = null; this.attempts = 0; this.dismissed = false; return null; }
    if (!r.still) { this.lowSince = this.noStartSince = null; return null; } // a hand or a moving piece: judge the board once it settles
    const poor = r.fit < this.cfg.lowFit || r.quality < this.cfg.lowQuality;
    this.lowSince = poor ? this.lowSince ?? r.now : null;
    const waiting = !r.started && !r.startSeen;
    this.noStartSince = waiting ? this.noStartSince ?? r.now : null;
    if (this.running || this.dismissed || this.attempts >= this.cfg.maxAttempts || r.now - this.lastEnd < this.cfg.cooldownMs) return null;
    let why: WatchReason | null = null;
    if (this.lowSince !== null && r.now - this.lowSince >= this.cfg.lowForMs) why = r.fit < this.cfg.lowFit ? "fit" : "unreadable";
    else if (this.noStartSince !== null && r.now - this.noStartSince >= this.cfg.startWaitMs) why = "no-start";
    if (why) { this.running = true; this.attempts++; }
    return why;
  }

  /** A calibration finished, failed or was stopped: start the cooldown and judge the board afresh. */
  ended(now: number) { this.running = false; this.lastEnd = now; this.lowSince = this.noStartSince = null; }

  /** The person closed the window: stop asking until the board reads well. */
  dismiss(now: number) { this.dismissed = true; this.ended(now); }
}

/** What the "Calibration in progress..." window shows. Published on the bus by the reader that is calibrating. */
export interface CalibrationView {
  cam: string;
  phase: "running" | "done" | "failed";
  /** What the search is doing, or how it ended. */
  label: string;
  progress: number;
  /** Graph time after which a finished result stops showing. */
  hideAt?: number;
}
