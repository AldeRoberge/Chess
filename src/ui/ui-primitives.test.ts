import { afterEach, describe, expect, it, vi } from "vitest";
import { openChannel } from "./channel";
import { CornerPicker } from "./cornerPicker";
import { activate, adjust, isFocusable, valueText, type Item } from "./menu";
import { GamepadPoller, keyToAction, padToActions } from "./nav";
import { Sfx } from "./sfx";

describe("menu items", () => {
  const mk = () => { const s = { on: false, c: "b", n: 5, t: "hi", ran: 0 }; const items: Record<string, Item> = {
    action: { kind: "action", label: "go", run: () => { s.ran++; } },
    disabled: { kind: "action", label: "no", disabled: true, run: () => { s.ran++; } },
    toggle: { kind: "toggle", label: "t", get: () => s.on, set: (v) => { s.on = v; } },
    choice: { kind: "choice", label: "c", options: [{ value: "a", label: "AA" }, { value: "b", label: "BB" }, { value: "c", label: "CC" }], get: () => s.c, set: (v) => { s.c = v; } },
    slider: { kind: "slider", label: "s", min: 0, max: 10, step: 2.5, get: () => s.n, set: (v) => { s.n = v; } },
    fmt: { kind: "slider", label: "f", min: 0, max: 1, step: 0.1, get: () => 0.5, set: () => {}, fmt: (v) => `${v * 100}%` },
    text: { kind: "text", label: "x", get: () => s.t, set: (v) => { s.t = v; } },
    info: { kind: "info", label: "i", value: "val" }, bare: { kind: "info", label: "b" },
  }; return { s, items }; };
  it("only non-info items take focus", () => {
    const { items } = mk();
    expect(Object.entries(items).map(([k, v]) => [k, isFocusable(v)])).toEqual([["action", true], ["disabled", true], ["toggle", true], ["choice", true], ["slider", true], ["fmt", true], ["text", true], ["info", false], ["bare", false]]);
  });
  it("renders each kind's value as text", () => {
    const { items } = mk();
    expect(valueText(items.toggle)).toBe("Off"); expect(valueText({ kind: "toggle", label: "t", get: () => true, set: () => {} })).toBe("On"); expect(valueText(items.choice)).toBe("BB"); expect(valueText(items.slider)).toBe("5"); expect(valueText(items.fmt)).toBe("50%"); expect(valueText(items.text)).toBe("hi");
    expect(valueText(items.info)).toBe("val"); expect(valueText(items.bare)).toBe(""); expect(valueText(items.action)).toBe("");
    expect(valueText({ kind: "choice", label: "c", options: [], get: () => "zz", set: () => {} })).toBe("zz"); // unknown value falls back to raw
  });
  it("left/right: toggle flips, choice cycles with wrap both ways, slider steps and clamps, others ignore", () => {
    const { s, items } = mk();
    expect(adjust(items.toggle, 1)).toBe("changed"); expect(s.on).toBe(true); adjust(items.toggle, -1); expect(s.on).toBe(false);
    adjust(items.choice, 1); expect(s.c).toBe("c"); adjust(items.choice, 1); expect(s.c).toBe("a"); adjust(items.choice, -1); expect(s.c).toBe("c");
    adjust(items.slider, 1); expect(s.n).toBe(7.5); adjust(items.slider, 1); expect(s.n).toBe(10); expect(adjust(items.slider, 1)).toBe("none"); adjust(items.slider, -1); expect(s.n).toBe(7.5);
    s.n = 0; expect(adjust(items.slider, -1)).toBe("none");
    for (const k of ["action", "text", "info"]) expect(adjust(items[k], 1)).toBe("none");
  });
  it("enter: actions run (unless disabled), toggles and choices advance, text asks for editing, info does nothing", () => {
    const { s, items } = mk();
    expect(activate(items.action)).toBe("ran"); expect(s.ran).toBe(1);
    expect(activate(items.disabled)).toBe("none"); expect(s.ran).toBe(1);
    expect(activate(items.toggle)).toBe("changed"); expect(s.on).toBe(true);
    expect(activate(items.choice)).toBe("changed"); expect(s.c).toBe("c");
    expect(activate(items.text)).toBe("edit"); expect(activate(items.info)).toBe("none"); expect(activate(items.slider)).toBe("none"); // Enter does not change sliders; use left/right
  });
  it("avoids float noise when stepping sliders by tenths", () => {
    let v = 0; const it: Item = { kind: "slider", label: "s", min: 0, max: 1, step: 0.1, get: () => v, set: (x) => { v = x; } };
    for (let i = 0; i < 3; i++) adjust(it, 1); expect(v).toBe(0.3);
  });
});

describe("navigation input", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("maps keys (arrows, WASD, Enter/Space, Escape/Backspace, paging) to actions", () => {
    expect(keyToAction("ArrowUp")).toBe("up"); expect(keyToAction("s")).toBe("down"); expect(keyToAction("a")).toBe("left"); expect(keyToAction("d")).toBe("right");
    expect(keyToAction("Enter")).toBe("select"); expect(keyToAction(" ")).toBe("select"); expect(keyToAction("Escape")).toBe("back"); expect(keyToAction("Backspace")).toBe("back");
    expect(keyToAction("PageDown")).toBe("next"); expect(keyToAction("PageUp")).toBe("prev"); expect(keyToAction("q")).toBeNull();
  });
  const pad = (pressed: number[] = [], axes: number[] = [0, 0]) => ({ buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: pressed.includes(i) })), axes });
  it("maps gamepad D-pad, left stick, A/Start/B and bumpers", () => {
    expect(padToActions(pad([12]))).toEqual(["up"]); expect(padToActions(pad([13]))).toEqual(["down"]); expect(padToActions(pad([14]))).toEqual(["left"]); expect(padToActions(pad([15]))).toEqual(["right"]);
    expect(padToActions(pad([], [0, -0.9]))).toEqual(["up"]); expect(padToActions(pad([], [0, 0.9]))).toEqual(["down"]); expect(padToActions(pad([], [-0.9, 0]))).toEqual(["left"]); expect(padToActions(pad([], [0.9, 0]))).toEqual(["right"]);
    expect(padToActions(pad([0]))).toEqual(["select"]); expect(padToActions(pad([9]))).toEqual(["select"]); expect(padToActions(pad([1]))).toEqual(["back"]);
    expect(padToActions(pad([4, 5]))).toEqual(["prev", "next"]); expect(padToActions(pad([], [0.3, 0.3]))).toEqual([]);
    expect(padToActions({ buttons: [], axes: [] })).toEqual([]); // sparse pads
  });
  const stubPads = (list: any) => vi.stubGlobal("navigator", { ...navigator, getGamepads: () => list });
  it("fires once on press, repeats directions after the initial delay, never repeats select/back, and re-arms on release", () => {
    const p = new GamepadPoller(400, 100); let current: any = pad([13]); stubPads([null, { connected: true, ...current }]);
    const set = (x: any) => { current = x; stubPads([{ connected: true, ...x }]); };
    set(pad([13])); expect(p.poll(0)).toEqual(["down"]); expect(p.poll(100)).toEqual([]); expect(p.poll(400)).toEqual(["down"]); expect(p.poll(450)).toEqual([]); expect(p.poll(500)).toEqual(["down"]);
    set(pad([])); expect(p.poll(600)).toEqual([]); set(pad([13])); expect(p.poll(700)).toEqual(["down"]);
    set(pad([0, 1])); expect(p.poll(800)).toEqual(["select", "back"]); expect(p.poll(5000)).toEqual([]);
  });
  it("ignores disconnected pads and browsers without the Gamepad API", () => {
    const p = new GamepadPoller();
    stubPads([{ connected: false, ...pad([12]) }]); expect(p.poll(0)).toEqual([]);
    vi.stubGlobal("navigator", {}); expect(p.poll(1)).toEqual([]);
    stubPads(null); expect(p.poll(2)).toEqual([]);
    expect(new GamepadPoller().firstDelay).toBe(380);
  });
});

describe("CornerPicker", () => {
  const corners = () => [{ x: 50, y: 50 }, { x: 400, y: 50 }, { x: 400, y: 300 }, { x: 50, y: 300 }];
  it("grabs the nearest handle within its radius, drags it, clamps to the image and releases", () => {
    const p = new CornerPicker(corners(), 480, 360);
    expect(p.hit(60, 55)).toBe(0); expect(p.hit(200, 200)).toBe(-1); expect(p.down(200, 200)).toBe(false); p.move(10, 10); expect(p.corners[0]).toEqual({ x: 50, y: 50 });
    expect(p.down(395, 52)).toBe(true); expect(p.active).toBe(1); p.move(900, -20); expect(p.corners[1]).toEqual({ x: 480, y: 0 }); p.up(); expect(p.active).toBe(-1);
  });
  it("prefers the closest of overlapping handles", () => {
    const p = new CornerPicker([{ x: 100, y: 100 }, { x: 108, y: 100 }, { x: 300, y: 300 }, { x: 10, y: 300 }], 480, 360, 20);
    expect(p.hit(106, 100)).toBe(1); expect(p.hit(101, 100)).toBe(0);
  });
  it("nudges a handle by keyboard-sized steps", () => { const p = new CornerPicker(corners(), 480, 360); p.nudge(2, -5, 3); expect(p.corners[2]).toEqual({ x: 395, y: 303 }); });
  it("validates quad shape: accepts a clockwise convex board, rejects bow-ties, collinear and counter-ordered nonsense", () => {
    expect(new CornerPicker(corners(), 480, 360).validate()).toBeNull();
    const bow = [{ x: 50, y: 50 }, { x: 400, y: 300 }, { x: 400, y: 50 }, { x: 50, y: 300 }];
    expect(new CornerPicker(bow, 480, 360).validate()).toContain("convex");
    const line = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 }];
    expect(new CornerPicker(line, 480, 360).validate()).toContain("collinear");
  });
});

describe("Sfx", () => {
  class FakeAC { static made: FakeAC[] = []; currentTime = 1; state = "suspended"; destination = {}; osc: any[] = []; resumed = 0; constructor() { FakeAC.made.push(this); } resume() { this.resumed++; return Promise.resolve(); }
    createOscillator() { const o: any = { type: "", frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect(n: any) { return n; }, start: vi.fn(), stop: vi.fn() }; this.osc.push(o); return o; }
    createGain() { return { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect(n: any) { return n; } }; } }
  afterEach(() => { vi.unstubAllGlobals(); FakeAC.made = []; });
  it("is silent without Web Audio and when muted", () => {
    const s = new Sfx(); expect(() => s.play("ok")).not.toThrow();
    vi.stubGlobal("AudioContext", FakeAC); s.muted = true; s.play("ok"); expect(FakeAC.made).toHaveLength(0);
  });
  it.each([["tick", 1], ["ok", 2], ["back", 1], ["deny", 1], ["launch", 4]] as const)("%s plays %i tone(s) and wakes a suspended context", (k, n) => {
    vi.stubGlobal("AudioContext", FakeAC); const s = new Sfx(); s.play(k);
    expect(FakeAC.made[0].osc).toHaveLength(n); expect(FakeAC.made[0].resumed).toBe(n); // every tone nudges a suspended context
    if (k === "back") expect(FakeAC.made[0].osc[0].frequency.exponentialRampToValueAtTime).toHaveBeenCalled();
    s.play(k); expect(FakeAC.made).toHaveLength(1);
  });
  it("does not resume a running context", () => {
    vi.stubGlobal("AudioContext", class extends FakeAC { state = "running"; }); new Sfx().play("tick"); expect(FakeAC.made[0].resumed).toBe(0);
  });
});

describe("channel", () => {
  it("opens the shared BroadcastChannel", () => {
    vi.stubGlobal("BroadcastChannel", class { constructor(public name: string) {} });
    expect((openChannel() as any).name).toBe("chess-experience"); vi.unstubAllGlobals();
  });
});
