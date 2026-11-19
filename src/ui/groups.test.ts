import { beforeEach, describe, expect, it, vi } from "vitest";
import { Graph } from "../core/graph";
import { createRegistry } from "../plugins";
import { NodeEditor } from "./editor";

const ptr = (el: Element, type: string, x = 0, y = 0, extra: object = {}) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, ...extra }));
let g: Graph, ed: NodeEditor, changed: number;
beforeEach(() => {
  document.body.innerHTML = ""; (Element.prototype as any).setPointerCapture = vi.fn(); (Element.prototype as any).releasePointerCapture = vi.fn();
  g = new Graph(createRegistry()); changed = 0;
  g.addNode("source.synthetic", 100, 100, {}, "a"); g.addNode("vision.boardReader", 500, 100, {}, "b"); g.addNode("scene.output", 3000, 3000, {}, "far");
  ed = new NodeEditor(g); ed.onChange = () => { changed++; }; document.body.append(ed.root);
});
const sections = () => [...document.querySelectorAll<HTMLElement>(".ne-g")];

describe("sections in the editor", () => {
  it("Organize draws one titled, coloured section per role and moves the nodes into them", () => {
    ed.organize();
    expect(sections().map((s) => s.querySelector(".ne-gname")!.textContent)).toEqual(["Demo & input", "Analysis", "Output: sound & narration"]);
    expect(sections()[1].style.getPropertyValue("--g")).toMatch(/^#/); expect(changed).toBe(1);
    expect(g.nodes.get("a")!.y).toBeLessThan(g.nodes.get("b")!.y);
  });
  it("Add section wraps the selected nodes, or the middle of the view, and starts renaming", () => {
    ed.addGroup(); expect(g.groups).toHaveLength(1); expect(document.querySelector(".ne-gedit")).toBeTruthy();
    (document.querySelector(".ne-gedit") as HTMLInputElement).value = "Mine"; (document.querySelector(".ne-gedit") as HTMLInputElement).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(g.groups[0].title).toBe("Mine"); expect(document.querySelector(".ne-gname")!.textContent).toBe("Mine");
    (ed as any).selected.add("a"); (ed as any).selected.add("b"); ed.addGroup();
    const wrap = g.groups[1]; expect(wrap.x).toBeLessThan(100); expect(wrap.x + wrap.w).toBeGreaterThan(500);
  });
  it("renaming: Escape and blank titles keep the old name", () => {
    ed.addGroup(); const input = () => document.querySelector(".ne-gedit") as HTMLInputElement;
    input().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); expect(g.groups[0].title).toBe("New section");
    document.querySelector(".ne-gname")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    input().value = "  "; input().dispatchEvent(new Event("blur")); expect(g.groups[0].title).toBe("New section");
  });
  it("double-clicking anywhere on the title bar (not just the text) starts renaming", () => {
    ed.organize(); const bar = sections()[0].querySelector(".ne-gt")!;
    bar.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const input = document.querySelector(".ne-gedit") as HTMLInputElement; expect(input).toBeTruthy();
    input.value = "Renamed"; input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" })); expect(g.groups[0].title).toBe("Renamed");
  });
  it("dragging the title moves the section with the nodes inside it, not the others", () => {
    ed.organize(); const before = { a: { ...g.nodes.get("a")! }, b: { ...g.nodes.get("b")! }, s: { ...g.groups[0] } };
    const bar = sections()[0].querySelector(".ne-gt")!;
    ptr(bar, "pointerdown", 0, 0); ptr(bar, "pointermove", 50, 40); ptr(bar, "pointerup", 50, 40);
    const k = ed.getView().k, dx = 50 / k, dy = 40 / k;
    expect(g.groups[0].x).toBeCloseTo(before.s.x + dx); expect(g.nodes.get("a")!.y).toBeCloseTo(before.a.y + dy);
    expect(g.nodes.get("b")!.y).toBe(before.b.y); expect(changed).toBe(2);
    ptr(bar, "pointerdown", 0, 0, { button: 2 }); ptr(bar.querySelector(".ne-gname")!, "pointerdown");
  });
  it("the corner resizes within limits", () => {
    ed.organize(); const grip = sections()[0].querySelector(".ne-gr")!, w0 = g.groups[0].w, k = ed.getView().k;
    ptr(grip, "pointerdown", 0, 0); ptr(grip, "pointermove", 100, 60); ptr(grip, "pointerup");
    expect(g.groups[0].w).toBeCloseTo(w0 + 100 / k);
    ptr(grip, "pointerdown", 0, 0); ptr(grip, "pointermove", -99999, -99999); ptr(grip, "pointerup");
    expect(g.groups[0].w).toBe(160); expect(g.groups[0].h).toBe(100);
    ptr(grip, "pointerdown", 0, 0, { button: 1 });
  });
  it("colour swatches recolour, the cross removes only the frame, and the title never opens the palette", () => {
    ed.organize(); const s = () => sections()[0];
    (s().querySelector(".ne-gdot") as HTMLElement).dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); (s().querySelector(".ne-gdot") as HTMLElement).click();
    expect(s().querySelectorAll(".ne-gsw")).toHaveLength(8);
    (s().querySelector(".ne-gdot") as HTMLElement).click(); // reopening replaces the old picker
    (s().querySelectorAll(".ne-gsw")[5] as HTMLElement).dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); (s().querySelectorAll(".ne-gsw")[5] as HTMLElement).click();
    expect(g.groups[0].color).toBe("#c76fb0");
    (s().querySelector(".ne-gdot") as HTMLElement).click(); ptr(document.body, "pointerdown"); expect(document.querySelector(".ne-gpal")).toBeNull();
    const bar = s().querySelector(".ne-gt")!; ptr(bar, "dblclick"); ptr(bar, "contextmenu"); expect(document.querySelector(".ne-palette")!.hasAttribute("hidden")).toBe(true);
    const n = g.nodes.size, cross = s().querySelector(".ne-gx") as HTMLElement; cross.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); cross.click();
    expect(g.groups).toHaveLength(2); expect(g.nodes.size).toBe(n);
  });
  it("a saved patch redraws its sections on rebuild", () => {
    ed.organize(); const json = g.toJSON(); g.load(json); ed.rebuild(); expect(sections()).toHaveLength(3);
  });
});
