import { describe, expect, it } from "vitest";
import { CalibrationWatch, type WatchReading } from "./autoCalibrate";

const bad = (now: number, o: Partial<WatchReading> = {}): WatchReading => ({ now, fit: 0.1, quality: 0.9, startSeen: false, started: false, still: true, ...o });
const good = (now: number): WatchReading => ({ now, fit: 0.9, quality: 0.95, startSeen: true, started: false, still: true });

describe("CalibrationWatch", () => {
  it("asks for a calibration only once a poor fit has lasted, and not twice while one runs", () => {
    const w = new CalibrationWatch();
    expect(w.feed(bad(0))).toBeNull();
    expect(w.feed(bad(5000))).toBeNull();
    expect(w.feed(bad(6000))).toBe("fit");
    expect(w.running).toBe(true);
    expect(w.feed(bad(9000))).toBeNull();
  });
  it("says the board is unreadable when the fit is fine but the squares cannot be read", () => {
    const w = new CalibrationWatch();
    w.feed(bad(0, { fit: 0.6, quality: 0.1, startSeen: true }));
    expect(w.feed(bad(6000, { fit: 0.6, quality: 0.1, startSeen: true }))).toBe("unreadable");
  });
  it("waits longer for a start position that never shows, and not at all once a game is under way", () => {
    const w = new CalibrationWatch(), r = (now: number) => bad(now, { fit: 0.5, quality: 0.8 });
    expect(w.feed(r(0))).toBeNull();
    expect(w.feed(r(14000))).toBeNull();
    expect(w.feed(r(15000))).toBe("no-start");
    const g = new CalibrationWatch();
    g.feed(bad(0, { fit: 0.5, started: true }));
    expect(g.feed(bad(60000, { fit: 0.5, started: true }))).toBeNull();
  });
  it("never judges a moving picture", () => {
    const w = new CalibrationWatch();
    w.feed(bad(0));
    expect(w.feed(bad(7000, { still: false }))).toBeNull();
    expect(w.feed(bad(8000))).toBeNull(); // the clock restarted
    expect(w.feed(bad(14000))).toBe("fit");
  });
  it("cools down between tries, stops after three, and starts over once the board reads well", () => {
    const w = new CalibrationWatch();
    let t = 0;
    const attempt = () => { for (let i = 0; i < 200; i++, t += 1000) { const why = w.feed(bad(t)); if (why) { w.ended(t); return true; } } return false; };
    expect(attempt()).toBe(true);
    const first = t;
    expect(attempt()).toBe(true);
    expect(t - first).toBeGreaterThanOrEqual(30000);
    expect(attempt()).toBe(true);
    expect(attempt()).toBe(false);
    expect(w.attempts).toBe(3);
    w.feed(good(t));
    expect(w.attempts).toBe(0);
    expect(attempt()).toBe(true);
  });
  it("holds off after a dismiss until the board reads well", () => {
    const w = new CalibrationWatch({ cooldownMs: 0 });
    w.feed(bad(0)); expect(w.feed(bad(6000))).toBe("fit");
    w.dismiss(6000);
    expect(w.running).toBe(false);
    expect(w.feed(bad(60000))).toBeNull();
    w.feed(good(61000));
    expect(w.dismissed).toBe(false);
    w.feed(bad(62000)); expect(w.feed(bad(68000))).toBe("fit");
  });
});
