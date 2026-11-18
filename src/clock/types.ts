/** Chess-clock data that travels on `clock` ports. Plain data only (structured-clone safe: it is posted to the projector window). */
export type Side = "w" | "b";

export interface SideClock {
  /** Best estimate of time left, ms. */
  ms: number;
  /** One standard deviation of that estimate, ms. */
  sigmaMs: number;
  /** 0..1 certainty derived from sigma: act on `ms` only when this is high enough. */
  conf: number;
  /** read = straight from the camera, model = predicted from real-world time, fused = both. */
  src: "read" | "model" | "fused";
}

export interface TimeControl {
  baseMs: number;
  incMs: number;
  delayMs: number;
  mode: "fischer" | "bronstein" | "delay" | "none";
}

export interface ClockEstimate {
  t: number;
  white: SideClock;
  black: SideClock;
  running: Side | null;
  control: TimeControl;
  /** Side whose flag has (probably) fallen. */
  flagged: Side | null;
  /** Graph time of the last accepted camera reading, or null if none yet. */
  lastRead: number | null;
}

/** sigma 2 s -> 0.5, 0.5 s -> 0.94, 10 s -> 0.04. */
export const confOf = (sigmaMs: number) => 1 / (1 + (sigmaMs / 2000) ** 2);

export const fmtClock = (ms: number, withTenths = false) => {
  const s = Math.max(0, ms) / 1000, h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = Math.floor(s % 60);
  const mm = String(m).padStart(h ? 2 : 1, "0"), ss = String(r).padStart(2, "0");
  return `${h ? h + ":" : ""}${mm}:${ss}${withTenths && s < 20 ? "." + Math.floor((s % 1) * 10) : ""}`;
};
