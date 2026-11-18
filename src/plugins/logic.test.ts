import { Chess } from "chess.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bus } from "../core/bus";
import type { BoardBelief } from "../vision/types";
import { cameraMatrix, project } from "../vision/triangulate";
import { poseString } from "../vision/boardPose";
import { RIGS, rigCorners } from "../sim/rigs";
import { virtualTable } from "../sim/virtualTable";
import { node, tick } from "../test/helpers";
import { createEngine } from "../chess/engine";
import { DEFAULT_RULES } from "../scene/cues";
import { startAudio } from "./scene";
import { speakLine } from "./narration";
import { SCENARIOS } from "../sim/scenarios";

vi.mock("../chess/engine", async (orig) => ({ ...(await orig<typeof import("../chess/engine")>()), createEngine: vi.fn() }));
const mpState = vi.hoisted(() => ({ detect: (_c: unknown): { landmarks: any[] } => ({ landmarks: [] }), fail: false, closed: 0 }));
vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: { forVisionTasks: async () => { if (mpState.fail) throw new Error("no model"); return {}; } },
  PoseLandmarker: { createFromOptions: async () => ({ detect: (c: unknown) => mpState.detect(c), close: () => { mpState.closed++; } }) },
}));

const belief = (g: Chess, o: Partial<BoardBelief> = {}): BoardBelief => {
  const occ = new Float32Array(64), white = new Float32Array(64), conf = new Float32Array(64).fill(0.95);
  g.board().flat().forEach((p, i) => { occ[i] = p ? 1 : 0; white[i] = p?.color === "w" ? 1 : 0; });
  return { t: 1, occ, white, conf, fidelity: 0.9, handOver: false, settled: true, cams: 2, ...o };
};
const director = (over: Record<string, unknown> = {}) => ({ phase: "game", mode: "engine", elo: 500, menu: [], progress: {}, events: [], seat: null, ...over });

beforeEach(() => { virtualTable.reset(); virtualTable.seated = false; virtualTable.pointer = null; bus.lines.length = 0; bus.events.length = 0; bus.engineHint = null; bus.game = null; bus.scene = null; bus.poses = []; });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("game.tracker node", () => {
  it("passes nothing through without a board", () => {
    const n = node("game.tracker"); expect(n.run({})).toEqual({ game: null, events: [] });
  });
  it("tracks moves, publishes to the bus and reports fidelity, previewing the board and status", () => {
    const n = node("game.tracker", { confirm: 1, maxCost: 0.9, promotion: "n" }), g = new Chess();
    n.run({ board: belief(g) }); g.move("e4");
    const out = n.run({ board: belief(g) })!;
    expect(out.game.last.san).toBe("e4"); expect(out.events.map((e: any) => e.type)).toContain("move"); expect(bus.game).toBe(out.game); expect(n.h.fidelity).toBeGreaterThan(0.5);
    expect((n.state as any).tracker.cfg).toMatchObject({ confirm: 1, maxCost: 0.9, promotion: "n" });
    n.paint(140, 140);
  });
  it("caps fidelity when the position is illegal and previews it", () => {
    const n = node("game.tracker"), v = belief(new Chess(), { fidelity: 1 }); v.occ[52] = 0; v.occ[20] = 1; v.white[20] = 1; v.conf.fill(0.99);
    n.run({ board: v }); expect(n.h.fidelity).toBe(0.2); n.paint();
  });
  it("paints a placeholder before any observation", () => { node("game.tracker").paint(); });
  it("resets on demand, when a scenario starts, and when the experience returns to idle", () => {
    const n = node("game.tracker", { confirm: 1 }), g = new Chess(); g.move("d4");
    n.run({ board: belief(new Chess()) }); n.run({ board: belief(g) }); expect((n.state as any).tracker.game.history()).toEqual(["d4"]);
    n.params.resync = true; n.run({ board: belief(new Chess()) }); expect(n.params.resync).toBe(false); expect((n.state as any).tracker.game.history()).toEqual([]);
    n.run({ board: belief(g) }); n.run({ board: belief(new Chess()), control: [{ type: "scenario-start" }] }); expect((n.state as any).tracker.game.history()).toEqual([]);
    n.run({ board: belief(g), director: director({ phase: "game" }) }); expect((n.state as any).tracker.game.history()).toEqual(["d4"]);
    n.run({ board: belief(new Chess()), director: director({ phase: "idle" }) }); expect((n.state as any).tracker.game.history()).toEqual([]);
    n.run({ board: belief(new Chess()), control: [{ type: "other" }] });
  });
});

describe("game.engine node", () => {
  const fakeEngine = (move = "e7e5") => ({ setElo: vi.fn(), bestMove: vi.fn(async () => move), dispose: vi.fn() });
  const gameAfter = (...sans: string[]) => { const c = new Chess(); sans.forEach((m) => c.move(m)); return { fen: c.fen(), status: "synced", turn: c.turn(), over: false }; };

  it("is idle outside engine games (clears any hint)", () => {
    const n = node("game.engine"); bus.engineHint = { from: "a1", to: "a2" };
    expect(n.run({})).toEqual({ events: [] }); expect(bus.engineHint).toBeNull();
    for (const d of [director({ mode: "human" }), director({ phase: "menu" })]) expect(n.run({ game: gameAfter("e4"), director: d })).toEqual({ events: [] });
    expect(vi.mocked(createEngine)).not.toHaveBeenCalled();
  });
  it("loads the engine lazily, thinks once per position, hints the move, plays it on the virtual table, and clears the hint when the position changes", async () => {
    const eng = fakeEngine(); vi.mocked(createEngine).mockResolvedValue(eng as any);
    const n = node("game.engine", { color: "b", virtualHand: true }), g = gameAfter("e4"); virtualTable.game.move("e4");
    n.run({ game: g, director: director() }, 1000); await tick();
    expect(eng.bestMove).not.toHaveBeenCalled();
    n.run({ game: g, director: director() }, 1100); await tick();
    expect(eng.setElo).toHaveBeenCalledWith(500); expect(eng.bestMove).toHaveBeenCalledWith(g.fen); expect(bus.engineHint).toEqual({ from: "e7", to: "e5" }); expect(virtualTable.busy).toBe(true);
    const out = n.run({ game: g, director: director() }, 1200)!; expect(out.events[0]).toMatchObject({ type: "engine-move", data: { uci: "e7e5", san: "e5" } }); expect(bus.events.length).toBe(1);
    n.run({ game: g, director: director() }, 1300); await tick(); expect(eng.bestMove).toHaveBeenCalledTimes(1); // same position: no second search
    n.run({ game: gameAfter("e4", "e5"), director: director() }, 1400); expect(bus.engineHint).toBeNull();
  });
  it("does not search when it is not the engine's turn, the game is over, or the tracker is not synced; can leave the virtual hand idle", async () => {
    const eng = fakeEngine("e7e5"); vi.mocked(createEngine).mockResolvedValue(eng as any);
    const n = node("game.engine", { color: "b", virtualHand: false });
    n.run({ game: gameAfter(), director: director() }, 0); await tick();
    for (const g of [gameAfter(), { ...gameAfter("e4"), over: true }, { ...gameAfter("e4"), status: "pending" }]) n.run({ game: g, director: director() }, 10);
    expect(eng.bestMove).not.toHaveBeenCalled();
    n.run({ game: gameAfter("e4"), director: director() }, 20); await tick(); expect(bus.engineHint).toBeTruthy(); expect(virtualTable.busy).toBe(false);
  });
  it("disposes its engine, or nothing when it never loaded", async () => {
    const eng = fakeEngine(); vi.mocked(createEngine).mockResolvedValue(eng as any);
    const n = node("game.engine"); n.run({ game: gameAfter("e4"), director: director() }); await tick(); n.dispose(); expect(eng.dispose).toHaveBeenCalled();
    expect(() => node("game.engine").dispose()).not.toThrow();
  });
});

describe("experience nodes", () => {
  it("director node applies its parameters, publishes to the bus, and forwards events", () => {
    const n = node("experience.director", { dwellMs: 900, introMs: 100, outroMs: 200, preset: "engine", presetElo: "1500" });
    const a = n.run({ seats: [{ id: "s", x: 4, y: 10, angle: 0 }] }, 0)!, b = n.run({ seats: [{ id: "s", x: 4, y: 10, angle: 0 }], pointers: [] }, 200)!;
    expect(a.events.map((e: any) => e.type)).toContain("seat"); expect(b.director.phase).toBe("game"); expect(bus.director).toBe(b.director); expect(bus.events.length).toBeGreaterThan(0); expect(n.h.fidelity).toBeNull();
    expect((n.state as any).dir.cfg).toMatchObject({ dwellMs: 900, preset: "engine", presetElo: 1500 });
    n.run({ events: [] }, 300); // no seats / pointers
  });
  it("virtual player sits, carries the mouse pointer, and advances the table's choreography", () => {
    const n = node("sim.person", { seated: true });
    virtualTable.pointer = { x: 1, y: 2 }; virtualTable.play("e4", 0);
    const out = n.run({}, 600)!;
    expect(virtualTable.seated).toBe(true); expect(out.seats).toHaveLength(1); expect(out.pointers).toEqual([{ id: "mouse", x: 1, y: 2 }]); expect(virtualTable.carried).toBe(52);
    n.params.seated = false; virtualTable.pointer = null; const off = n.run({}, 700)!; expect(off.seats).toEqual([]); expect(off.pointers).toEqual([]);
  });
  it("scenario player plays a script through its two AI players, announces start and end, resets the table, and stops itself", () => {
    const n = node("sim.scenario", { scenario: "scholars-mate", play: true, pauseMs: 500 });
    const white = node("sim.player", { color: "w" }), black = node("sim.player", { color: "b" });
    const step = (now: number) => { const out = n.run({}, now)!; white.run({ actions: out.actions }, now); black.run({ actions: out.actions }, now); return out; };
    let events: any[] = [], now = 0;
    expect(step(now).events.map((e: any) => e.type)).toEqual(["scenario-start"]);
    for (; now < 60000 && n.params.play; now += 100) events = events.concat(step(now).events);
    expect(events.map((e) => e.type)).toEqual(["scenario-end"]); expect(n.params.play).toBe(false); expect(virtualTable.game.history()).toHaveLength(7); expect(n.h.fidelity).toBe(1);
    expect(n.run({}, now)).toEqual({ events: [], actions: [] }); expect(n.h.fidelity).toBeNull(); expect((n.state as any).runner).toBeNull();
  });
  it("the AI players shake hands before and after the game, and the checkmated player bangs the table", () => {
    const n = node("sim.scenario", { scenario: "scholars-mate", play: true, pauseMs: 500 });
    const white = node("sim.player", { color: "w" }), black = node("sim.player", { color: "b" });
    const asked: string[] = [];
    for (let now = 0; now < 60000; now += 100) {
      const out = n.run({}, now)!;
      asked.push(...out.actions.map((a: any) => (a.kind === "move" ? a.san : a.kind === "fist" ? `fist:${a.color}` : a.kind)));
      white.run({ actions: out.actions }, now); black.run({ actions: out.actions }, now);
      if (!n.params.play) break;
    }
    // scholar's mate is white's win, so black is the one checkmated
    expect(asked).toEqual(["handshake", "e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6", "Qxf7#", "handshake", "fist:b"]);
    expect(virtualTable.game.history()).toHaveLength(7); expect(virtualTable.busy).toBe(false);
  });
  it("restarts when another scenario is selected mid-play", () => {
    const n = node("sim.scenario", { scenario: "scholars-mate", play: true, pauseMs: 500 });
    n.run({}, 0); n.run({}, 600); n.params.scenario = SCENARIOS[2].id;
    expect(n.run({}, 700)!.events.map((e: any) => e.type)).toEqual(["scenario-start"]); expect(virtualTable.game.history()).toEqual([]);
  });
});

describe("narration nodes", () => {
  it("narrator merges three event inputs, honours voice settings, logs to the bus, and previews recent lines", () => {
    const n = node("narration.narrator", { voices: "1", nameA: "Hugo", nameB: "Léa" });
    expect(n.run({})).toEqual({ lines: [] });
    const out = n.run({ events: [{ type: "seat", t: 1000 }], events2: [{ type: "mode", t: 20000, data: { mode: "engine", elo: 500 } }], events3: [{ type: "engine-move", t: 40000, data: { san: "e5" } }] })!;
    expect(out.lines.length).toBeGreaterThanOrEqual(3); expect(out.lines[0].name).toBe("Hugo"); expect(out.lines.every((l: any) => l.speaker === "A")).toBe(true);
    expect(bus.lines.length).toBe(out.lines.length); n.paint(200, 70);
    n.params.voices = "2"; n.paint(); n.run({ events: [{ type: "check", t: 90000, data: {} }] }); n.paint(); // both voices in colour
    for (let i = 0; i < 10; i++) n.run({ events: [{ type: "seat", t: 100000 + i * 5000 }] }); // preview keeps a longer history for expanded nodes
    expect((n.state as any).lines.length).toBeGreaterThan(6);
  });
  it("speech node is silent when disabled or unsupported", () => {
    const n = node("narration.speech", { enabled: false }); n.run({ lines: [{ text: "x", speaker: "A", priority: 3 }] });
    const m = node("narration.speech"); vi.stubGlobal("speechSynthesis", undefined); expect(() => m.run({ lines: [{ text: "x", speaker: "A", priority: 3 }] })).not.toThrow();
    expect(() => m.run({})).not.toThrow(); // no lines
  });
  describe("speakLine", () => {
    const stub = (voices: { lang: string }[]) => {
      const synth = { cancel: vi.fn(), speak: vi.fn(), getVoices: () => voices };
      vi.stubGlobal("speechSynthesis", synth); vi.stubGlobal("SpeechSynthesisUtterance", class { constructor(public text: string) {} lang = ""; volume = 1; pitch = 1; rate = 1; voice: any = null; });
      return synth;
    };
    it("gives voices A and B different pitch/rate and the right French voice; interrupts on demand", () => {
      const fr = [{ lang: "fr-FR", n: 1 }, { lang: "fr-CA", n: 2 }], synth = stub([{ lang: "en-US" }, ...fr]);
      speakLine("Bonjour", "A", 0.5, true); speakLine("Salut", "B", 0.7);
      const [a, b] = synth.speak.mock.calls.map((c: any) => c[0]);
      expect(synth.cancel).toHaveBeenCalledTimes(1); expect(a).toMatchObject({ text: "Bonjour", lang: "fr-FR", volume: 0.5, pitch: 0.85, rate: 1.05, voice: fr[0] }); expect(b).toMatchObject({ pitch: 1.25, rate: 0.98, voice: fr[1] });
    });
    it("reuses the only French voice for both speakers, and leaves the default when none exists", () => {
      const synth = stub([{ lang: "fr-FR" }]); speakLine("x", "B", 1); expect(synth.speak.mock.calls[0][0].voice).toEqual({ lang: "fr-FR" });
      const none = stub([{ lang: "en-US" }]); speakLine("x", "A", 1); expect(none.speak.mock.calls[0][0].voice).toBeNull();
    });
    it("speech node speaks each line, cutting in on critical ones", () => {
      const synth = stub([]); const n = node("narration.speech", { volume: 0.4 });
      n.run({ lines: [{ text: "a", speaker: "A", priority: 3 }, { text: "b", speaker: "B", priority: 1 }] });
      expect(synth.cancel).toHaveBeenCalledTimes(1); expect(synth.speak).toHaveBeenCalledTimes(2);
    });
  });
});

describe("scene nodes", () => {
  class FakeAC { static made: FakeAC[] = []; currentTime = 0; state = "running"; sampleRate = 100; destination = {}; sources = 0; constructor() { FakeAC.made.push(this); }
    resume() { return Promise.resolve(); } createBuffer(_c: number, n: number) { const d = new Float32Array(n); return { getChannelData: () => d }; }
    createBufferSource() { this.sources++; return mk(); } createBiquadFilter() { return mk(); } createOscillator() { return mk(); } createGain() { return mk(); } }
  const mk = () => ({ connect(n: any) { return n; }, start() {}, stop() {}, gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} }, frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, Q: { value: 0 } });
  class FakeWS { static OPEN = 1; static made: FakeWS[] = []; readyState = 1; sent: string[] = []; onopen: any; onclose: any; onerror: any; constructor(public url: string) { FakeWS.made.push(this); } send(m: string) { this.sent.push(m); } close() {} }

  it("cues node reacts to events from three inputs and publishes scene + fired actions", () => {
    const n = node("scene.cues");
    const out = n.run({ events: [{ type: "capture", t: 0, data: { captured: "q" } }], events2: [{ type: "phase", t: 0, data: { phase: "game" } }], events3: [] }, 0)!;
    expect(out.fired.map((f: any) => f.action.do)).toEqual(expect.arrayContaining(["thunder", "scene"])); expect(bus.scene).toBe(out.scene); expect(out.scene.flash).toBeGreaterThan(0);
    n.run({}, 100);
  });
  it("applies parameter overrides (scene, time, rain, snow) and the thunder button", () => {
    const n = node("scene.cues", { scene: "winter-forest", hour: 4, rain: 0.2, snow: 0.9 });
    const s = n.run({}, 0)!.scene; expect(s).toMatchObject({ scene: "winter-forest", timeOfDay: 4, rain: 0.2, snow: 0.9 });
    n.params.scene = "(auto)"; n.run({}, 100); n.params.scene = "cavern"; expect(n.run({}, 200)!.scene.scene).toBe("cavern");
    n.params.thunder = true; const t = n.run({}, 300)!; expect(n.params.thunder).toBe(false); expect(t.fired.some((f: any) => f.action.do === "thunder")).toBe(true);
    const d = node("scene.cues", { hour: -1, rain: -1, snow: -1 }); expect(d.run({}, 0)!.scene.rain).toBe(0);
  });
  it("accepts custom rule JSON, keeps the old rules while the JSON is invalid, and falls back to defaults when cleared", () => {
    const n = node("scene.cues", { rules: JSON.stringify([{ id: "x", on: "boo", actions: [{ do: "fire", level: 0.77 }] }]) });
    expect(n.run({ events: [{ type: "boo", t: 0 }] }, 0)!.scene.fire).toBeCloseTo(0.77, 1);
    n.params.rules = "[{ nope"; n.run({}, 100); expect((n.state as any).cues.rules[0].id).toBe("x");
    n.params.rules = ""; n.run({}, 200); expect((n.state as any).cues.rules.length).toBe(DEFAULT_RULES.length);
  });
  it("paints a preview of the running scene", () => { const n = node("scene.cues"); n.run({}, 0); n.paint(200, 112); n.paint(200, 112); });
  it("output node ignores a missing scene; drives audio, plays fired cues, and connects DMX once, sending the universe", () => {
    vi.stubGlobal("AudioContext", FakeAC); vi.stubGlobal("WebSocket", FakeWS);
    const n = node("scene.output", { dmx: true, dmxUrl: "ws://bridge", universe: 2 });
    expect(n.run({})).toBeUndefined();
    const cues = node("scene.cues"); const c = cues.run({ events: [{ type: "capture", t: 0, data: { captured: "q" } }] }, 0)!;
    (n.state as any).audio.start();
    n.run({ scene: c.scene, fired: c.fired }); n.run({ scene: c.scene, fired: [] });
    expect(FakeWS.made).toHaveLength(1); expect(FakeWS.made[0].url).toBe("ws://bridge"); expect(FakeWS.made[0].sent.length).toBeGreaterThan(0); expect(JSON.parse(FakeWS.made[0].sent[0]).universe).toBe(2);
    n.run({ scene: c.scene }); // no fired list
  });
  it("output node can run without DMX or audio", () => {
    vi.stubGlobal("WebSocket", FakeWS); FakeWS.made = [];
    const n = node("scene.output", { dmx: false, audio: false }); n.run({ scene: node("scene.cues").run({}, 0)!.scene }); expect(FakeWS.made).toHaveLength(0);
  });
  it("startAudio unlocks every output node's audio engine (user gesture)", () => {
    vi.stubGlobal("AudioContext", FakeAC); FakeAC.made = [];
    const out = node("scene.output");
    startAudio({ states: new Map([["a", out.state], ["b", {}]]), nodes: new Map([["a", { type: "scene.output" }], ["b", { type: "other" }]]) });
    expect(FakeAC.made).toHaveLength(1);
  });
});

describe("tracking nodes", () => {
  const BLAZE = [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
  const body: [number, number, number][] = [[0, 1.15, 0.82], [-0.03, 1.18, 0.8], [0.03, 1.18, 0.8], [-0.08, 1.15, 0.82], [0.08, 1.15, 0.82], [-0.18, 0.95, 0.82], [0.18, 0.95, 0.82], [-0.2, 0.75, 0.7], [0.2, 0.75, 0.7], [-0.1, 0.8, 0.2], [0.1, 0.8, 0.5], [-0.1, 0.5, 0.82], [0.1, 0.5, 0.82], [-0.1, 0.45, 0.5], [0.1, 0.45, 0.5], [-0.1, 0, 0.48], [0.1, 0, 0.48]];
  const cams = ["-1.6,2.2,1.6;0,0.75,0;60", "1.6,2.2,1.6;0,0.75,0;60"].map((s) => { const [p, t, f] = s.split(";"); return cameraMatrix(p.split(",").map(Number) as any, t.split(",").map(Number) as any, Number(f), 480, 360); });
  const landmarks = (P: number[], joints = body, vis = 0.9) => { const l = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 })); joints.forEach((j, i) => { const p = project(P, j); l[BLAZE[i]] = { x: p.x / 480, y: p.y / 360, visibility: vis }; }); return l; };
  const frame = { width: 480, height: 360, data: new Uint8ClampedArray(480 * 360).fill(90), t: 0 };
  const mp = () => mpState;
  let clock = 1000;
  const runAll = async (n: ReturnType<typeof node>, inputs: Record<string, any>, rounds = 6) => { let out: any; for (let i = 0; i < rounds; i++) { out = n.run(inputs, (clock += 400)); await tick(); } return out; };

  beforeEach(() => { mp().fail = false; mp().closed = 0; });

  it("is off by default and costs nothing", () => { const n = node("tracking.pose"); expect(n.run({ f1: frame })).toEqual({ poses: [], seats: [], pointers: [] }); expect(n.h.fidelity).toBeNull(); });
  it("loads the model, triangulates a person from two cameras, seats them and turns a wrist near the table into a pointer", async () => {
    let call = 0; mp().detect = () => ({ landmarks: [landmarks(cams[call++ % 2])] });
    const n = node("tracking.pose", { enabled: true, seat: "0,0.8,180" });
    const out = await runAll(n, { f1: frame, f2: frame });
    expect(out.poses).toHaveLength(1); expect(out.poses[0].joints[0]![1]).toBeCloseTo(1.15, 1); expect(out.seats).toEqual([expect.objectContaining({ id: "seat1", angle: 180 })]); expect(bus.poses).toBe(out.poses);
    expect(out.pointers.length).toBeGreaterThan(0); expect(n.h.fidelity).toBeGreaterThan(0.8);
    n.dispose(); expect(mp().closed).toBe(1);
  });
  it("with camera poses derived only from the marked board corners, triangulated joints land on the true 3D skeleton", async () => {
    const A = RIGS.A, B = RIGS.B, PA = cameraMatrix(A.pos, A.target, A.fovY, 480, 360), PB = cameraMatrix(B.pos, B.target, B.fovY, 480, 360);
    let call = 0; mp().detect = () => ({ landmarks: [landmarks(call++ % 2 ? PB : PA)] });
    const n = node("tracking.pose", { enabled: true, cam1: poseString(rigCorners(A, 0), 480, 360, A.fovY), cam2: poseString(rigCorners(B, 0), 480, 360, B.fovY), seat: "0,0.82,0" });
    const out = await runAll(n, { f1: frame, f2: frame });
    body.forEach((truth, i) => { const j = out.poses[0].joints[i]!; expect(Math.hypot(j[0] - truth[0], j[1] - truth[1], j[2] - truth[2]), `joint ${i}`).toBeLessThan(0.01); });
    expect(out.seats).toHaveLength(1);
  });
  it("shows nobody when fewer than five joints resolve, and no seat when the hips are away from it", async () => {
    mp().detect = () => ({ landmarks: [] });
    const n = node("tracking.pose", { enabled: true }); const out = await runAll(n, { f1: frame, f2: frame });
    expect(out.poses).toEqual([]); expect(out.seats).toEqual([]);
    let call = 0; mp().detect = () => ({ landmarks: [landmarks(cams[call++ % 2])] });
    const far = node("tracking.pose", { enabled: true, seat: "3,3,0" }); expect((await runAll(far, { f1: frame, f2: frame })).seats).toEqual([]);
  });
  it("hides low-visibility joints and places a lone camera's ankles on the floor", async () => {
    mp().detect = () => ({ landmarks: [landmarks(cams[0], body, 0.1)] });
    const n = node("tracking.pose", { enabled: true }); expect((await runAll(n, { f1: frame })).poses).toEqual([]);
    mp().detect = () => ({ landmarks: [landmarks(cams[0])] });
    const one = node("tracking.pose", { enabled: true, seat: "0,0.8,0" }); const out = await runAll(one, { f1: frame });
    expect(out.poses).toEqual([]); // 2 ankles only: below the "someone is there" threshold
    expect((one.state as any).joints[0][15]).toBeTruthy();
  });
  it("ignores cameras with malformed pose strings and survives a model that fails to load", async () => {
    let call = 0; mp().detect = () => ({ landmarks: [landmarks(cams[call++ % 2])] });
    const n = node("tracking.pose", { enabled: true, cam1: "garbage", cam2: "garbage", cam3: "1,2,3;4,5,6" });
    expect((await runAll(n, { f1: frame, f2: frame })).poses).toEqual([]);
    mp().fail = true; const bad = node("tracking.pose", { enabled: true }); await runAll(bad, { f1: frame }, 3); expect((bad.state as any).err).toContain("no model");
    expect(() => bad.dispose()).not.toThrow();
  });
  it("drops stale joints when a camera loses its frame", async () => {
    mp().detect = () => ({ landmarks: [landmarks(cams[0])] });
    const n = node("tracking.pose", { enabled: true }); await runAll(n, { f1: frame }, 3);
    await runAll(n, {}, 4); expect((n.state as any).joints[0]).toEqual([]);
  });
  it("virtual person: a seated skeleton on the bus (arm reaches out while the hand is busy), nothing when standing", () => {
    const n = node("sim.pose");
    expect(n.run({})).toEqual({ poses: [] }); expect(bus.poses).toEqual([]);
    virtualTable.seated = true; expect(n.run({})!.poses[0].joints).toHaveLength(17);
    virtualTable.hand = { x: 3, y: 3 }; const j = n.run({})!.poses[0].joints; expect(j[10]![2]).toBeLessThan(0.2); expect(j[9]![2]).toBeGreaterThan(j[10]![2]); // the reaching (right) arm is out over the board, the left rests at the edge
    n.params.show = false; expect(n.run({})).toEqual({ poses: [] });
  });
});
