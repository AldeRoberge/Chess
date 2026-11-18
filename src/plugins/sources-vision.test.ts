import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRegistry } from "./index";
import { VirtualTable, virtualTable } from "../sim/virtualTable";
import { bus } from "../core/bus";
import { RIGS, rigCorners } from "../sim/rigs";
import { flatFrame, node, shoot, tick } from "../test/helpers";
import { CAM_PRESETS, drawBoard, drawFrame, fmtCorners, parseCorners } from "./shared";

describe("shared painters and parsers", () => {
  it("presets come from the three camera rigs", () => { expect(Object.keys(CAM_PRESETS)).toEqual(["A", "B", "C"]); expect(CAM_PRESETS.A).toEqual(rigCorners(RIGS.A)); });
  it("parses and formats corner lists, rejecting malformed ones", () => {
    expect(parseCorners("1,2;3,4;5,6;7,8")).toEqual([{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }, { x: 7, y: 8 }]);
    for (const bad of ["", "1,2;3,4;5,6", "1,2;3,4;5,6;7", "a,b;c,d;e,f;g,h", "1,2,3;4,5;6,7;8,9"]) expect(parseCorners(bad)).toBeNull();
    expect(fmtCorners([{ x: 1.4, y: 2.6 }, { x: 3, y: 4 }, { x: 5, y: 6 }, { x: 7, y: 8 }])).toBe("1,3;3,4;5,6;7,8");
  });
  it("drawFrame paints an offline notice, or the image", () => {
    const c = document.createElement("canvas").getContext("2d")!; const text = vi.spyOn(c, "fillText"), put = vi.spyOn(c, "drawImage");
    drawFrame(c, 100, 80, null, "no signal"); expect(text).toHaveBeenCalledWith("no signal", expect.any(Number), expect.any(Number));
    drawFrame(c, 100, 80, undefined); expect(text).toHaveBeenLastCalledWith("offline", expect.any(Number), expect.any(Number));
    drawFrame(c, 100, 80, flatFrame(120, 8, 6)); expect(put).toHaveBeenCalled();
  });
  it("drawBoard paints the 64 squares, pieces by colour, doubt markers, and diff outlines", () => {
    const c = document.createElement("canvas").getContext("2d")!, arc = vi.spyOn(c, "arc"), stroke = vi.spyOn(c, "strokeRect");
    const occ = new Float32Array(64), white = new Float32Array(64), conf = new Float32Array(64).fill(1);
    occ[0] = 1; white[0] = 1; occ[1] = 1; white[1] = 0; conf[10] = 0.1;
    drawBoard(c, 160, 160, { occ, white, conf }, { diff: [3, 4] });
    expect(arc).toHaveBeenCalledTimes(2); expect(stroke).toHaveBeenCalledTimes(2);
    drawBoard(c, 160, 160, null); drawBoard(c, 160, 160, { occ, white }); // no belief; no confidences
  });
});

describe("source.synthetic (3D virtual camera)", () => {
  beforeEach(() => virtualTable.reset());
  it("stays dark when offline", () => {
    const n = node("source.synthetic", { online: false });
    expect(n.run()).toEqual({ frame: null }); expect(n.h.fidelity).toBeNull();
  });
  it("renders the virtual table from its rig, honouring the frame-rate cap", () => {
    const n = node("source.synthetic", { cam: "B", fps: 5, noise: 0 });
    const a = n.run({}, 1000)!.frame; n.h.fidelity = undefined; const same = n.run({}, 1050)!.frame;
    expect(n.h.fidelity).toBe(1); // a reused frame still reports fidelity, so the node label doesn't flicker between renders
    const b = n.run({}, 1300)!.frame;
    expect(a.width).toBe(480); expect(same).toBe(a); expect(b).not.toBe(a); expect(n.h.fidelity).toBe(1);
  });
  it("re-casts rays only when the scene changed, re-noising otherwise", () => {
    const n = node("source.synthetic", { fps: 20 }); n.run({}, 0);
    const lum1 = (n.state as any).lum; n.run({}, 100); expect((n.state as any).lum).toBe(lum1);
    virtualTable.hand = { x: 3, y: 3 }; n.run({}, 200); expect((n.state as any).lum).not.toBe(lum1);
  });
  it("paints its preview", () => { const n = node("source.synthetic"); n.run({}, 0); const c = n.paint(); expect(c).toBeTruthy(); });
});

describe("source.webcam", () => {
  const rgba = (r: number, g: number, b: number) => { const d = new Uint8ClampedArray(480 * 360 * 4); for (let i = 0; i < d.length; i += 4) { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; } return d; };
  let tracks: { stop: ReturnType<typeof vi.fn>; onended: null | (() => void) }[];
  const spies: { mockRestore(): void }[] = [];
  const cleanup = () => { while (spies.length) spies.pop()!.mockRestore(); Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true }); };
  const setup = (opts: { devices?: any[]; fail?: boolean } = {}) => {
    tracks = [{ stop: vi.fn(), onended: null }];
    const stream = { getTracks: () => tracks, getVideoTracks: () => tracks };
    const gum = vi.fn(async (_c: any) => { if (opts.fail) throw new Error("denied"); return stream; });
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: gum, enumerateDevices: async () => opts.devices ?? [] }, configurable: true });
    let px: Uint8ClampedArray<ArrayBufferLike> = rgba(10, 200, 30);
    spies.push(vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined));
    spies.push(vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ({ drawImage() {}, getImageData: () => ({ data: px }), fillRect() {}, fillText() {}, createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} })) as any));
    return { gum, set: (d: Uint8ClampedArray) => { px = d; } };
  };
  afterEach(cleanup);

  it("does nothing when offline and releases a running stream when switched off", async () => {
    setup(); const n = node("source.webcam", { fps: 30 });
    n.run({}, 0); await tick(); n.run({}, 100);
    expect(n.h.fidelity).toBe(1); n.params.online = false;
    expect(n.run({}, 200)).toEqual({ frame: null }); expect(tracks[0].stop).toHaveBeenCalled(); expect(n.h.fidelity).toBeNull();
    n.params.online = false; expect(n.run({}, 300)).toEqual({ frame: null }); // already stopped
  });
  it("opens the default camera, grabs luma frames at the capped rate", async () => {
    const { gum } = setup(); const n = node("source.webcam", { fps: 10 });
    expect(n.run({}, 0)!.frame).toBeNull(); expect(n.h.fidelity).toBe(0);
    await tick(); const f = n.run({}, 1000)!.frame;
    expect(gum).toHaveBeenCalledTimes(1); expect(f.width).toBe(480); expect(f.data[0]).toBe(Math.round(10 * 0.299 + 200 * 0.587 + 30 * 0.114));
    expect(n.run({}, 1050)!.frame).toBe(f); expect(n.run({}, 1200)!.frame).not.toBe(f);
  });
  it.each([["red", 10], ["green", 200], ["blue", 30]])("extracts the %s channel (IR cameras)", async (channel, v) => {
    setup(); const n = node("source.webcam", { channel, fps: 30 }); n.run({}, 0); await tick();
    expect(n.run({}, 1000)!.frame.data[5]).toBe(v);
  });
  it("selects a device by exact id or label substring, otherwise the default", async () => {
    const devices = [{ kind: "videoinput", deviceId: "id-1", label: "Logitech C920" }, { kind: "audioinput", deviceId: "m", label: "Mic" }];
    for (const [want, exact] of [["id-1", "id-1"], ["c920", "id-1"], ["nothing", undefined], ["", undefined]] as const) {
      const { gum } = setup({ devices }); const n = node("source.webcam", { device: want }); n.run({}, 0); await tick();
      expect(gum.mock.calls[0][0].video.deviceId?.exact).toBe(exact); cleanup(); // one spy layer per iteration
    }
  });
  it("reports errors on the preview, and tolerates a missing camera API", async () => {
    setup({ fail: true }); const n = node("source.webcam"); n.run({}, 0); await tick(); n.run({}, 100);
    expect((n.state as any).err).toContain("denied"); n.paint();
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
    const m = node("source.webcam"); expect(m.run({}, 0)).toEqual({ frame: null }); m.paint();
  });
  it("goes offline by itself when the camera is unplugged, and releases on dispose", async () => {
    setup(); const n = node("source.webcam", { fps: 30 }); n.run({}, 0); await tick(); n.run({}, 1000);
    tracks[0].onended!(); expect((n.state as any).stream).toBeNull();
    const m = node("source.webcam"); m.run({}, 0); await tick(); m.dispose(); expect(tracks[0].stop).toHaveBeenCalled();
    expect(() => node("source.webcam").dispose()).not.toThrow();
  });
  it("paints the live image once it has a frame", async () => { setup(); const n = node("source.webcam", { fps: 30 }); n.run({}, 0); await tick(); n.run({}, 1000); n.paint(); });
});

describe("vision.boardReader", () => {
  const table = new VirtualTable();
  it("emits nothing without a frame", () => {
    const n = node("vision.boardReader"); expect(n.run({})).toEqual({ obs: null }); expect(n.h.fidelity).toBeNull(); n.paint();
  });
  it("auto-learns the start position on the first frame, then reads pieces with trust applied; one read per camera frame", () => {
    const n = node("vision.boardReader", { cam: "A", corners: fmtCorners(rigCorners(RIGS.A)), weight: 1.5 });
    const f = shoot(table, "A", 100);
    const o = n.run({ frame: f })!.obs; expect(o.weight).toBe(1.5); expect(o.occ[0]).toBeGreaterThan(0.9); expect(o.occ[27]).toBeLessThan(0.1); expect(n.h.fidelity).toBeGreaterThan(0.9);
    expect(n.run({ frame: f })!.obs).toBe(o); // same frame time: cached
    expect(n.run({ frame: shoot(table, "A", 200, 6, 2) })!.obs).not.toBe(o);
  });
  it("honours manual 'learn' (and clears it), a disabled auto-learn, a threshold change, and corner edits (ignoring garbage)", () => {
    const n = node("vision.boardReader", { corners: fmtCorners(rigCorners(RIGS.A)), autoCal: false });
    expect(n.run({ frame: shoot(table, "A", 1) })!.obs.occ[0]).toBe(0.5); // never calibrated
    n.params.learn = true; n.run({ frame: shoot(table, "A", 2, 6, 2) }); expect(n.params.learn).toBe(false);
    expect(n.run({ frame: shoot(table, "A", 3, 6, 3) })!.obs.occ[0]).toBeGreaterThan(0.9);
    n.params.threshold = 0.4; n.params.corners = "bogus"; n.run({ frame: shoot(table, "A", 4, 6, 4) });
    expect((n.state as any).sampler.cfg.threshold).toBe(0.4); expect((n.state as any).sampler.cfg.corners).toHaveLength(4);
    n.params.corners = fmtCorners(rigCorners(RIGS.B)); n.run({ frame: shoot(table, "B", 5, 6, 5) });
  });
  it("paints the preview with corner outline and hand markers", () => {
    const n = node("vision.boardReader", { corners: fmtCorners(rigCorners(RIGS.A)) });
    n.run({ frame: shoot(table, "A", 1) }); n.paint();
    const t = new VirtualTable(); t.play("e4", 0); t.tick(0); t.tick(500); t.tick(900);
    n.run({ frame: shoot(t, "A", 2, 6, 2) }); n.paint();
  });
});

describe("vision.fuse + vision.stabilize", () => {
  const obs = (cam: string, t: number) => { const table = new VirtualTable(); const n = node("vision.boardReader", { cam, corners: fmtCorners(rigCorners(RIGS[cam])) }); return n.run({ frame: shoot(table, cam, t) })!.obs; };
  it("fuses connected cameras, publishes their health on the bus, and ignores empty ports", () => {
    const f = node("vision.fuse");
    expect(f.run({})!.board.cams).toBe(0); expect(bus.cameras).toEqual([]);
    const out = f.run({ o1: obs("A", 1000), o2: obs("B", 1000), o3: null }, 1000)!.board;
    expect(out.cams).toBe(2); expect(bus.cameras.map((c) => c.id)).toEqual(["A", "B"]); expect(f.h.fidelity).toBe(out.fidelity); f.paint();
  });
  it("reports a default trust for a camera that has only ever been occluded", () => {
    const f = node("vision.fuse"); f.run({ o1: { ...obs("A", 1000), motion: 0.9 } }, 1000);
    expect(bus.cameras[0].reliability).toBe(0.8);
  });
  it("uses the graph clock when an observation carries no timestamp, and drops cameras that stop updating", () => {
    const f = node("vision.fuse", { staleMs: 300 });
    const o = { ...obs("A", 0), t: 0 };
    expect(f.run({ o1: o }, 5000)!.board.cams).toBe(1);
    expect(f.run({ o1: { ...o, t: 1 } }, 5000)!.board.cams).toBe(0); // 4999 ms old
  });
  it("stabilizes with the node's parameters, ignores a missing board, and shows hand / settled lamps", () => {
    const s = node("vision.stabilize", { memory: 0.5, hysteresis: 2, settleMs: 200, holdOnHand: false });
    expect(s.run({})).toEqual({ board: null }); s.paint();
    const f = node("vision.fuse"); let out: any;
    for (let t = 0; t < 1500; t += 100) out = s.run({ board: f.run({ o1: obs("A", t), o2: obs("B", t) }, t)!.board }, t)!.board;
    expect(out.settled).toBe(true); expect(bus.board).toBe(out); s.paint();
    const c = (s.state as any).stab.cfg; expect(c).toMatchObject({ decay: 0.5, on: 2, off: -2, settleMs: 200, holdOnHand: false });
    const hand = { ...out, handOver: true, settled: false }; (s.state as any).out = hand; s.paint(); (s.state as any).out = { ...out, settled: false, handOver: false }; s.paint();
  });
});

it("registers every source and vision node type once", () => {
  const types = createRegistry().all().map((s) => s.type);
  expect(new Set(types).size).toBe(types.length);
  expect(types).toEqual(expect.arrayContaining(["source.webcam", "source.synthetic", "vision.boardReader", "vision.fuse", "vision.stabilize"]));
});
