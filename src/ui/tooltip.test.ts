import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Graph } from "../core/graph";
import { createRegistry } from "../plugins";
import { describeValue, editorTips } from "./editorTips";
import { installTooltips, parseTip, placeTip, SHOW_DELAY, type Tooltips } from "./tooltip";

const fire = (el: Element, type: string, init: MouseEventInit = {}) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, ...init }));

describe("placeTip", () => {
  const vp = { w: 800, h: 600 };
  it("sits below and centred, flips above when cramped, clamps to the viewport", () => {
    expect(placeTip({ x: 100, y: 100, w: 40, h: 20 }, { w: 100, h: 50 }, vp, "center")).toMatchObject({ x: 70, y: 130, side: "below" });
    expect(placeTip({ x: 100, y: 560, w: 40, h: 20 }, { w: 100, h: 50 }, vp, "center")).toMatchObject({ y: 500, side: "above" });
    expect(placeTip({ x: 2, y: 10, w: 10, h: 10 }, { w: 100, h: 50 }, vp, "center").x).toBe(8);
    expect(placeTip({ x: 790, y: 10, w: 0, h: 0 }, { w: 100, h: 50 }, vp, "start").x).toBe(692);
  });
});

describe("parseTip", () => {
  it("reads attributes, rows with optional meters, and ignores bad meters", () => {
    const el = document.createElement("div");
    expect(parseTip(el)).toBeNull();
    el.dataset.tip = "T"; el.dataset.tipKeys = "Esc,B"; el.dataset.tipRows = "A:1|B:2:0.5|C:3:x";
    const t = parseTip(el)!;
    expect(t.keys).toEqual(["Esc", "B"]);
    expect(t.rows).toEqual([{ label: "A", value: "1", bar: undefined }, { label: "B", value: "2", bar: 0.5 }, { label: "C", value: "3", bar: undefined }]);
  });
});

describe("Tooltips", () => {
  let tt: Tooltips, a: HTMLElement, b: HTMLElement, plain: HTMLElement;
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = `<button id="a" data-tip="Alpha" data-tip-body="First" data-tip-tag="tag" data-tip-color="#f00" data-tip-rows="Level:50%:0.5" data-tip-keys="Esc" data-tip-hint="hint"></button><button id="b" title="Native">B</button><p id="p">x</p>`;
    a = document.getElementById("a")!; b = document.getElementById("b")!; plain = document.getElementById("p")!;
    tt = installTooltips();
  });
  afterEach(() => { tt.destroy(); vi.useRealTimers(); });
  const shown = () => tt.el.classList.contains("on");

  it("shows after a delay, then switches instantly while warm", () => {
    fire(a, "pointerover");
    expect(shown()).toBe(false);
    vi.advanceTimersByTime(SHOW_DELAY);
    expect(shown()).toBe(true);
    expect(tt.el.querySelector(".tip-title")!.textContent).toBe("Alpha");
    expect(tt.el.querySelector(".tip-bar b")!.getAttribute("style")).toContain("50%");
    expect(tt.el.querySelector("kbd")!.textContent).toBe("Esc");
    expect(a.getAttribute("aria-describedby")).toBe("tip");
    fire(b, "pointerover");
    expect(tt.el.querySelector(".tip-title")!.textContent).toBe("Native");
    expect(b.hasAttribute("title")).toBe(false);
  });

  it("hides when leaving to a plain element or the window, and never shows if left early", () => {
    fire(a, "pointerover"); fire(plain, "pointerover"); vi.advanceTimersByTime(1000);
    expect(shown()).toBe(false);
    fire(a, "pointerover"); vi.advanceTimersByTime(SHOW_DELAY);
    fire(a, "pointerout");
    expect(shown()).toBe(false);
  });

  it("click and Escape dismiss until the pointer leaves", () => {
    fire(a, "pointerover"); vi.advanceTimersByTime(SHOW_DELAY);
    fire(a, "pointerdown");
    expect(shown()).toBe(false);
    fire(a, "pointerover"); vi.advanceTimersByTime(SHOW_DELAY);
    expect(shown()).toBe(false);
    fire(plain, "pointerover"); fire(a, "pointerover"); vi.advanceTimersByTime(SHOW_DELAY);
    expect(shown()).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(shown()).toBe(false);
  });

  it("refreshes live content from resolvers while open", () => {
    let n = 1;
    tt.add((el) => (el.id === "p" ? { title: "Live", rows: [{ label: "n", value: String(n) }] } : null));
    fire(plain, "pointerover"); vi.advanceTimersByTime(SHOW_DELAY);
    expect(tt.el.querySelector(".tip-v")!.textContent).toBe("1");
    n = 2; vi.advanceTimersByTime(300);
    expect(tt.el.querySelector(".tip-v")!.textContent).toBe("2");
  });
});

describe("editor tips", () => {
  const graph = new Graph(createRegistry());
  const reg = graph.registry.all().find((s) => s.inputs.length && s.params?.length)!;
  const node = graph.addNode(reg.type, 0, 0);
  const tip = editorTips(graph);
  const el = (cls: string, data: Record<string, string>) => { const e = document.createElement("div"); e.className = cls; Object.assign(e.dataset, data); return e; };

  it("describes nodes, pins and params with live values", () => {
    const n = tip(el("ne-node", { id: node.id }))!;
    expect(n.title).toBe(reg.title);
    expect(n.rows!.map((r) => r.label)).toContain("Inputs");
    const pin = tip(el("ne-dot", { node: node.id, port: reg.inputs[0].id, dir: "in" }))!;
    expect(pin.rows!.find((r) => r.label === "Fed by")!.value).toBe("nothing");
    const out = reg.outputs[0] && tip(el("ne-dot", { node: node.id, port: reg.outputs[0].id, dir: "out" }));
    if (out) expect(out.hint).toContain("Drag");
    const p = tip(el("ne-param", { node: node.id, param: reg.params![0].id }))!;
    expect(p.title).toBe(reg.params![0].label);
  });

  it("ignores unknown ids and unrelated elements", () => {
    expect(tip(el("ne-node", { id: "nope" }))).toBeNull();
    expect(tip(el("ne-dot", { node: node.id, port: "zzz", dir: "in" }))).toBeNull();
    expect(tip(el("ne-param", { node: node.id, param: "zzz" }))).toBeNull();
    expect(tip(el("other", {}))).toBeNull();
  });

  it("summarises signal values", () => {
    expect(describeValue(undefined)).toBe("no signal");
    expect(describeValue([1, 2])).toBe("2 items");
    expect(describeValue({ width: 4, height: 3 })).toBe("4×3");
    expect(describeValue(0.12345)).toBe("0.123");
  });
});
