import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultMapping, saveMapping } from "./mapping/store";
import { initialSceneState } from "./scene/types";

const out = vi.hoisted(() => ({ made: [] as any[] }));
vi.mock("./world/output", () => ({ ProjectorOutput: class { renders: any[] = []; sizes: number[][] = []; rebuilds: any[] = []; constructor(public canvas: any, public cfg: any, public index: number, public quality: number) { out.made.push(this); } resize(w: number, h: number) { this.sizes.push([w, h]); } render(...a: any[]) { this.renders.push(a); } rebuild(...a: any[]) { this.rebuilds.push(a); } } }));
import { startOutputPage } from "./outputPage";

class Chan { static all: Chan[] = []; sent: any[] = []; onmessage: ((e: { data: any }) => void) | null = null; constructor() { Chan.all.push(this); } postMessage(m: any) { this.sent.push(m); } }
let frames: ((t: number) => void)[];
beforeEach(() => { document.body.innerHTML = ""; out.made.length = 0; Chan.all = []; frames = []; localStorage.clear(); vi.stubGlobal("BroadcastChannel", Chan); vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => { frames.push(cb); return 1; }); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const boot = (i = 0) => { startOutputPage(i); return { o: out.made[0], ch: Chan.all[0], frame: (t = 0) => frames.shift()!(t), cal: document.getElementById("c") as HTMLCanvasElement }; };

describe("projector output page", () => {
  it("builds a black fullscreen-ready page, reports its pixel size to the control window, and renders frames continuously", () => {
    const { o, ch, frame } = boot(1);
    expect(document.body.className).toBe("output"); expect(document.querySelector(".hint")!.textContent).toContain("Projector 1"); expect(o.index).toBe(1); expect(o.quality).toBe(1);
    expect(o.sizes[0]).toEqual([window.innerWidth, window.innerHeight]); expect(ch.sent[0]).toEqual({ type: "size", index: 1, w: window.innerWidth, h: window.innerHeight });
    frame(10); frame(20); expect(o.renders).toHaveLength(2); expect(o.renders[1][2]).toBe(20); expect(frames).toHaveLength(1);
  });
  it("clamps the projector index to the configured rig and re-reports on resize", () => {
    const { o, ch } = boot(9); expect(o.index).toBe(defaultMapping().projectors.length - 1);
    window.dispatchEvent(new Event("resize")); expect(o.sizes).toHaveLength(2); expect(ch.sent).toHaveLength(2);
  });
  it("renders what the control window sends: scene state and overlay inputs", () => {
    const { o, ch, frame } = boot(); const scene = initialSceneState("winter-forest"), overlay = { game: null, director: null, hint: { from: "e2", to: "e4" } };
    ch.onmessage!({ data: { type: "state", scene, overlay } }); frame(5);
    expect(o.renders[0][0]).toBe(scene); expect(o.renders[0][1]).toBe(overlay);
  });
  it("shows calibration patterns instead of the scene: white, black, scaled dots, and back to normal on 'end'", () => {
    const { o, ch, frame, cal } = boot(); const c = cal.getContext("2d")!, fill = vi.spyOn(c, "fillRect"), arc = vi.spyOn(c, "arc");
    ch.onmessage!({ data: { type: "calib", cmd: { kind: "white" } } }); frame(); expect(cal.style.display).toBe("block"); expect(fill).toHaveBeenLastCalledWith(0, 0, cal.width, cal.height); expect(o.renders).toHaveLength(0);
    ch.onmessage!({ data: { type: "calib", cmd: { kind: "black" } } }); frame(); expect(arc).not.toHaveBeenCalled();
    ch.onmessage!({ data: { type: "calib", cmd: { kind: "dot", x: 640, y: 360 } } }); frame(); expect(arc).toHaveBeenCalledWith(cal.width / 2, cal.height / 2, expect.any(Number), 0, 7);
    ch.onmessage!({ data: { type: "calib", cmd: { kind: "end" } } }); frame(); expect(cal.style.display).toBe("none"); expect(o.renders).toHaveLength(1);
  });
  it("rebuilds when the mapping changes, reading the saved configuration", () => {
    const { o, ch } = boot(2); const m = defaultMapping(); m.projectors = m.projectors.slice(0, 2); saveMapping(m);
    ch.onmessage!({ data: { type: "mapping" } }); expect(o.rebuilds[0][0].projectors).toHaveLength(2); expect(o.rebuilds[0][1]).toBe(1);
  });
  it("ignores other windows' size reports on the shared channel", () => {
    const { o, ch } = boot(); ch.onmessage!({ data: { type: "size", index: 3, w: 1, h: 1 } }); expect(o.rebuilds).toHaveLength(0);
  });
  it("double-click requests fullscreen where supported, and is harmless where not", () => {
    boot(); const req = vi.fn(); (document.documentElement as any).requestFullscreen = req;
    document.dispatchEvent(new MouseEvent("dblclick")); expect(req).toHaveBeenCalled();
    delete (document.documentElement as any).requestFullscreen; expect(() => document.dispatchEvent(new MouseEvent("dblclick"))).not.toThrow();
  });
});
