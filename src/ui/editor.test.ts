import { collectItems } from "./contextMenu";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Graph } from "../core/graph";
import { Registry, type NodeSpec } from "../core/types";
import { NodeEditor, PORT_COLOR } from "./editor";

const spec = (over: Partial<NodeSpec> & { type: string }): NodeSpec => ({ title: over.type.toUpperCase(), category: "Game", inputs: [], outputs: [], process: () => undefined, ...over });
const registry = () => {
  const r = new Registry(); const painted = vi.fn();
  r.register(spec({ type: "src", category: "Source", outputs: [{ id: "o", type: "frame", label: "image" }], params: [
    { id: "n", kind: "number", label: "Amount", min: 0, max: 10, step: 1, value: 3 }, { id: "nostep", kind: "number", label: "Fine", min: 0, max: 1, value: 0.5 }, { id: "b", kind: "bool", label: "Flag", value: false },
    { id: "s", kind: "select", label: "Mode", options: ["x", "y"], value: "x" }, { id: "t", kind: "text", label: "Name", value: "hi" } ],
    process: () => ({ o: { w: 1 } }), preview: painted, previewSize: [50, 30] }));
  r.register(spec({ type: "mid", category: "Vision", inputs: [{ id: "i", type: "frame" }], outputs: [{ id: "o", type: "board" }], process: (i) => ({ o: i.i ? [1] : [] }), preview: painted }));
  r.register(spec({ type: "alpha", category: "Vision", title: "ALPHA" }));
  r.register(spec({ type: "end", category: "Output", inputs: [{ id: "i", type: "board" }, { id: "j", type: "any" }] }));
  r.register(spec({ type: "oops", category: "Scene", process: () => { throw new Error("broken"); } }));
  return { r, painted };
};
const setup = () => {
  const { r, painted } = registry(); const g = new Graph(r);
  const a = g.addNode("src", 10, 10), b = g.addNode("mid", 400, 10), c = g.addNode("end", 700, 10);
  const ed = new NodeEditor(g); const onChange = vi.fn(); ed.onChange = onChange;
  document.body.append(ed.root);
  return { g, ed, a, b, c, onChange, painted };
};
const dot = (ed: NodeEditor, node: string, port: string, dir: "in" | "out") => ed.root.querySelector<HTMLElement>(`.ne-dot[data-node="${node}"][data-port="${port}"][data-dir="${dir}"]`)!;
const node = (ed: NodeEditor, id: string) => ed.root.querySelector<HTMLElement>(`.ne-node[data-id="${id}"]`)!;
const ptr = (el: EventTarget, type: string, x = 0, y = 0, extra: object = {}) => el.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), { clientX: x, clientY: y, pointerId: 1, shiftKey: false, altKey: false }, extra));

beforeEach(() => {
  document.body.innerHTML = "";
  (Element.prototype as any).setPointerCapture = vi.fn(); (document as any).elementFromPoint = vi.fn(() => null);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} });
});
afterEach(() => { vi.restoreAllMocks(); });

describe("NodeEditor rendering", () => {
  it("exposes a colour for every port type", () => { expect(Object.keys(PORT_COLOR).sort()).toEqual(["any", "board", "clock", "event", "frame", "game", "obs", "pointer", "pose", "scene", "seat", "text"]); });
  it("draws one card per node with category colour, title, pins (typed, labelled), preview canvas and parameter widgets", () => {
    const { ed, a, b } = setup();
    expect(ed.root.querySelectorAll(".ne-node")).toHaveLength(3);
    const card = node(ed, a.id); expect(card.querySelector(".ne-title")!.textContent).toBe("SRC"); expect(card.style.getPropertyValue("--cat")).toBe("#4a8fd9"); expect(card.style.left).toBe("10px");
    expect(card.querySelector(".ne-pl")!.textContent).toBe("image"); expect(dot(ed, a.id, "o", "out").style.background).toBeTruthy();
    const cv = card.querySelector<HTMLCanvasElement>(".ne-preview")!; expect([cv.width, cv.height]).toEqual([50, 30]); expect(card.querySelectorAll(".ne-param")).toHaveLength(5); expect(card.querySelectorAll<HTMLInputElement>("input[type=range]")[1].step).toBe("0.01");
    const mid = node(ed, b.id).querySelector<HTMLCanvasElement>(".ne-preview")!; expect([mid.width, mid.height]).toEqual([160, 100]); // default preview size
    expect(node(ed, b.id).querySelector(".ne-params")).toBeNull();
  });
  it("uses a neutral colour for an unknown category", () => {
    const r = new Registry(); r.register({ ...spec({ type: "w" }), category: "Weird" as any }); const g = new Graph(r); const n = g.addNode("w"); const ed = new NodeEditor(g);
    expect(node(ed, n.id).style.getPropertyValue("--cat")).toBe("#555");
  });
  it("rebuild() replaces the cards from the graph", () => {
    const { ed, g } = setup(); g.addNode("oops"); ed.rebuild(); expect(ed.root.querySelectorAll(".ne-node")).toHaveLength(4);
  });
});

describe("defaults", () => {
  it("works without an onChange listener", () => {
    const { r } = registry(), g = new Graph(r); const n = g.addNode("src"), ed = new NodeEditor(g);
    node(ed, n.id).querySelector<HTMLButtonElement>(".ne-btn")!.click(); expect(n.bypass).toBe(true);
  });
});

describe("live frame updates", () => {
  it("draws wires coloured by port type, dashed idle vs flowing live, plus per-node ms, fidelity chip, errors and previews", () => {
    const { g, ed, a, b, c, painted } = setup(); const oops = g.addNode("oops"); ed.rebuild();
    g.connect({ node: a.id, port: "o" }, { node: b.id, port: "i" }); g.connect({ node: b.id, port: "o" }, { node: c.id, port: "i" });
    g.tick(1000); g.stats.get(a.id)!.fidelity = 0.5; ed.frame(1000);
    const paths = ed.root.querySelectorAll("svg.ne-wires path"); expect(paths).toHaveLength(2); expect([...paths].map((p) => p.getAttribute("class"))).toEqual(["part", "live"]); expect(paths[0].getAttribute("stroke")).toBe(PORT_COLOR.frame);
    expect(node(ed, a.id).querySelector(".ne-ms")!.textContent).toMatch(/ms$/); expect(node(ed, a.id).querySelector(".ne-fid")!.textContent).toBe("50%"); expect(node(ed, oops.id).querySelector(".ne-err")!.textContent).toContain("broken");
    expect(node(ed, b.id).querySelector(".ne-fid")!.classList.contains("none")).toBe(true); expect(painted).toHaveBeenCalled();
    // an empty-array output reads as idle
    g.outputs.set(b.id, { o: [] }); ed.frame(1500); expect([...ed.root.querySelectorAll("svg.ne-wires path")].map((p) => p.getAttribute("class"))).toEqual(["part", "idle"]);
  });
  it("throttles previews to ~15 fps and skips bypassed nodes", () => {
    const { g, ed, a, painted } = setup(); g.tick(0);
    ed.frame(1000); const n = painted.mock.calls.length; ed.frame(1010); expect(painted.mock.calls.length).toBe(n); ed.frame(1100); expect(painted.mock.calls.length).toBeGreaterThan(n);
    a.bypass = true; const m = painted.mock.calls.length; ed.frame(1300); expect(painted.mock.calls.length).toBe(m + 1); // only the unbypassed preview node
  });
  it("skips wires whose endpoints have no card, and nodes that have not run yet", () => {
    const { g, ed, a, b } = setup(); g.connect({ node: a.id, port: "o" }, { node: b.id, port: "i" });
    (ed as any).views.delete(b.id); expect(() => ed.frame(1000)).not.toThrow(); expect(ed.root.querySelectorAll("svg.ne-wires path")).toHaveLength(0);
    const e2 = setup(); e2.ed.frame(0); // no stats yet
  });
  it("redraws wires when something moved, or at least every 400 ms", () => {
    const { g, ed, a, b } = setup(); g.connect({ node: a.id, port: "o" }, { node: b.id, port: "i" }); g.tick(0);
    ed.frame(1000); const first = ed.root.querySelector("svg path")!; ed.frame(1100); expect(ed.root.querySelector("svg path")).toBe(first); ed.frame(1500); expect(ed.root.querySelector("svg path")).not.toBe(first);
  });
});

describe("parameters", () => {
  it("number / bool / select / text widgets write to the node and notify; frame() echoes outside changes unless the widget has focus", () => {
    const { ed, a, onChange, g } = setup(); const card = node(ed, a.id);
    const [range, check, select, text] = [card.querySelector<HTMLInputElement>("input[type=range]")!, card.querySelector<HTMLInputElement>("input[type=checkbox]")!, card.querySelector<HTMLSelectElement>("select")!, card.querySelector<HTMLInputElement>("input[type=text]")!];
    range.value = "7"; range.dispatchEvent(new Event("input")); expect(a.params.n).toBe(7); expect(card.querySelector(".ne-pv")!.textContent).toBe("7");
    check.checked = true; check.dispatchEvent(new Event("change")); expect(a.params.b).toBe(true);
    select.value = "y"; select.dispatchEvent(new Event("change")); expect(a.params.s).toBe("y");
    text.value = "abc"; text.dispatchEvent(new Event("change")); expect(a.params.t).toBe("abc"); expect(onChange).toHaveBeenCalledTimes(4);
    a.params.n = 2; a.params.b = false; a.params.s = "x"; a.params.t = "zzz"; g.tick(0); ed.frame(1000);
    expect([range.value, check.checked, select.value, text.value]).toEqual(["2", false, "x", "zzz"]);
    a.params.n = 9; a.params.s = "y"; a.params.t = "typing";
    for (const el of [range, select, text]) { const before = el.value; el.focus(); ed.frame(2000); expect(el.value, "focused widgets are not clobbered").toBe(before); el.blur(); }
    ed.frame(2100); expect([range.value, select.value, text.value]).toEqual(["9", "y", "typing"]);
    text.dispatchEvent(new Event("pointerdown", { bubbles: true })); // text boxes do not start canvas pans
  });
});

describe("node buttons, selection and dragging", () => {
  it("bypass toggles the node's dimmed state, delete removes it", () => {
    const { ed, g, a, onChange } = setup(); const btns = node(ed, a.id).querySelectorAll<HTMLButtonElement>(".ne-btn");
    btns[0].click(); expect(a.bypass).toBe(true); expect(node(ed, a.id).classList.contains("bypass")).toBe(true); btns[0].click(); expect(a.bypass).toBe(false);
    btns[1].click(); expect(g.nodes.has(a.id)).toBe(false); expect(ed.root.querySelector(`[data-id="${a.id}"]`)).toBeNull(); expect(onChange).toHaveBeenCalled();
  });
  it("dragging a header moves the node (scaled by zoom) and persists on release; header buttons do not start drags", () => {
    const { ed, a, onChange } = setup(); const head = node(ed, a.id).querySelector(".ne-head")!;
    ptr(head, "pointerdown", 100, 100); ptr(head, "pointermove", 160, 130); expect([a.x, a.y]).toEqual([10 + 60 / 0.85, 10 + 30 / 0.85]); expect(node(ed, a.id).style.left).toContain("px"); ptr(head, "pointerup"); expect(onChange).toHaveBeenCalled();
    expect(node(ed, a.id).classList.contains("sel")).toBe(true);
    const x = a.x; ptr(node(ed, a.id).querySelector(".ne-btn")!, "pointerdown", 0, 0); ptr(head, "pointermove", 300, 300); expect(a.x).toBe(x);
  });
  it("shift-click multi-selects and drags the whole selection; a click on empty canvas clears it", () => {
    const { ed, a, b } = setup(); const ha = node(ed, a.id).querySelector(".ne-head")!, hb = node(ed, b.id).querySelector(".ne-head")!;
    ptr(ha, "pointerdown", 0, 0); ptr(ha, "pointerup"); ptr(hb, "pointerdown", 0, 0, { shiftKey: true }); const [ax, bx] = [a.x, b.x]; ptr(hb, "pointermove", 85, 0); ptr(hb, "pointerup");
    expect(a.x).toBeCloseTo(ax + 100); expect(b.x).toBeCloseTo(bx + 100);
    ptr(ed.root, "pointerdown", 5, 5); ptr(ed.root, "pointerup"); expect(ed.root.querySelectorAll(".ne-node.sel")).toHaveLength(0);
    ptr(ha, "pointerdown", 0, 0); ptr(ha, "pointerup"); ptr(ha, "pointerdown", 0, 0); // pressing an already selected node keeps the selection
    expect(node(ed, a.id).classList.contains("sel")).toBe(true);
  });
  it("Delete / Backspace remove the selection, except while typing", () => {
    const { ed, g, a, b } = setup(); ptr(node(ed, a.id).querySelector(".ne-head")!, "pointerdown");
    const key = (k: string, target: EventTarget = window) => target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    key("x"); expect(g.nodes.has(a.id)).toBe(true);
    const input = node(ed, a.id).querySelector("input")!; key("Delete", input); expect(g.nodes.has(a.id)).toBe(true);
    const sel = node(ed, a.id).querySelector("select")!; key("Backspace", sel); expect(g.nodes.has(a.id)).toBe(true);
    key("Delete"); expect(g.nodes.has(a.id)).toBe(false); expect(g.nodes.has(b.id)).toBe(true);
  });
});

describe("pan and zoom", () => {
  it("pans on background drag and zooms about the cursor within limits", () => {
    const { ed } = setup(); const world = ed.root.querySelector<HTMLElement>(".ne-world")!;
    expect(world.style.transform).toBe("translate(40px, 30px) scale(0.85)");
    ptr(ed.root, "pointerdown", 100, 100); ptr(ed.root, "pointermove", 130, 150); expect(world.style.transform).toContain("translate(70px, 80px)"); ptr(ed.root, "pointerup");
    ptr(ed.root, "pointermove", 500, 500); expect(world.style.transform).toContain("translate(70px, 80px)"); // no longer dragging
    ed.root.dispatchEvent(Object.assign(new Event("wheel", { cancelable: true, bubbles: true }), { deltaY: -100, clientX: 400, clientY: 300 })); expect(world.style.transform).toContain("scale(0.935)");
    for (let i = 0; i < 40; i++) ed.root.dispatchEvent(Object.assign(new Event("wheel", { cancelable: true, bubbles: true }), { deltaY: -100, clientX: 0, clientY: 0 })); expect(world.style.transform).toContain("scale(1.6)");
    for (let i = 0; i < 80; i++) ed.root.dispatchEvent(Object.assign(new Event("wheel", { cancelable: true, bubbles: true }), { deltaY: 100, clientX: 0, clientY: 0 })); expect(world.style.transform).toContain("scale(0.3)");
  });
});

describe("palette", () => {
  it("opens on double-click, or from the canvas menu's Add node… (not on a node), filters while typing, adds a node at the cursor, and closes on background click", () => {
    const { ed, g } = setup(); const pal = ed.root.querySelector<HTMLElement>(".ne-palette")!; expect(pal.hidden).toBe(true);
    ed.root.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 300, clientY: 200 })); expect(pal.hidden).toBe(false); expect(pal.style.left).toBe("300px");
    const items = () => [...pal.querySelectorAll<HTMLElement>(".ne-item")]; expect(items().map((i) => i.textContent)).toEqual(["Output END", "Scene OOPS", "Source SRC", "Vision ALPHA", "Vision MID"]);
    const q = pal.querySelector<HTMLInputElement>(".ne-search")!; q.value = "mid"; q.dispatchEvent(new Event("input")); expect(items()).toHaveLength(1); expect(items()[0].textContent).toContain("MID");
    const before = g.nodes.size; items()[0].click(); expect(g.nodes.size).toBe(before + 1); expect(pal.hidden).toBe(true); expect(ed.root.querySelectorAll(".ne-node")).toHaveLength(before + 1);
    const added = [...g.nodes.values()].at(-1)!; expect(added.x).toBeCloseTo((300 - 40) / 0.85); expect(added.y).toBeCloseTo((200 - 30) / 0.85);
    const rc = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }); Object.defineProperty(rc, "target", { value: ed.root });
    const add = collectItems(ed.root, rc).find((i) => i.kind === "action" && i.label === "Add node…") as { run(): void }; add.run(); expect(pal.hidden).toBe(false); // right-click offers "Add node…"
    ptr(ed.root, "pointerdown", 5, 5); expect(pal.hidden).toBe(true);
    pal.hidden = false; ptr(pal, "pointerdown"); expect(pal.hidden).toBe(false); // clicks inside the palette keep it open
    pal.dispatchEvent(Object.assign(new Event("wheel", { cancelable: true, bubbles: true }), { deltaY: 100 })); // scrolling the list does not zoom
    node(ed, [...g.nodes.keys()][0]).dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); // double-click on a node does not open it again
  });
});

describe("wiring", () => {
  it("drag from an output pin onto a compatible input pin connects; onto nothing, an incompatible pin, or another output does not", () => {
    const { ed, g, a, b, c, onChange } = setup();
    const drop = (el: HTMLElement | null) => (document.elementFromPoint as any).mockReturnValue(el);
    ptr(dot(ed, a.id, "o", "out"), "pointerdown", 0, 0); ptr(ed.root, "pointermove", 50, 50); ed.frame(0); expect(ed.root.querySelector("path.drag")).toBeTruthy();
    drop(dot(ed, b.id, "i", "in")); ptr(ed.root, "pointerup"); expect(g.edges).toHaveLength(1); expect(onChange).toHaveBeenCalled();
    ptr(dot(ed, b.id, "o", "out"), "pointerdown"); drop(dot(ed, c.id, "i", "in")); ptr(ed.root, "pointerup"); expect(g.edges).toHaveLength(2);
    ptr(dot(ed, a.id, "o", "out"), "pointerdown"); drop(dot(ed, c.id, "i", "in")); ptr(ed.root, "pointerup"); expect(g.edges).toHaveLength(2); // frame -> board refused
    ptr(dot(ed, a.id, "o", "out"), "pointerdown"); drop(dot(ed, b.id, "o", "out")); ptr(ed.root, "pointerup"); expect(g.edges).toHaveLength(2);
    ptr(dot(ed, a.id, "o", "out"), "pointerdown"); drop(node(ed, b.id)); ptr(ed.root, "pointerup"); expect(g.edges).toHaveLength(2);
    ptr(dot(ed, a.id, "o", "out"), "pointerdown"); drop(null); ptr(ed.root, "pointerup"); ed.frame(1); expect(ed.root.querySelector("path.drag")).toBeNull();
  });
  it("a cancelled pointer, lost capture or window blur ends a drag, and a right-click never starts one", () => {
    const { ed, a } = setup(); const v = () => ed.view.x;
    for (const end of [(): unknown => ptr(ed.root, "pointercancel"), (): unknown => ptr(ed.root, "lostpointercapture"), (): unknown => window.dispatchEvent(new Event("blur"))]) {
      ptr(ed.root, "pointerdown", 0, 0); ptr(ed.root, "pointermove", 20, 0); const moved = v(); end(); ptr(ed.root, "pointermove", 90, 0);
      expect(v()).toBe(moved); // the pan stopped following the mouse
    }
    const before = v(); ptr(ed.root, "pointerdown", 0, 0, { button: 2 }); ptr(ed.root, "pointermove", 70, 0); expect(v()).toBe(before);
    ptr(dot(ed, a.id, "o", "out"), "pointerdown"); ptr(ed.root, "pointercancel"); ed.frame(1); expect(ed.root.querySelector("path.drag")).toBeNull();
  });
  it("survives the source node being deleted while a wire is being dragged", () => {
    const { ed, a } = setup(); ptr(dot(ed, a.id, "o", "out"), "pointerdown"); ed.removeNode(a.id); expect(() => ed.frame(0)).not.toThrow(); expect(ed.root.querySelector("path.drag")).toBeNull();
  });
  it("dragging from an input starts a wire in reverse (drop on an output), and from a connected input detaches it for re-plugging", () => {
    const { ed, g, a, b, c } = setup(); const drop = (el: HTMLElement | null) => (document.elementFromPoint as any).mockReturnValue(el);
    ptr(dot(ed, b.id, "i", "in"), "pointerdown"); drop(dot(ed, a.id, "o", "out")); ptr(ed.root, "pointerup"); expect(g.edges).toHaveLength(1);
    ptr(dot(ed, b.id, "i", "in"), "pointerdown"); drop(null); ptr(ed.root, "pointerup"); expect(g.edges).toHaveLength(0); // picked up and dropped nowhere = unplugged
    g.connect({ node: b.id, port: "o" }, { node: c.id, port: "j" }); ptr(dot(ed, c.id, "j", "in"), "pointerdown"); drop(dot(ed, c.id, "i", "in")); ptr(ed.root, "pointerup"); expect(g.edges).toHaveLength(1); expect(g.edges[0].to.port).toBe("i");
    ptr(dot(ed, c.id, "i", "in"), "pointerdown"); drop(dot(ed, b.id, "i", "in")); ptr(ed.root, "pointerup"); // input onto input: nothing
  });
  it("alt-click on a wire cuts it; a plain click does not", () => {
    const { ed, g, a, b, onChange } = setup(); g.connect({ node: a.id, port: "o" }, { node: b.id, port: "i" }); g.tick(0); ed.frame(1000);
    const path = ed.root.querySelector("svg path")!; path.dispatchEvent(new MouseEvent("click", { bubbles: true })); expect(g.edges).toHaveLength(1);
    path.dispatchEvent(new MouseEvent("click", { bubbles: true, altKey: true })); expect(g.edges).toHaveLength(0); expect(onChange).toHaveBeenCalled();
  });
  it("removeNode clears selection, cards and wires; addNodeAt creates a card", () => {
    const { ed, g, a, b } = setup(); g.connect({ node: a.id, port: "o" }, { node: b.id, port: "i" }); ptr(node(ed, a.id).querySelector(".ne-head")!, "pointerdown"); ed.removeNode(a.id);
    expect(g.edges).toHaveLength(0); ed.addNodeAt("end", 100, 100); expect(ed.root.querySelectorAll(".ne-node")).toHaveLength(3);
  });
});
