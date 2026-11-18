import { describe, expect, it } from "vitest";
import { ClockModel, parseControl } from "./model";
import { confOf, fmtClock } from "./types";

const model = (c = "10+5") => { const m = new ClockModel(parseControl(c)); m.reset(0); return m; };

describe("parseControl", () => {
  it("reads the common notations", () => {
    expect(parseControl("10+5")).toEqual({ baseMs: 600000, incMs: 5000, delayMs: 0, mode: "fischer" });
    expect(parseControl("5|3")).toEqual({ baseMs: 300000, incMs: 0, delayMs: 3000, mode: "delay" });
    expect(parseControl("3+2b").mode).toBe("bronstein");
    expect(parseControl("90/40+30")).toMatchObject({ baseMs: 5400000, incMs: 30000 });
    expect(parseControl("10").incMs).toBe(0);
    expect(parseControl("nonsense").mode).toBe("none");
  });
});

describe("ClockModel", () => {
  it("counts down the running side with real time and gets less certain", () => {
    const m = model("10+0"); m.start(0, "w");
    const a = m.estimate(1000), b = m.estimate(31000);
    expect(b.white.ms).toBe(569000); expect(b.black.ms).toBe(600000);
    expect(b.white.sigmaMs).toBeGreaterThan(a.white.sigmaMs); expect(b.white.conf).toBeLessThan(a.white.conf);
    expect(b.black.conf).toBe(1); // the idle clock is frozen, so it stays certain
  });

  it("does not depend on tick rate: one big step equals many small ones", () => {
    const a = model(), b = model(); a.start(0); b.start(0);
    for (let t = 100; t <= 20000; t += 100) b.advance(t);
    expect(a.estimate(20000).white.ms).toBe(b.estimate(20000).white.ms);
  });

  it("pays a fischer increment and swaps the running side on a press", () => {
    const m = model("10+5"); m.start(0);
    m.press("w", 10000);
    const e = m.estimate(10000);
    expect(e.running).toBe("b"); expect(e.white.ms).toBe(600000 - 10000 + 5000);
  });

  it("bronstein only gives back what was spent, and a delay holds the clock", () => {
    const br = model("3+5b"); br.start(0); br.press("w", 2000);
    expect(br.estimate(2000).white.ms).toBe(180000); // spent 2 s, gets 2 s back
    const d = model("5|3"); d.start(0);
    expect(d.estimate(2500).white.ms).toBe(300000); // still inside the 3 s delay
    expect(d.estimate(5000).white.ms).toBe(298000);
  });

  it("a camera reading pulls the estimate and restores certainty", () => {
    const m = model("10+0"); m.start(0);
    const before = m.estimate(60000);
    expect(m.observe("w", { ms: 535000, conf: 0.95 }, 60000)).toBe(true);
    const after = m.estimate(60000);
    expect(after.white.ms).toBeGreaterThan(530000); expect(after.white.ms).toBeLessThan(541000);
    expect(after.white.conf).toBeGreaterThan(before.white.conf); expect(after.lastRead).toBe(60000);
  });

  it("ignores a lone implausible reading but adopts a consistent run of them", () => {
    const m = model("10+0"); m.start(0);
    m.observe("w", { ms: 599000, conf: 0.95 }, 1000);
    expect(m.observe("w", { ms: 120000, conf: 0.9 }, 2000)).toBe(false);
    expect(m.estimate(2000).white.ms).toBeGreaterThan(590000);
    m.observe("w", { ms: 119000, conf: 0.9 }, 3000);
    expect(m.observe("w", { ms: 118000, conf: 0.9 }, 4000)).toBe(true);
    expect(m.estimate(4000).white.ms).toBeLessThan(121000);
  });

  it("a low-confidence reading counts for little", () => {
    const hi = model(), lo = model(); hi.start(0); lo.start(0);
    hi.estimate(30000); lo.estimate(30000);
    hi.observe("w", { ms: 560000, conf: 0.95 }, 30000); lo.observe("w", { ms: 560000, conf: 0.2 }, 30000);
    expect(Math.abs(hi.estimate(30000).white.ms - 560000)).toBeLessThan(Math.abs(lo.estimate(30000).white.ms - 560000));
  });

  it("works out who is running from the displays when no moves are seen", () => {
    const m = model("10+0"); m.reset(0);
    m.observe("b", { ms: 600000, conf: 0.95 }, 0); m.observe("b", { ms: 598000, conf: 0.95 }, 2000); m.observe("b", { ms: 596000, conf: 0.95 }, 4000);
    expect(m.running).toBe("b");
  });

  it("flags only once the flag fall is believed", () => {
    const m = model("0.05+0"); m.start(0); // 3 s
    expect(m.estimate(1000).flagged).toBeNull();
    expect(m.estimate(4000).white.ms).toBe(0);
    expect(m.estimate(4000).flagged).toBe("w");
  });
});

describe("helpers", () => {
  it("certainty falls with sigma and times format", () => {
    expect(confOf(0)).toBe(1); expect(confOf(2000)).toBeCloseTo(0.5); expect(confOf(10000)).toBeLessThan(0.05);
    expect(fmtClock(65000)).toBe("1:05"); expect(fmtClock(3725000)).toBe("1:02:05"); expect(fmtClock(4500, true)).toBe("0:04.5");
  });
});
