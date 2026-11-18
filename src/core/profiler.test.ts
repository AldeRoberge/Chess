import { beforeEach, describe, expect, it } from "vitest";
import { aggregateBoxes, delta, frameBoxes, panView, percentile, Profiler, slowestFrame, toTrace, zoomView, MIN_VIEW, type FrameRecord } from "./profiler";

const frame = (spans: [string, number, number, number][]): FrameRecord => ({ at: 0, dur: 10, spans: spans.map(([name, depth, t0, dur]) => ({ name, depth, t0, dur })) });

describe("profiler", () => {
  let p: Profiler;
  beforeEach(() => { p = new Profiler(); });

  it("records nothing while disabled, nests spans while enabled", () => {
    p.beginFrame(); p.span("a", () => 1); p.endFrame();
    expect(p.frames).toHaveLength(0);
    p.enabled = true;
    p.beginFrame();
    p.span("outer", () => { p.span("inner", () => 0); });
    p.endFrame();
    const s = p.frames[0].spans;
    expect(s.map((x) => [x.name, x.depth])).toEqual([["outer", 0], ["inner", 1]]);
    expect(s[0].dur).toBeGreaterThanOrEqual(s[1].dur);
  });

  it("closes spans left open and keeps a bounded history", () => {
    p.enabled = true;
    for (let i = 0; i < p.maxFrames + 5; i++) { p.beginFrame(); p.begin("open"); p.endFrame(); }
    expect(p.frames).toHaveLength(p.maxFrames);
    expect(p.frames[0].spans[0].dur).toBeGreaterThanOrEqual(0);
  });

  it("does not record while paused", () => {
    p.enabled = true; p.paused = true;
    p.beginFrame(); p.span("x", () => 0); p.endFrame();
    expect(p.frames).toHaveLength(0);
  });

  it("summarises per-node samples over a rolling window", () => {
    for (let i = 1; i <= 200; i++) p.recordNode("n", i % 10);
    expect(p.series("n")).toHaveLength(120);
    const s = p.summarize("n")!;
    expect(s.max).toBe(9);
    expect(s.avg).toBeGreaterThan(4); expect(s.avg).toBeLessThan(5);
    p.forgetNode("n");
    expect(p.summarize("n")).toBeNull();
  });
});

describe("flame layout", () => {
  it("computes self time as duration minus direct children", () => {
    const b = frameBoxes(frame([["tick", 0, 0, 6], ["A", 1, 0, 4], ["a1", 2, 0, 1], ["B", 1, 4, 1]]));
    const self = Object.fromEntries(b.map((x) => [x.name, x.self]));
    expect(self).toEqual({ tick: 1, A: 3, a1: 1, B: 1 });
    expect(b[2].path).toBe("tick/A/a1");
  });

  it("merges same-named siblings across frames and sorts wide first", () => {
    const agg = aggregateBoxes([
      frame([["tick", 0, 0, 5], ["A", 1, 0, 1], ["B", 1, 1, 3]]),
      frame([["tick", 0, 0, 5], ["A", 1, 0, 2], ["B", 1, 2, 1]]),
    ]);
    const by = Object.fromEntries(agg.map((x) => [x.name, x]));
    expect(by.tick.w).toBe(10); expect(by.tick.calls).toBe(2);
    expect(by.A.w).toBe(3); expect(by.B.w).toBe(4);
    expect(by.B.x).toBe(0); expect(by.A.x).toBe(4);
  });

  it("zooms around the anchor and keeps the view inside the graph", () => {
    const v = zoomView({ a: 0, w: 1 }, 0.5, 0.5);
    expect(v.w).toBeCloseTo(0.5); expect(v.a).toBeCloseTo(0.25);
    // the point under the cursor stays put
    const z = zoomView({ a: 0.2, w: 0.4 }, 0.5, 0.25);
    expect(0.2 + 0.25 * 0.4).toBeCloseTo(z.a + 0.25 * z.w);
    // zooming out never exceeds the whole graph, and zooming in stops at the minimum width
    expect(zoomView({ a: 0.5, w: 0.5 }, 10, 0.5)).toEqual({ a: 0, w: 1 });
    expect(zoomView({ a: 0, w: 1 }, 1e-12, 0.5).w).toBe(MIN_VIEW);
    // anchored at the left edge the window never goes below zero
    expect(zoomView({ a: 0, w: 1 }, 0.5, 0).a).toBe(0);
  });

  it("pans by a fraction of the visible width and clamps at both ends", () => {
    expect(panView({ a: 0.25, w: 0.5 }, 0.5)).toEqual({ a: 0.5, w: 0.5 });
    expect(panView({ a: 0.25, w: 0.5 }, 1).a).toBe(0.5);
    expect(panView({ a: 0.25, w: 0.5 }, -1).a).toBe(0);
  });

  it("interpolates percentiles", () => {
    expect(percentile([], 0.5)).toBe(0);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([10], 0.95)).toBe(10);
  });
});

describe("capture helpers", () => {
  const f = (at: number, dur: number): FrameRecord => ({ at, dur, spans: [{ name: "s", depth: 0, t0: 1, dur: 2, node: "n1" }] });
  it("finds the slowest frame", () => { expect(slowestFrame([])).toBe(-1); expect(slowestFrame([f(0, 3), f(1, 9), f(2, 4)])).toBe(1); });
  it("exports microsecond trace events with node args", () => {
    const t = toTrace([f(10, 5)]).traceEvents;
    expect(t[0]).toMatchObject({ name: "frame", ts: 10000, dur: 5000 });
    expect(t[1]).toMatchObject({ name: "s", ts: 11000, dur: 2000, args: { node: "n1" } });
  });
});

describe("baseline delta", () => {
  it("reports signed ms and percent, and no percent from a zero baseline", () => {
    expect(delta(2, 3)).toEqual({ ms: 1, pct: 50 });
    expect(delta(4, 1).pct).toBe(-75);
    expect(delta(0, 1).pct).toBeNull();
  });
});
