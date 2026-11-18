import { describe, expect, it } from "vitest";
import { bus } from "../core/bus";
import { cueFor } from "../plugins/fx";
import { node } from "../test/helpers";
import { EFFECTS } from "./effects";
import { FxEngine, fxEngine } from "./engine";
import { FxAudio, SOUND_IDS } from "./sounds";
import type { FxCall, FxCue } from "./types";

const ev = (type: string, data: Record<string, unknown>) => ({ type, t: 1, data: { from: "d4", color: "w", ply: 3, ...data } });
const cue = (o: Partial<FxCue> = {}): FxCue => ({ id: 1, kind: "capture", col: 4.5, row: 3.5, piece: "p", captured: "q", gap: 8, strength: 1, side: "w", ...o });

describe("cueFor", () => {
  it("fires for a capture of higher value and places it on the captured square", () => {
    const c = cueFor(ev("capture", { to: "e5", piece: "p", captured: "q" }), "higher", 1, 7)!;
    expect(c).toMatchObject({ id: 7, col: 4.5, row: 3.5, gap: 8, strength: 1 });
  });
  it("ignores equal and lower trades unless any capture is wanted", () => {
    expect(cueFor(ev("capture", { to: "e5", piece: "n", captured: "b" }), "higher", 1, 1)).toBeNull();
    expect(cueFor(ev("capture", { to: "e5", piece: "q", captured: "p" }), "higher", 1, 1)).toBeNull();
    expect(cueFor(ev("capture", { to: "e5", piece: "q", captured: "p" }), "capture", 1, 1)).not.toBeNull();
  });
  it("honours the minimum value won", () => {
    const e = ev("capture", { to: "e5", piece: "r", captured: "q" }); // wins 4
    expect(cueFor(e, "higher", 4, 1)).not.toBeNull();
    expect(cueFor(e, "higher", 5, 1)).toBeNull();
  });
  it("scales strength with the prize and handles other event types", () => {
    const small = cueFor(ev("capture", { to: "e5", piece: "n", captured: "r" }), "higher", 1, 1)!, big = cueFor(ev("capture", { to: "e5", piece: "p", captured: "q" }), "higher", 1, 1)!;
    expect(big.strength).toBeGreaterThan(small.strength);
    expect(cueFor(ev("mate", { to: "h7", piece: "q" }), "mate", 1, 1)?.strength).toBe(1);
    expect(cueFor(ev("check", { to: "h7", piece: "q" }), "mate", 1, 1)).toBeNull();
    expect(cueFor(ev("capture", {}), "higher", 1, 1)).toBeNull(); // no square
  });
});

describe("effects", () => {
  const call = (id: string, o: Partial<FxCall> = {}): FxCall => ({ kind: "visual", id, cue: cue(), delay: 0, opts: { color: "auto", reach: 6, intensity: 0.9, speed: 1, count: 4 }, ...o });
  it("every effect paints through its whole life without throwing", () => {
    const ctx = document.createElement("canvas").getContext("2d")!;
    for (const id of Object.keys(EFFECTS)) {
      const eng = new FxEngine(); eng.spawn(call(id), 0);
      for (const t of [0, 100, 400, 900, 1500, 2100]) eng.draw(ctx, 48, t);
    }
  });
  it("expires finished effects and waits out the delay", () => {
    const eng = new FxEngine(); eng.spawn(call("ripple", { delay: 1 }), 0);
    expect(eng.active(500)).toBe(true); expect(eng.level(500)).toBe(0); // still waiting
    expect(eng.level(1300)).toBeGreaterThan(0);
    eng.draw(document.createElement("canvas").getContext("2d")!, 48, 60000);
    expect(eng.items).toHaveLength(0); expect(eng.active(60000)).toBe(false);
  });
  it("ignores sound calls and unknown effects, and caps how many run at once", () => {
    const eng = new FxEngine(); eng.spawn(call("ripple", { kind: "sound" }), 0); eng.spawn(call("nope"), 0);
    expect(eng.items).toHaveLength(0);
    for (let i = 0; i < 50; i++) eng.spawn(call("sparks"), 0);
    expect(eng.items.length).toBeLessThanOrEqual(24);
  });
});

describe("sounds", () => {
  it("records plays and tolerates a missing audio context", () => {
    const a = new FxAudio(); a.start();
    for (const id of SOUND_IDS) a.play(id, { volume: 0.5, strength: 0.8 });
    a.play("unknown");
    expect(a.played.length).toBeGreaterThan(0);
  });
});

describe("board fx nodes", () => {
  it("trigger -> effect -> sound -> projector chain spawns visuals once and plays the sound", () => {
    fxEngine.clear(); bus.fxSpawns.length = 0;
    const trig = node("fx.trigger"), ripple = node("fx.effect", { effect: "ripple" }), spark = node("fx.effect", { effect: "sparks", color: "gold" }), snd = node("fx.sound", { sound: "chime" }), out = node("fx.output");
    const events = [ev("capture", { to: "e5", piece: "p", captured: "q" })];
    const cues = trig.run({ events }, 1000)!.cues as FxCue[];
    expect(cues).toHaveLength(1);
    expect(trig.run({ events }, 1066)!.cues).toHaveLength(0); // the same event arriving again is not a second cue
    const a = ripple.run({ cues }, 1000)!.calls as FxCall[], b = spark.run({ cues, chain: a }, 1000)!.calls as FxCall[], c = snd.run({ cues, chain: b }, 1000)!.calls as FxCall[];
    expect(c.map((x) => x.id)).toEqual(["ripple", "sparks", "chime"]);
    expect(b[1].opts.color).toBe("gold");
    out.run({ calls: c }, 1000);
    expect(fxEngine.items).toHaveLength(2); expect(bus.fxSpawns).toHaveLength(2);
    expect((out.state as { audio: FxAudio }).audio.played).toEqual(["chime"]);
    fxEngine.clear(); bus.fxSpawns.length = 0;
  });
  it("bigger captures reach further when scaling is on, and the test action fires a cue", () => {
    const eff = node("fx.effect", { size: 6 });
    const small = (eff.run({ cues: [cue({ strength: 0.2 })] })!.calls as FxCall[])[0], big = (eff.run({ cues: [cue({ strength: 1 })] })!.calls as FxCall[])[0];
    expect(Number(big.opts.reach)).toBeGreaterThan(Number(small.opts.reach));
    const trig = node("fx.trigger", { test: true });
    expect(trig.run({}, 0)!.cues).toHaveLength(1); expect(trig.params.test).toBe(false);
  });
  it("projector can be switched off, and the previews paint", () => {
    fxEngine.clear(); bus.fxSpawns.length = 0;
    const out = node("fx.output", { project: false });
    out.run({ calls: [{ kind: "visual", id: "ripple", cue: cue(), delay: 0, opts: {} }] }, 0);
    expect(fxEngine.items).toHaveLength(0);
    out.paint(); const eff = node("fx.effect", { effect: "lasers" }); eff.run({}, 0); eff.paint(); eff.paint();
  });
});
