import { afterEach, describe, expect, it, vi } from "vitest";
import { Graph } from "../core/graph";
import { createRegistry } from "../plugins";
import { SCENARIOS } from "../sim/scenarios";
import { MAX_CAMERAS, buildGraphFromConfig, clearSetup, defaultSetup, hasErrors, loadSetup, nextCameraId, saveSetup, validateSetup, virtualCamera, webcamSetup } from "./config";
import { listCameras, openCamera } from "./devices";
import { poseString } from "../vision/boardPose";
import { parseCorners } from "../plugins/shared";
import { FRAME_H, FRAME_W } from "../sim/rigs";
import { detectEnv, evaluateEnv, type Env } from "./system";

const poseDefault = (id: string) => (createRegistry().get("tracking.pose")!.params!.find((p) => p.id === id) as { value: string }).value;

describe("setup config", () => {
  afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

  it("ships a two-virtual-camera demo configuration, not yet completed", () => {
    const c = defaultSetup();
    expect(c).toMatchObject({ version: 1, completed: false, scene: "auto", opponent: { mode: "menu", elo: 1000 }, narrator: { voices: 2, speak: true }, projectors: { count: 0, dmx: false } });
    expect(c.cameras.map((x) => [x.id, x.kind, x.rig])).toEqual([["A", "virtual", "A"], ["B", "virtual", "B"]]);
    expect(c.demo.scenario).toBe(SCENARIOS[0].id); expect(c.demo.autoplay).toBe(false);
    expect(virtualCamera("C", "Z")).toMatchObject({ id: "Z", rig: "C", online: true });
    expect(webcamSetup("dev1", "Logitech", "W1")).toMatchObject({ kind: "webcam", deviceId: "dev1", label: "Logitech", channel: "luma", trust: 1, fov: 60 }); expect(c.cameras[1].fov).toBe(44); expect(c.tracking).toEqual({ pose: false });
  });

  it("validates a good configuration with only a gentle notice about camera redundancy", () => {
    expect(validateSetup(defaultSetup())).toEqual([]);
    const solo = defaultSetup(); solo.cameras = [solo.cameras[0]]; solo.tracking.pose = true;
    expect(validateSetup(solo).map((i) => i.field)).toEqual(["cameras", "tracking"]); // single camera: both notices
    const one = defaultSetup(); one.cameras = [one.cameras[0]];
    const issues = validateSetup(one); expect(issues).toHaveLength(1); expect(issues[0]).toMatchObject({ level: "warn", field: "cameras" }); expect(hasErrors(issues)).toBe(false);
  });
  it.each([
    ["no cameras", (c: any) => { c.cameras = []; }, "Add at least one camera"],
    ["too many cameras", (c: any) => { c.cameras = ["A", "B", "C", "D", "E"].map((id) => ({ ...virtualCamera("A"), id })); }, `At most ${MAX_CAMERAS}`],
    ["duplicate ids", (c: any) => { c.cameras[1].id = "A"; }, 'used twice'],
    ["bad corners", (c: any) => { c.cameras[0].corners = "1,2;3"; }, "board corners are not set"],
    ["all offline", (c: any) => { c.cameras.forEach((x: any) => (x.online = false)); }, "No camera is online"],
    ["blank commentator", (c: any) => { c.narrator.nameA = "  "; }, "need a name"],
    ["bad DMX url", (c: any) => { c.projectors.dmx = true; c.projectors.dmxUrl = "http://x"; }, "ws://"],
    ["unknown scene", (c: any) => { c.scene = "lava"; }, 'Unknown scene "lava"'],
  ])("flags %s as an error", (_n, mutate, text) => {
    const c: any = defaultSetup(); mutate(c);
    const issues = validateSetup(c);
    expect(hasErrors(issues)).toBe(true); expect(issues.map((i) => i.message).join(" ")).toContain(text);
  });
  it("warns, but does not block, when a webcam has no device chosen; accepts wss:// DMX", () => {
    const c = defaultSetup(); c.cameras.push(webcamSetup("", "Mystery cam", "C")); c.projectors.dmx = true; c.projectors.dmxUrl = "wss://x";
    const issues = validateSetup(c); expect(hasErrors(issues)).toBe(false); expect(issues.some((i) => i.message.includes("default webcam"))).toBe(true);
  });
  it("hands out the next camera id: A..D first, then W1, W2…", () => {
    const c = defaultSetup(); expect(nextCameraId(c)).toBe("C");
    c.cameras.push(virtualCamera("C", "C"), virtualCamera("A", "D")); expect(nextCameraId(c)).toBe("W1");
    c.cameras.push(virtualCamera("A", "W1")); expect(nextCameraId(c)).toBe("W2");
  });

  it("saves, loads (merging defaults), and clears; tolerates garbage, wrong versions and broken storage", () => {
    expect(loadSetup()).toBeNull();
    const c = defaultSetup(); c.completed = true; c.scene = "cavern"; saveSetup(c);
    expect(loadSetup()).toMatchObject({ completed: true, scene: "cavern" });
    localStorage.setItem("cx.setup.v1", JSON.stringify({ version: 1, rain: 0.5 }));
    expect(loadSetup()).toMatchObject({ rain: 0.5, cameras: expect.any(Array) });
    localStorage.setItem("cx.setup.v1", JSON.stringify({ version: 99 })); expect(loadSetup()).toBeNull();
    localStorage.setItem("cx.setup.v1", "{{{"); expect(loadSetup()).toBeNull();
    clearSetup(); expect(localStorage.getItem("cx.setup.v1")).toBeNull();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); }); expect(() => saveSetup(c)).not.toThrow();
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("locked"); }); expect(() => clearSetup()).not.toThrow();
  });

  describe("buildGraphFromConfig", () => {
    const build = (c = defaultSetup()) => { const g = new Graph(createRegistry()); buildGraphFromConfig(g, c); return g; };
    const types = (g: Graph) => [...g.nodes.values()].map((n) => n.type);
    const edge = (g: Graph, fromType: string, fromPort: string, toType: string, toPort: string) => g.edges.some((e) => g.nodes.get(e.from.node)!.type === fromType && e.from.port === fromPort && g.nodes.get(e.to.node)!.type === toType && e.to.port === toPort);

    it("wires cameras -> readers -> fusion -> stabilizer -> tracker -> director/engine/narrator/cues/output", () => {
      const g = build();
      expect(types(g).filter((t) => t === "source.synthetic")).toHaveLength(2); expect(types(g).filter((t) => t === "vision.boardReader")).toHaveLength(2);
      expect(edge(g, "source.synthetic", "frame", "vision.boardReader", "frame")).toBe(true); expect(edge(g, "vision.boardReader", "obs", "vision.fuse", "o2")).toBe(true);
      for (const [a, ap, b, bp] of [["vision.fuse", "board", "vision.stabilize", "board"], ["vision.stabilize", "board", "game.tracker", "board"], ["experience.director", "director", "game.tracker", "director"], ["game.tracker", "game", "game.engine", "game"], ["game.tracker", "events", "narration.narrator", "events"], ["experience.director", "events", "scene.cues", "events2"], ["game.engine", "events", "narration.narrator", "events3"], ["scene.cues", "scene", "scene.output", "scene"], ["narration.narrator", "lines", "narration.ai", "lines"], ["narration.ai", "lines", "narration.speech", "lines"], ["sim.person", "seats", "experience.director", "seats"], ["sim.scenario", "events", "game.tracker", "control"]] as const)
        expect(edge(g, a, ap, b, bp), `${a}.${ap} -> ${b}.${bp}`).toBe(true);
      g.tick(1000); expect([...g.stats.values()].every((s) => !s.error)).toBe(true);
    });
    it("passes the choices through to node parameters", () => {
      const c = defaultSetup(); c.scene = "cavern"; c.rain = 0.3; c.hour = 5; c.opponent = { mode: "engine", elo: 1500 }; c.narrator = { voices: 1, nameA: "Hugo", nameB: "Léa", speak: false, volume: 0.4 }; c.projectors.dmx = true; c.demo = { autoplay: true, scenario: "opera-game" }; c.cameras[0].trust = 1.5;
      const g = build(c); const by = (t: string) => [...g.nodes.values()].find((n) => n.type === t)!;
      expect(by("scene.cues").params).toMatchObject({ scene: "cavern", rain: 0.3, hour: 5 }); expect(by("experience.director").params).toMatchObject({ preset: "engine", presetElo: "1500" });
      expect(by("narration.narrator").params).toMatchObject({ voices: "1", nameA: "Hugo" }); expect(by("narration.speech").params).toMatchObject({ enabled: false, volume: 0.4 });
      expect(by("scene.output").params.dmx).toBe(true); expect(by("sim.scenario").params).toMatchObject({ scenario: "opera-game", play: true }); expect(by("vision.boardReader").params.weight).toBe(1.5);
    });
    it("people tracking replaces the virtual player with a pose node whose camera poses come from the board corners", () => {
      const c = defaultSetup(); c.tracking.pose = true;
      const g = build(c), pose = [...g.nodes.values()].find((n) => n.type === "tracking.pose")!;
      expect(types(g)).not.toContain("sim.person"); expect(pose.params.enabled).toBe(true);
      expect(String(pose.params.cam1)).toBe(poseString(parseCorners(c.cameras[0].corners)!, FRAME_W, FRAME_H, c.cameras[0].fov)); expect(String(pose.params.cam1).split(";")[0]).toMatch(/^-?[\d.]+,1\.7\d*,/);
      expect(pose.params.cam3).toBe(poseDefault("cam3")); // only two cameras configured: the third keeps the node default
      for (const [from, port, to, toPort] of [["source.synthetic", "frame", "tracking.pose", "f1"], ["source.synthetic", "frame", "tracking.pose", "f2"], ["tracking.pose", "seats", "experience.director", "seats"], ["tracking.pose", "pointers", "experience.director", "pointers"]] as const)
        expect(edge(g, from, port, to, toPort), `${from}.${port} -> ${to}.${toPort}`).toBe(true);
    });
    it("skips the pose parameters of cameras whose corners are unusable", () => {
      const c = defaultSetup(); c.tracking.pose = true; c.cameras[1].corners = "bad";
      const pose = [...build(c).nodes.values()].find((n) => n.type === "tracking.pose")!;
      expect(String(pose.params.cam1)).toContain(";"); expect(pose.params.cam2).toBe(poseDefault("cam2")); // unusable corners: left at the default
    });
    it("auto scene maps to the node's '(auto)'", () => { expect([...build().nodes.values()].find((n) => n.type === "scene.cues")!.params.scene).toBe("(auto)"); });
    it("builds webcam sources (device or label fallback) and omits the virtual-only nodes when no virtual camera is used; caps at four cameras", () => {
      const c = defaultSetup(); c.cameras = [webcamSetup("dev9", "Cam 9", "A"), webcamSetup("", "Label only", "B")]; c.cameras[1].online = false; c.cameras[0].channel = "red";
      const g = build(c); const cams = [...g.nodes.values()].filter((n) => n.type === "source.webcam");
      expect(cams.map((n) => n.params.device)).toEqual(["dev9", "Label only"]); expect(cams[0].params.channel).toBe("red"); expect(cams[1].params.online).toBe(false);
      expect(types(g)).not.toContain("sim.scenario"); expect(types(g)).not.toContain("sim.pose");
      const five = defaultSetup(); five.cameras = ["A", "B", "C", "D", "E"].map((id) => virtualCamera("A", id));
      expect(types(build(five)).filter((t) => t === "vision.boardReader")).toHaveLength(MAX_CAMERAS);
    });
    it("replaces whatever graph was there before", () => {
      const g = build(); const before = g.nodes.size; buildGraphFromConfig(g, defaultSetup()); expect(g.nodes.size).toBe(before);
    });
  });
});

describe("system checks", () => {
  const all: Env = { mediaDevices: true, webgl: true, audio: true, speech: true, worker: true, stockfish: true, gamepad: true };
  it("is all green on a capable machine", () => { expect(evaluateEnv(all).every((c) => c.status === "ok")).toBe(true); });
  it("fails on missing WebGL and warns for everything else that degrades gracefully", () => {
    const r = evaluateEnv({ mediaDevices: false, webgl: false, audio: false, speech: false, worker: true, stockfish: false, gamepad: false });
    const by = Object.fromEntries(r.map((c) => [c.id, c]));
    expect(by.webgl.status).toBe("fail"); for (const k of ["camera", "audio", "speech", "stockfish", "gamepad"]) expect(by[k].status).toBe("warn");
    expect(by.stockfish.detail).toContain("setup:stockfish"); expect(by.camera.detail).toContain("virtual");
  });
  it("explains the Stockfish situation differently without Web Workers", () => {
    expect(evaluateEnv({ ...all, worker: false }).find((c) => c.id === "stockfish")!.detail).toContain("No Web Workers");
    expect(evaluateEnv({ ...all, stockfish: false }).find((c) => c.id === "stockfish")!.detail).toContain("setup:stockfish");
  });

  it("attaches per-check summaries and detail rows, with a device row first, when detail is present", () => {
    const r = evaluateEnv({ ...all, detail: { system: { summary: "s", rows: [{ label: "a", value: "b" }] }, webgl: { summary: "three.js", rows: [{ label: "GPU", value: "x" }] } } });
    expect(r[0].id).toBe("system"); expect(r.find((c) => c.id === "webgl")).toMatchObject({ summary: "three.js", rows: [{ label: "GPU", value: "x" }] });
    expect(evaluateEnv(all).some((c) => c.id === "system")).toBe(false);
  });

  describe("detectEnv", () => {
    afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
    it("probes the browser: camera API, WebGL, audio, speech, workers, gamepad, and the Stockfish wasm", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, headers: new Headers({ "content-type": "application/wasm" }) })));
      vi.stubGlobal("AudioContext", class {}); vi.stubGlobal("speechSynthesis", {}); vi.stubGlobal("Worker", class {});
      Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: () => {} }, configurable: true }); Object.defineProperty(navigator, "getGamepads", { value: () => [], configurable: true });
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((k: string) => (k === "webgl2" ? {} : null)) as any);
      expect(await detectEnv()).toMatchObject({ mediaDevices: true, webgl: true, audio: true, speech: true, worker: true, stockfish: true, gamepad: true });
    });
    it("falls back to webgl1, reports a missing wasm (HTML fallback or network error) and absent APIs", async () => {
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((k: string) => (k === "webgl" ? {} : null)) as any);
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, headers: new Headers({ "content-type": "text/html" }) })));
      vi.stubGlobal("AudioContext", undefined); vi.stubGlobal("speechSynthesis", undefined); vi.stubGlobal("Worker", undefined);
      Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true }); Object.defineProperty(navigator, "getGamepads", { value: undefined, configurable: true });
      expect(await detectEnv()).toMatchObject({ mediaDevices: false, webgl: true, audio: false, speech: false, worker: false, stockfish: false, gamepad: false });
      vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
      expect((await detectEnv()).stockfish).toBe(false);
    });
    it("treats a throwing canvas context as no WebGL", async () => {
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => { throw new Error("blocked"); }) as any);
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, headers: new Headers() })));
      expect((await detectEnv()).webgl).toBe(false);
    });
  });
});

describe("camera devices", () => {
  afterEach(() => { Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true }); });
  const mock = (devices: any[], gum: () => Promise<any>) => Object.defineProperty(navigator, "mediaDevices", { value: { enumerateDevices: async () => devices, getUserMedia: vi.fn(gum) }, configurable: true });
  it("lists only video inputs, asking permission first (and releasing the probe stream), naming unlabeled ones", async () => {
    const stop = vi.fn(); mock([{ kind: "videoinput", deviceId: "a", label: "Logitech" }, { kind: "audioinput", deviceId: "m", label: "Mic" }, { kind: "videoinput", deviceId: "b", label: "" }], async () => ({ getTracks: () => [{ stop }] }));
    expect(await listCameras()).toEqual([{ deviceId: "a", label: "Logitech" }, { deviceId: "b", label: "Camera 2" }]); expect(stop).toHaveBeenCalled();
  });
  it("still lists devices when permission is denied, and returns nothing without the API", async () => {
    mock([{ kind: "videoinput", deviceId: "a", label: "" }], async () => { throw new Error("denied"); });
    expect(await listCameras()).toEqual([{ deviceId: "a", label: "Camera 1" }]);
    Object.defineProperty(navigator, "mediaDevices", { value: {}, configurable: true }); expect(await listCameras()).toEqual([]);
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true }); expect(await listCameras()).toEqual([]);
  });
  it("opens a specific device exactly, or the default camera", async () => {
    mock([], async () => "stream");
    expect(await openCamera("dev")).toBe("stream"); expect((navigator.mediaDevices.getUserMedia as any).mock.calls[0][0].video.deviceId).toEqual({ exact: "dev" });
    await openCamera(""); expect((navigator.mediaDevices.getUserMedia as any).mock.calls[1][0].video.deviceId).toBeUndefined();
  });
});
