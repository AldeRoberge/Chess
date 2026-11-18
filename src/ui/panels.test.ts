import { Chess } from "chess.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bus } from "../core/bus";
import { Graph } from "../core/graph";
import { createRegistry } from "../plugins";
import { applyH, solveHomography } from "../vision/homography";
import { virtualTable } from "../sim/virtualTable";
import { initialSceneState } from "../scene/types";
import { defaultMapping, loadMapping } from "../mapping/store";
import { tick } from "../test/helpers";

const view = vi.hoisted(() => ({ made: [] as any[] }));
vi.mock("../world/view", () => ({ WorldView: class { showFrusta = true; showProjection = true; cfg: any; renders = 0; mappings: any[] = []; constructor(public canvas: any, cfg: any) { this.cfg = cfg; view.made.push(this); } setMapping(c: any) { this.mappings.push(c); } render() { this.renders++; } } }));
const gltf = vi.hoisted(() => ({ scene: null as any, fail: false }));
vi.mock("three/examples/jsm/loaders/GLTFLoader.js", () => ({ GLTFLoader: class { async parseAsync() { if (gltf.fail) throw new Error("bad glb"); return { scene: gltf.scene }; } } }));

import { LogPanel, TablePanel, WorldPanel } from "./panels";

class FakeChannel { static all: FakeChannel[] = []; sent: any[] = []; onmessage: ((e: { data: any }) => void) | null = null; constructor(public name: string) { FakeChannel.all.push(this); } postMessage(m: any) { this.sent.push(m); } }

beforeEach(() => {
  vi.stubGlobal("BroadcastChannel", FakeChannel); FakeChannel.all = []; view.made.length = 0; localStorage.clear();
  virtualTable.reset(); virtualTable.seated = false; virtualTable.pointer = null;
  Object.assign(bus, { game: null, director: null, board: null, engineHint: null, scene: null, lines: [], events: [], cameras: [] });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("TablePanel", () => {
  const rect = (cv: HTMLCanvasElement) => vi.spyOn(cv, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 616, height: 616, right: 616, bottom: 616, x: 0, y: 0, toJSON() {} });
  const at = (cv: HTMLCanvasElement, type: string, file: number, rank: number) => cv.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: (file + 3) * 44, clientY: (rank + 3) * 44 }));
  const click = (cv: HTMLCanvasElement, col: number, row: number) => at(cv, "click", col + 0.5, row + 0.5);

  it("has sit/stand and reset controls and a help line", () => {
    const p = new TablePanel(), seat = vi.fn(); p.seatCb = seat;
    const [sit, reset] = p.root.querySelectorAll("button");
    sit.click(); expect(virtualTable.seated).toBe(true); expect(seat).toHaveBeenCalledWith(true); sit.click(); expect(seat).toHaveBeenLastCalledWith(false);
    virtualTable.game.move("e4"); reset.click(); expect(virtualTable.game.fen()).toBe(new Chess().fen());
    expect(p.root.querySelector(".muted")!.textContent).toContain("Click a piece");
    new TablePanel().seatCb(true); // default callback is a no-op
  });
  it("plays a move by clicking the piece, then a legal square; clicking elsewhere cancels; empty or off-board clicks are ignored", () => {
    const p = new TablePanel(), cv = p.root.querySelector("canvas")!; rect(cv);
    click(cv, 4, 6); click(cv, 4, 4); expect(virtualTable.busy).toBe(true);
    virtualTable.reset();
    click(cv, 4, 4); // empty square, nothing selected
    click(cv, 4, 6); click(cv, 4, 3); expect(virtualTable.busy).toBe(false); // illegal destination cancels
    click(cv, 4, 6); click(cv, 4, 5); expect(virtualTable.busy).toBe(true);
    virtualTable.reset(); at(cv, "click", -1, 3); at(cv, "click", 3, 9); at(cv, "click", 9, 3); at(cv, "click", 3, -1); expect(virtualTable.busy).toBe(false);
  });
  it("tracks the mouse as the player's pointer over the table, margins included, and drops it on leave", () => {
    const p = new TablePanel(), cv = p.root.querySelector("canvas")!; rect(cv);
    at(cv, "mousemove", 4, 9); expect(virtualTable.pointer!.x).toBeCloseTo(4); expect(virtualTable.pointer!.y).toBeCloseTo(9);
    cv.dispatchEvent(new MouseEvent("mouseleave")); expect(virtualTable.pointer).toBeNull();
  });
  it("draws pieces, selection, the carried piece's hand and the overlay, and narrates state in the info line", () => {
    const p = new TablePanel(), cv = p.root.querySelector("canvas")!, ctx = cv.getContext("2d")!, text = vi.spyOn(ctx, "fillText"); rect(cv);
    p.frame(0); expect(text).toHaveBeenCalledTimes(48); expect(p.root.querySelector(".muted")!.textContent).toBe("idle · tracker: — · ");
    click(cv, 4, 6); virtualTable.carried = 52; virtualTable.hand = { x: 4.5, y: 5 }; text.mockClear(); p.frame(16); expect(text).toHaveBeenCalledTimes(47);
    bus.director = { phase: "game", mode: "engine", elo: 1500, menu: [], progress: {}, events: [], seat: null } as any; bus.game = { status: "synced", history: ["e4", "e5"], last: null, lifted: undefined, diff: [] } as any;
    p.frame(32); expect(p.root.querySelector(".muted")!.textContent).toBe("game · Stockfish 1500 · tracker: synced · e4 e5");
    bus.director = { ...bus.director, mode: "human" } as any; p.frame(48); expect(p.root.querySelector(".muted")!.textContent).toContain("2 joueurs");
  });
});

describe("LogPanel", () => {
  it("shows camera health chips, narration (newest first, colour by voice) and events; re-renders only on change", () => {
    const p = new LogPanel(); p.frame(); expect(p.root.querySelector(".chips")!.textContent).toBe("no camera online");
    bus.cameras = [{ id: "A", online: true, quality: 0.9, reliability: 0.8 }];
    bus.lines = [{ speaker: "A", name: "Jean", text: "Bonjour", t: 0, priority: 1 }, { speaker: "B", name: "Margot", text: "Salut", t: 1, priority: 1 }];
    bus.events = [{ type: "move", t: 0, data: { san: "e4" } }, { type: "seat", t: 0 }];
    p.frame(); expect(p.root.querySelector(".chips")!.textContent).toContain("cam A · q 90% · trust 80%");
    const lns = [...p.root.querySelectorAll(".ln")]; expect(lns.map((l) => l.className)).toEqual(["ln B", "ln A"]); expect(p.root.querySelectorAll(".evt")).toHaveLength(2); expect(p.root.querySelector(".evt")!.textContent).toContain("seat");
    const html = p.root.querySelector(".lines")!.innerHTML; p.frame(); expect(p.root.querySelector(".lines")!.innerHTML).toBe(html);
    bus.lines.push({ speaker: "A", name: "Jean", text: "Encore", t: 2, priority: 1 }); p.frame(); expect(p.root.querySelectorAll(".ln")).toHaveLength(3);
  });
});

describe("WorldPanel", () => {
  const graphWith = (online = true) => { const g = new Graph(createRegistry()); const cam = g.addNode("source.webcam", 0, 0, { online }); return { g, cam }; };
  const make = (online = true) => { const { g, cam } = graphWith(online); const p = new WorldPanel(g); return { p, g, cam, v: view.made[0], ch: FakeChannel.all[0], status: () => (p as any).status.textContent as string }; };
  const btn = (p: WorldPanel, text: string, nth = 0) => [...p.root.querySelectorAll<HTMLElement>("button, .btn")].filter((b) => b.textContent!.startsWith(text))[nth];

  it("builds the 3D view from the saved mapping and lists a rig row per projector", () => {
    const { p, v } = make(); expect(v.cfg.projectors).toHaveLength(3); expect(p.root.querySelectorAll(".rig-row")).toHaveLength(3); expect(p.root.querySelector(".rig-row b")!.textContent).toBe("wall-L");
    p.frame(123); expect(v.renders).toBe(1);
  });
  it("toggles frusta and projected content on the view, and can restore the default room", () => {
    const { p, v } = make(); const [frusta, content] = p.root.querySelectorAll<HTMLInputElement>(".chk input");
    frusta.checked = false; frusta.dispatchEvent(new Event("change")); expect(v.showFrusta).toBe(false);
    content.checked = false; content.dispatchEvent(new Event("change")); expect(v.showProjection).toBe(false); expect(v.mappings.length).toBe(1);
    btn(p, "Default room").click(); expect(v.mappings.length).toBe(2); expect(loadMapping().surfaces).toHaveLength(6); expect(FakeChannel.all[0].sent.at(-1)).toEqual({ type: "mapping" });
  });
  it("opens an output window per projector and relays messages through the channel", () => {
    const open = vi.spyOn(window, "open").mockReturnValue({ closed: false } as any); const { p, ch } = make();
    btn(p, "Open output", 1).click(); expect(open).toHaveBeenCalledWith("?output=1", "cx-out-1", expect.stringContaining("popup")); p.post({ type: "state" }); expect(ch.sent.at(-1)).toEqual({ type: "state" });
    ch.onmessage!({ data: { type: "size", index: 1, w: 1280, h: 720 } }); ch.onmessage!({ data: { type: "other" } }); expect((p as any).projSize.get(1)).toEqual({ w: 1280, h: 720 });
  });
  it("auto-calibration refuses without an open output window or without an online webcam", async () => {
    const { p, status } = make(); btn(p, "Auto-calibrate").click(); await tick(); expect(status()).toContain("Open the output window");
    vi.spyOn(window, "open").mockReturnValue({ closed: true } as any); btn(p, "Open output").click(); btn(p, "Auto-calibrate").click(); await tick(); expect(status()).toContain("Open the output window"); // closed window
    const off = make(false); vi.spyOn(window, "open").mockReturnValue({ closed: false } as any); btn(off.p, "Open output").click(); btn(off.p, "Auto-calibrate").click(); await tick(); expect(off.status()).toContain("Webcam node Online");
  });
  it("runs the dot sequence, fits the camera->projector mapping and reports the quality; a blind camera fails with advice", async () => {
    vi.useFakeTimers(); vi.spyOn(window, "open").mockReturnValue({ closed: false } as any);
    const { p, g, cam, ch, status } = make(); btn(p, "Open output").click();
    const truth = solveHomography([{ x: 0, y: 0 }, { x: 1280, y: 0 }, { x: 1280, y: 720 }, { x: 0, y: 720 }], [{ x: 80, y: 60 }, { x: 560, y: 50 }, { x: 540, y: 400 }, { x: 100, y: 420 }]);
    let whiteLit = true;
    const mk = (f: (x: number, y: number) => number) => { const d = new Uint8ClampedArray(640 * 480); for (let y = 0; y < 480; y++) for (let x = 0; x < 640; x++) d[y * 640 + x] = f(x, y); return { width: 640, height: 480, data: d, t: 0 }; };
    const tracker = setInterval(() => { // the "camera": reacts to the last command the panel sent
      const cmd = ch.sent.filter((m) => m.type === "calib").at(-1)?.cmd; if (!cmd) return;
      g.outputs.set(cam.id, { frame: cmd.kind === "dot" ? (() => { const c = applyH(truth, cmd.x, cmd.y); return mk((x, y) => (Math.hypot(x - c.x, y - c.y) < 4 ? 230 : 4)); })() : cmd.kind === "white" && whiteLit ? mk((x, y) => (x > 80 && x < 560 && y > 55 && y < 410 ? 200 : 4)) : mk(() => 4) });
    }, 10);
    const done = btn(p, "Auto-calibrate").click(); void done; await vi.advanceTimersByTimeAsync(450 * 30);
    expect(status()).toMatch(/wall-L calibrated: 20 dots, RMS [0-9.]+px, footprint found/); expect(btn(p, "Re-calibrate")).toBeTruthy(); expect(loadMapping().calibration["wall-L"].camToProj).toHaveLength(9); expect(ch.sent.at(-1)).toEqual({ type: "calib", cmd: { kind: "end" } });
    whiteLit = false; const t2 = setInterval(() => {}, 10); btn(p, "Re-calibrate").click(); await vi.advanceTimersByTimeAsync(450 * 30); clearInterval(t2); expect(status()).not.toContain("footprint"); expect(status()).toContain("calibrated");
    clearInterval(tracker); // blind camera: no frames at all
    g.outputs.set(cam.id, { frame: null }); btn(p, "Re-calibrate").click(); await vi.advanceTimersByTimeAsync(450 * 3); expect(status()).toContain("Calibration failed");
  });
  it("imports an OBJ room scan, recentres it on the floor, and maps its planes", async () => {
    const { p, v, status } = make(); const lines: string[] = []; const N = 20, id = (i: number, j: number) => i * N + j + 1;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) lines.push(`v ${5 + i * 0.2} ${2 + 0} ${3 + j * 0.2}`);
    for (let i = 0; i < N - 1; i++) for (let j = 0; j < N - 1; j++) lines.push(`f ${id(i, j)} ${id(i + 1, j)} ${id(i, j + 1)}`, `f ${id(i + 1, j)} ${id(i + 1, j + 1)} ${id(i, j + 1)}`);
    const file = Object.assign(new File([lines.join("\n")], "room.obj"), { arrayBuffer: async () => new TextEncoder().encode(lines.join("\n")).buffer });
    const input = p.root.querySelector<HTMLInputElement>("input[type=file]")!; Object.defineProperty(input, "files", { value: [file], configurable: true }); input.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(status()).toContain("Scan mapped"));
    expect(status()).toContain("floor"); expect(v.mappings.at(-1).surfaces[0].center[1]).toBeCloseTo(0, 2); expect(loadMapping().surfaces.length).toBe(1);
  });
  it("imports a GLB scan (any glTF), and says so when it finds no planes", async () => {
    const THREE = await import("three"); const { p, status } = make();
    const mesh = (pts: number[]) => { const m = new THREE.Mesh(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pts, 3))); const grp = new THREE.Group(); grp.add(m); return grp; };
    const wall: number[] = []; for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) wall.push(i * 0.2, j * 0.15, 0);
    const send = async (name: string) => { const file = Object.assign(new File(["x"], name), { arrayBuffer: async () => new ArrayBuffer(8) }); const input = p.root.querySelector<HTMLInputElement>("input[type=file]")!; Object.defineProperty(input, "files", { value: [file], configurable: true }); input.dispatchEvent(new Event("change")); };
    gltf.scene = mesh(wall); await send("room.glb"); await vi.waitFor(() => expect(status()).toContain("wall"));
    gltf.scene = mesh([0, 0, 0, 1, 1, 1, 2, 0, 5]); await send("tiny.gltf"); await vi.waitFor(() => expect(status()).toContain("No planar surfaces"));
    gltf.scene = new THREE.Group(); await send("empty.glb");
  });
  it("ignores a file input event with no file", () => { const { p, status } = make(); const input = p.root.querySelector<HTMLInputElement>("input[type=file]")!; Object.defineProperty(input, "files", { value: [], configurable: true }); input.dispatchEvent(new Event("change")); expect(status()).toBe(""); });
  it("uses a saved mapping when there is one", () => { const m = defaultMapping(); m.projectors = m.projectors.slice(0, 1); localStorage.setItem("cx.mapping.v1", JSON.stringify(m)); const { p } = make(); expect(p.root.querySelectorAll(".rig-row")).toHaveLength(1); });
  it("exposes the scene for completeness", () => { expect(initialSceneState().scene).toBe("cavern"); });
});
