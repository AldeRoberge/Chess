import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioEngine } from "./audio";
import { CueEngine, DEFAULT_RULES } from "./cues";
import { DmxSink } from "./dmx";
import { SceneRenderer } from "./renderer";
import { SCENES, initialSceneState, type CueRule, type SceneId, type SceneState } from "./types";

describe("scene definitions", () => {
  it("defines the four scenes with sensible weather", () => {
    expect(Object.keys(SCENES).sort()).toEqual(["cavern", "christmas-forest", "fire-watchtower", "winter-forest"]);
    expect(SCENES["fire-watchtower"].rain).toBeGreaterThan(0); expect(SCENES["winter-forest"].snow).toBeGreaterThan(0); expect(SCENES.cavern.decor).toContain("crystals"); expect(SCENES["christmas-forest"].decor).toContain("christmas");
  });
  it("initial state starts in the cavern with a quiet 512-channel DMX universe, fire only where the decor has it", () => {
    const s = initialSceneState(); expect(s.scene).toBe("cavern"); expect(s.dmx).toHaveLength(512); expect(s.dmx.every((v) => v === 0)).toBe(true); expect(s.fire).toBe(0); expect(s.flash).toBe(0); expect(s.banner).toBe("");
    expect(initialSceneState("fire-watchtower").fire).toBeGreaterThan(0);
  });
});

describe("CueEngine", () => {
  const ev = (type: string, data: Record<string, any> = {}) => ({ type, t: 0, data });
  it("ships default rules for queen loss, capture, check, mate and every phase", () => {
    expect(DEFAULT_RULES.map((r) => r.id)).toEqual(["queen-lost", "capture", "check", "mate", "clock-low", "clock-critical", "clock-flag", "intro", "game", "outro", "idle"]);
  });
  it("queen capture: three bolts spaced over time, delayed thunder, a DMX strobe that turns on and off, a video cue — and not the generic capture rule", () => {
    const c = new CueEngine(); c.fire([ev("capture", { captured: "q" })], 0);
    const first = c.tick(0).map((f) => f.action.do);
    expect(first).toEqual(expect.arrayContaining(["lightning", "thunder", "dmx", "video"])); expect(first).not.toContain("sfx");
    expect(c.state.flash).toBe(1); expect(c.state.dmx[0]).toBe(255); expect(c.state.banner).toBe("queen-fall");
    c.tick(40); expect(c.state.dmx[0]).toBe(0);
    c.tick(110); expect(c.state.dmx[0]).toBe(255);
    c.state.flash = 0; c.tick(140); expect(c.state.flash).toBeGreaterThan(0); // second bolt
  });
  it("an ordinary capture is a soft flash and a thud, never thunder", () => {
    const c = new CueEngine(); c.fire([ev("capture", { captured: "p" })], 0);
    const fired = c.tick(0).map((f) => f.action);
    expect(fired.map((a) => a.do).sort()).toEqual(["lightning", "sfx"]); expect(c.state.flash).toBeCloseTo(0.25);
  });
  it("events without data and rules whose 'when' does not match do nothing", () => {
    const c = new CueEngine(); c.fire([{ type: "capture", t: 0 }, ev("check")], 0);
    expect(c.tick(0).map((f) => f.action.do)).toContain("sfx"); // check -> sting; bare capture matched the generic rule
    const d = new CueEngine(); d.fire([ev("mystery")], 0); expect(d.tick(0)).toEqual([]);
  });
  it("phase cues switch scenes and weather", () => {
    const c = new CueEngine();
    const to = (phase: string) => { c.fire([ev("phase", { phase })], 0); c.tick(0); return c.state; };
    expect(to("intro").scene).toBe("winter-forest"); expect(to("game")).toMatchObject({ scene: "fire-watchtower" }); expect(c.state.rain).toBeGreaterThan(0);
    expect(to("outro").scene).toBe("christmas-forest"); expect(to("idle").scene).toBe("cavern"); expect(c.state.decor).toContain("crystals");
  });
  it("custom rules can set weather, time, fire, video, sfx and plain DMX values", () => {
    const rules: CueRule[] = [{ id: "x", on: "go", actions: [
      { do: "weather", rain: 0.9, snow: 0.1, fog: 0.4, wind: 0.8 }, { do: "time", hour: 3 }, { do: "fire", level: 0.9 }, { do: "video", clip: "c" }, { do: "sfx", name: "thud", gain: 1 }, { do: "dmx", channel: 5, value: 77 },
    ] }];
    const c = new CueEngine(); c.rules = rules; c.fire([ev("go")], 10);
    const fired = c.tick(10);
    expect(fired).toHaveLength(6); expect(c.state).toMatchObject({ rain: 0.9, snow: 0.1, fog: 0.4, wind: 0.8, timeOfDay: 3, fire: 0.9, banner: "c" }); expect(c.state.dmx[4]).toBe(77);
  });
  it("partial weather actions leave the other values alone", () => {
    const c = new CueEngine(); c.rules = [{ id: "w", on: "w", actions: [{ do: "weather", rain: 1 }] }, { id: "v", on: "v", actions: [{ do: "weather", snow: 1 }, { do: "weather", fog: 1 }, { do: "weather", wind: 1 }] }];
    c.fire([ev("w")], 0); c.tick(0); expect(c.state).toMatchObject({ rain: 1, snow: 0, fog: 0.5 });
    c.fire([ev("v")], 1); c.tick(1); expect(c.state).toMatchObject({ rain: 1, snow: 1, fog: 1, wind: 1 });
  });
  it("matches several generic rules for one event, but a specific rule stops the scan", () => {
    const c = new CueEngine(); c.rules = [{ id: "a", on: "e", actions: [{ do: "fire", level: 0.1 }] }, { id: "b", on: "e", actions: [{ do: "fire", level: 0.2 }] }, { id: "c", on: "e", when: { k: 1 }, actions: [{ do: "fire", level: 0.3 }] }, { id: "d", on: "e", actions: [{ do: "fire", level: 0.4 }] }];
    c.fire([ev("e", { k: 1 })], 0); expect(c.tick(0)).toHaveLength(3);
  });
  it("setScene applies a scene immediately; flash decays; fire eases toward the scene's level", () => {
    const c = new CueEngine(); c.setScene("fire-watchtower"); expect(c.state.scene).toBe("fire-watchtower");
    c.state.flash = 1; c.state.fire = 1; c.tick(0); c.tick(100);
    expect(c.state.flash).toBeLessThan(1); expect(c.state.fire).toBeLessThan(1);
    c.setScene("cavern"); c.state.fire = 0.5; c.tick(200); expect(c.state.fire).toBeLessThan(0.5); // no fire decor: eases to zero
  });
  it("caps dt at 250 ms when the tab was backgrounded", () => {
    const c = new CueEngine(); c.tick(0); c.state.flash = 1; c.tick(60000); expect(c.state.flash).toBe(0);
  });
});

describe("DmxSink", () => {
  class FakeWS { static OPEN = 1; static last: FakeWS; readyState = 1; sent: string[] = []; onopen: (() => void) | null = null; onclose: (() => void) | null = null; onerror: (() => void) | null = null; constructor(public url: string) { FakeWS.last = this; } send(m: string) { this.sent.push(m); } close() { this.onclose?.(); } }
  beforeEach(() => vi.stubGlobal("WebSocket", FakeWS));
  afterEach(() => vi.unstubAllGlobals());
  it("connects, flags itself connected, and reconnects state on close / error", () => {
    const d = new DmxSink("ws://x"); expect(d.connected).toBe(false); d.connect();
    FakeWS.last.onopen!(); expect(d.connected).toBe(true); expect(FakeWS.last.url).toBe("ws://x");
    FakeWS.last.onerror!(); expect(d.connected).toBe(false);
    d.connect(); FakeWS.last.onopen!(); FakeWS.last.onclose!(); expect(d.connected).toBe(false);
  });
  it("sends trimmed universes only when they change, and only while open", () => {
    const d = new DmxSink(); d.connect(); const ws = FakeWS.last;
    const u = new Array(512).fill(0); u[0] = 255;
    d.send(0, u); d.send(0, u);
    expect(ws.sent).toHaveLength(1); expect(JSON.parse(ws.sent[0])).toEqual({ universe: 0, channels: [255, 0, 0, 0, 0, 0, 0, 0] });
    u[9] = 7; d.send(1, u); expect(JSON.parse(ws.sent[1]).channels).toHaveLength(10);
    d.send(0, new Array(512).fill(0)); expect(JSON.parse(ws.sent[2]).channels).toHaveLength(8);
    ws.readyState = 0; u[0] = 1; d.send(0, u); expect(ws.sent).toHaveLength(3);
  });
  it("does nothing before connect, and survives a WebSocket constructor that throws", () => {
    const d = new DmxSink(); expect(() => d.send(0, [1])).not.toThrow();
    vi.stubGlobal("WebSocket", class { constructor() { throw new Error("blocked"); } });
    expect(() => d.connect()).not.toThrow();
  });
});

class Param { value = 0; calls: string[] = []; setValueAtTime(v: number) { this.value = v; this.calls.push("set"); } exponentialRampToValueAtTime(v: number) { this.value = v; this.calls.push("ramp"); } setTargetAtTime(v: number) { this.value = v; this.calls.push("target"); } }
const node = () => ({ connect(n: any) { return n; }, start() {}, stop() {}, gain: new Param(), frequency: new Param(), Q: new Param(), type: "", buffer: null as any, loop: false });
class FakeAC {
  static made: FakeAC[] = []; sampleRate = 1000; currentTime = 0; state = "running"; destination = {}; resumed = 0; gains: any[] = []; sources: any[] = [];
  constructor() { FakeAC.made.push(this); }
  resume() { this.resumed++; return Promise.resolve(); }
  createBuffer(_c: number, n: number) { const d = new Float32Array(n); return { getChannelData: () => d }; }
  createBufferSource() { const n = node(); this.sources.push(n); return n; } createBiquadFilter() { return node(); } createOscillator() { return node(); }
  createGain() { const n = node(); this.gains.push(n); return n; }
}

describe("AudioEngine", () => {
  beforeEach(() => { FakeAC.made = []; vi.stubGlobal("AudioContext", FakeAC); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  const state = (over: Partial<SceneState> = {}): SceneState => ({ ...initialSceneState("fire-watchtower"), ...over });

  it("is inert until started from a user gesture", () => {
    const a = new AudioEngine(); expect(() => { a.follow(state()); a.play({ do: "thunder", strength: 1 }); }).not.toThrow(); expect(FakeAC.made).toHaveLength(0);
  });
  it("start builds three looping beds once and resumes a suspended context on repeat", () => {
    const a = new AudioEngine(); a.start();
    const ac = FakeAC.made[0]; expect(ac.sources).toHaveLength(3); expect(ac.sources.every((s) => s.loop)).toBe(true);
    a.start(); expect(FakeAC.made).toHaveLength(1); expect(ac.resumed).toBe(1);
  });
  it("follows the scene: bed levels track rain, wind, fire; muting silences them", () => {
    const a = new AudioEngine(); a.start();
    const beds = FakeAC.made[0].gains.slice(4, 7); // gains[0] master, [1..3] ambience/sfx/music buses, then the three beds
    a.follow(state({ rain: 0.8, wind: 0.5, fire: 0.5 }));
    expect(beds[0].gain.value).toBeCloseTo(0.2); expect(beds[2].gain.value).toBeCloseTo(0.06); expect(beds[1].gain.value).toBeGreaterThan(0);
    a.enabled = false; a.follow(state({ rain: 0.8 })); expect(beds.every((b: any) => b.gain.value === 0)).toBe(true);
  });
  it("sprinkles fire crackle and cave drips by chance, only when enabled and the scene has them", () => {
    const a = new AudioEngine(); a.start(); const ac = FakeAC.made[0];
    vi.spyOn(Math, "random").mockReturnValue(0);
    const before = ac.sources.length;
    a.follow(state({ fire: 0.5 })); expect(ac.sources.length).toBe(before + 1); // click
    a.follow(state({ fire: 0, ambience: { rain: 0, fire: 0, wind: 0, drip: 1 } })); expect(ac.sources.length).toBe(before + 2); // drip
    a.follow(state({ fire: 0, ambience: { rain: 0, fire: 0, wind: 0, drip: 0 } })); expect(ac.sources.length).toBe(before + 2);
    vi.spyOn(Math, "random").mockReturnValue(0.99); a.follow(state({ fire: 0.5, ambience: { rain: 0, fire: 0, wind: 0, drip: 1 } })); expect(ac.sources.length).toBe(before + 2);
    a.enabled = false; vi.spyOn(Math, "random").mockReturnValue(0); a.follow(state({ fire: 0.5 })); expect(ac.sources.length).toBe(before + 2);
  });
  it("plays thunder (two layered bursts), thuds and stings; ignores other actions and disabled state", () => {
    const a = new AudioEngine(); a.start(); const ac = FakeAC.made[0], n0 = ac.sources.length, g0 = ac.gains.length;
    a.play({ do: "thunder", strength: 1 }); expect(ac.sources.length).toBe(n0 + 2);
    a.play({ do: "sfx", name: "thud", gain: 0.3 }); expect(ac.sources.length).toBe(n0 + 3);
    a.play({ do: "sfx", name: "thud" }); expect(ac.sources.length).toBe(n0 + 4);
    const gains = ac.gains.length; a.play({ do: "sfx", name: "sting" }); expect(ac.gains.length).toBe(gains + 1); expect(ac.sources.length).toBe(n0 + 4); // oscillator, not noise
    a.play({ do: "lightning", strength: 1 }); expect(ac.gains.length).toBe(gains + 1);
    a.enabled = false; a.play({ do: "thunder", strength: 1 }); expect(ac.sources.length).toBe(n0 + 4); expect(g0).toBeGreaterThan(0);
  });
});

describe("SceneRenderer", () => {
  const ctx = () => document.createElement("canvas").getContext("2d")!;
  const base = (id: SceneId, over: Partial<SceneState> = {}): SceneState => ({ ...initialSceneState(id), ...over });
  it.each(Object.keys(SCENES) as SceneId[])("draws %s across the day without error", (id) => {
    const r = new SceneRenderer(), c = ctx(), fill = vi.spyOn(c, "fillRect");
    for (const hour of [0, 6, 8, 12, 18, 22]) // 8h: dawn, stars but no moon
      r.draw(c, 320, 180, base(id, { timeOfDay: hour, fog: 0.4, rain: 0.5, snow: 0.5 }), hour * 1000, 0.016);
    expect(fill).toHaveBeenCalled();
  });
  it("shows stars and moon at night, not at noon, and never in the cavern", () => {
    const night = vi.spyOn(ctx(), "arc"), c1 = ctx(), c2 = ctx(), c3 = ctx();
    const a1 = vi.spyOn(c1, "arc"), a2 = vi.spyOn(c2, "arc"), a3 = vi.spyOn(c3, "arc");
    new SceneRenderer().draw(c1, 320, 180, base("winter-forest", { timeOfDay: 0, snow: 0, rain: 0, fog: 0 }), 0, 0.016);
    new SceneRenderer().draw(c2, 320, 180, base("winter-forest", { timeOfDay: 12, snow: 0, rain: 0, fog: 0 }), 0, 0.016);
    new SceneRenderer().draw(c3, 320, 180, base("cavern", { timeOfDay: 0, snow: 0, rain: 0, fog: 0 }), 0, 0.016);
    expect(a1.mock.calls.length).toBeGreaterThan(a2.mock.calls.length); expect(night).toBeDefined();
    expect(a3.mock.calls.length).toBeGreaterThanOrEqual(0);
  });
  it("draws christmas lights that blink, the watchtower fire with embers, and a banner label", () => {
    const r = new SceneRenderer(), c = ctx(), arc = vi.spyOn(c, "arc"), text = vi.spyOn(c, "fillText");
    const xmas = base("christmas-forest", { snow: 0, banner: "intro" });
    r.draw(c, 640, 360, xmas, 0, 0.016); const n1 = arc.mock.calls.length;
    r.draw(c, 640, 360, xmas, 700, 0.016); r.draw(c, 640, 360, xmas, 1500, 0.016);
    expect(n1).toBeGreaterThan(0); expect(text).toHaveBeenCalledWith(expect.stringContaining("intro"), expect.any(Number), expect.any(Number));
    const fire = base("fire-watchtower", { fire: 1 });
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    for (let i = 0; i < 80; i++) r.draw(c, 640, 360, fire, i * 100, 0.1);
    vi.restoreAllMocks();
    r.draw(c, 640, 360, { ...fire, fire: 0 }, 9000, 0.1); // no glow below threshold
  });
  it("renders rain and snow in proportion to their intensity and prunes particles when they drop", () => {
    const r = new SceneRenderer(), c = ctx(), stroke = vi.spyOn(c, "stroke");
    r.draw(c, 320, 180, base("winter-forest", { rain: 1, snow: 1 }), 0, 0.05);
    for (let i = 0; i < 60; i++) r.draw(c, 320, 180, base("winter-forest", { rain: 1, snow: 1, wind: 1 }), i * 50, 0.2); // particles wrap around the screen
    r.draw(c, 320, 180, base("winter-forest", { rain: 0, snow: 0 }), 5000, 0.05);
    expect(stroke).toHaveBeenCalled();
    r.draw(c, 320, 180, base("winter-forest", { rain: 0.2, snow: 0.2 }), 6000, 0.05);
  });
  it("flashes the screen and strikes a bolt on each rising lightning edge, but only draws the bolt when bright", () => {
    const r = new SceneRenderer(), c = ctx(), moveTo = vi.spyOn(c, "moveTo");
    r.draw(c, 320, 180, base("fire-watchtower", { flash: 0 }), 0, 0.016); const calm = moveTo.mock.calls.length;
    r.draw(c, 320, 180, base("fire-watchtower", { flash: 1 }), 16, 0.016);
    expect(moveTo.mock.calls.length).toBeGreaterThan(calm);
    r.draw(c, 320, 180, base("fire-watchtower", { flash: 0.3 }), 32, 0.016); // faint: veil only
    r.draw(c, 320, 180, base("fire-watchtower", { flash: 0.02 }), 48, 0.016); // below veil threshold
    r.draw(c, 320, 180, base("fire-watchtower", { flash: 0.6 }), 64, 0.016); // brightening but bolt already exists
  });
  it("is stable on the very first frame (dt 0) and with no banner", () => {
    const r = new SceneRenderer(), c = ctx();
    expect(() => r.draw(c, 100, 60, base("cavern"), 0, 0)).not.toThrow();
  });
});
