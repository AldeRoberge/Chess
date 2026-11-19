import { beforeEach, describe, expect, it } from "vitest";
import { bus } from "../core/bus";
import { Narrator } from "../narrator/narrator";
import { CueEngine } from "../scene/cues";
import { blank, paintLcd, rectQuad } from "../test/clockPaint";
import { node } from "../test/helpers";
import { fmtCorners } from "./shared";
import { drawClockOverlay } from "../world/clockOverlay";
import type { ClockEstimate } from "../clock/types";

const Wbox = { x: 20, y: 20, w: 130, h: 44 }, Bbox = { x: 170, y: 20, w: 130, h: 44 };
const frame = (w: string, b: string, t: number) => { const f = blank(320, 100); paintLcd(f, Wbox, w); paintLcd(f, Bbox, b); f.t = t; return f; };
beforeEach(() => { bus.clock = null; bus.clockView = null; bus.events.length = 0; });

describe("clock.reader", () => {
  it("offers the usual time-control presets", () => {
    const p = node("clock.reader").spec.params!.find((x) => x.id === "control");
    if (!p || p.kind !== "select") throw new Error("control");
    expect(p.options).toEqual(expect.arrayContaining(["1+0", "3+2", "5+0", "10+0", "15+10"]));
  });
  it("estimates from real time and the moves when nothing is read, and its certainty falls", () => {
    const n = node("clock.reader", { control: "10+0" });
    n.run({ game: { ply: 1 } }, 0);
    const a = n.run({ game: { ply: 1 } }, 1000)!.clock as ClockEstimate, b = n.run({ game: { ply: 1 } }, 31000)!.clock as ClockEstimate;
    expect(a.running).toBe("b"); expect(b.black.ms).toBeLessThan(a.black.ms - 29000);
    expect(b.black.conf).toBeLessThan(a.black.conf); expect(b.white.conf).toBeGreaterThan(b.black.conf);
    expect(n.h.fidelity).toBeCloseTo(Math.min(b.white.conf, b.black.conf)); expect(bus.clock).toBe(b);
  });

  it("reads both displays from the camera, corrects the estimate and restores certainty", () => {
    const n = node("clock.reader", { kind: "lcd", control: "10+0", whiteBox: fmtCorners(rectQuad(Wbox)), blackBox: fmtCorners(rectQuad(Bbox)) });
    n.run({ game: { ply: 1 } }, 0);
    const before = n.run({ game: { ply: 1 } }, 60000)!.clock as ClockEstimate;
    const out = n.run({ frame: frame("9:58", "8:41", 1), game: { ply: 1 } }, 60001)!.clock as ClockEstimate;
    expect(out.white.ms).toBeGreaterThan(597000); expect(out.white.ms).toBeLessThan(599500);
    expect(out.black.ms).toBeGreaterThan(520000); expect(out.black.ms).toBeLessThan(542000);
    expect(out.black.conf).toBeGreaterThan(before.black.conf); expect(out.lastRead).toBe(60001);
  });

  it("raises low-time and flag events only when the estimate is certain enough, once each", () => {
    const n = node("clock.reader", { control: "1+0", lowSec: 30, critSec: 10, minConf: 0.5 });
    const types: string[] = [];
    for (let t = 0; t <= 70000; t += 1000) for (const e of (n.run({ game: { ply: 0 } }, t)!.events as any[])) types.push(e.type);
    // with no moves there is no running clock, so nothing falls
    expect(types).toEqual([]);
    n.params.start = true;
    for (let t = 71000; t <= 135000; t += 1000) for (const e of (n.run({ game: { ply: 0 } }, t)!.events as any[])) types.push(e.type);
    expect(types.filter((x) => x === "clock-low")).toHaveLength(1);
    expect(types.filter((x) => x === "clock-critical")).toHaveLength(1);
  });

  it("restarts when the game is rewound, and says when the camera has lost the display", () => {
    const n = node("clock.reader", { kind: "lcd", control: "10+0", whiteBox: fmtCorners(rectQuad(Wbox)), blackBox: fmtCorners(rectQuad(Bbox)) });
    n.run({ frame: frame("9:58", "10:00", 1), game: { ply: 1 } }, 1000);
    const lost = [] as string[];
    for (let t = 2000; t < 40000; t += 1000) for (const e of (n.run({ frame: blank(320, 100), game: { ply: 1 } }, t)!.events as any[])) lost.push(e.type);
    expect(lost).toContain("clock-lost");
    const r = n.run({ game: { ply: 0 } }, 41000)!.clock as ClockEstimate;
    expect(r.white.ms).toBe(600000);
  });
});

describe("clock.overlay", () => {
  const est = (conf: number): ClockEstimate => ({ t: 0, white: { ms: 125000, sigmaMs: 100, conf, src: "read" }, black: { ms: 40000, sigmaMs: 100, conf, src: "model" }, running: "w", control: { baseMs: 600000, incMs: 0, delayMs: 0, mode: "fischer" }, flagged: null, lastRead: 0 });
  it("publishes what to project, and nothing when off or unwired", () => {
    const n = node("clock.overlay", { mode: "circle" });
    n.run({ clock: est(0.9) }); expect(bus.clockView?.mode).toBe("circle");
    n.params.mode = "off"; n.run({ clock: est(0.9) }); expect(bus.clockView).toBeNull();
    n.params.mode = "square"; n.run({}); expect(bus.clockView).toBeNull();
  });

  const draw = (mode: "digits" | "circle" | "square", conf: number) => {
    const c = document.createElement("canvas"); c.width = 700; c.height = 700; const ctx = c.getContext("2d")!;
    const text: string[] = [], dashes: number[][] = [];
    const ft = ctx.fillText.bind(ctx); ctx.fillText = ((t: string, x: number, y: number) => { text.push(t); return ft(t, x, y); }) as any;
    const sd = ctx.setLineDash.bind(ctx); ctx.setLineDash = ((d: number[]) => { dashes.push(d); return sd(d); }) as any;
    const arcs: number[] = [], ar = ctx.arc.bind(ctx); ctx.arc = ((...a: any[]) => { arcs.push(a[4]); return (ar as any)(...a); }) as any;
    drawClockOverlay(ctx, 48, { mode, showCert: true, clock: est(conf) }, 0);
    return { text, dashes, arcs };
  };
  it("shows digits, and hedges them when unsure", () => {
    expect(draw("digits", 0.95).text).toContain("2:05");
    const unsure = draw("digits", 0.5).text; expect(unsure).toContain("~2:05"); expect(unsure.some((t) => t.includes("%"))).toBe(true);
    expect(draw("digits", 0.2).text).toContain("?2:05");
  });
  it("draws a depleting ring for the circle and a dashed line only for uncertain values", () => {
    expect(draw("circle", 0.95).arcs.length).toBeGreaterThan(0);
    expect(draw("square", 0.95).dashes.every((d) => d.length === 0)).toBe(true);
    expect(draw("square", 0.5).dashes.some((d) => d.length > 0)).toBe(true);
  });
});

describe("clock events downstream", () => {
  it("narrator speaks exact times when certain, rounds when unsure, and gives no number for a guess", () => {
    const say = (conf: number, ms = 42000) => new Narrator().handle([{ type: "clock-critical", t: 1, data: { side: "w", ms, conf } }]).map((l) => l.text).join(" ");
    expect(say(0.95)).toContain("42 secondes"); expect(say(0.5)).toMatch(/moins de|environ/); expect(say(0.5)).not.toContain("42");
    expect(say(0.2)).not.toMatch(/\d/);
    expect(new Narrator().handle([{ type: "clock-flag", t: 1, data: { side: "b", ms: 0, conf: 0.9 } }])[0].priority).toBe(3);
  });
  it("scene cues react to a low clock", () => {
    const c = new CueEngine(); c.fire([{ type: "clock-flag", t: 0, data: { side: "w", conf: 0.9 } }], 0);
    expect(c.tick(0).length).toBeGreaterThan(0);
  });
});
