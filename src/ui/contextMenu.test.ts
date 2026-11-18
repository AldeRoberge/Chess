import { afterEach, describe, expect, it, vi } from "vitest";
import { clampToViewport, iconFor, searchItems, closeContextMenu, collectItems, isContextMenuOpen, joinGroups, openContextMenu, registerContextMenu, sep, wantsNativeMenu, type CtxItem } from "./contextMenu";

afterEach(() => { closeContextMenu(); document.body.innerHTML = ""; });
const ev = (target: Element, o: MouseEventInit = {}) => { const e = new MouseEvent("contextmenu", { bubbles: true, ...o }); Object.defineProperty(e, "target", { value: target }); return e; };

describe("context menu", () => {
  it("clamps a menu inside the viewport", () => {
    expect(clampToViewport(990, 790, 200, 100, 1000, 800)).toEqual({ x: 794, y: 694 });
    expect(clampToViewport(-5, -5, 50, 50, 1000, 800)).toEqual({ x: 6, y: 6 });
  });
  it("merges providers innermost first with separators, skipping empty ones", () => {
    const outer = document.createElement("div"), inner = document.createElement("span"); outer.append(inner); document.body.append(outer);
    const a: CtxItem = { kind: "action", label: "inner", run() {} }, b: CtxItem = { kind: "action", label: "outer", run() {} };
    registerContextMenu(outer, () => [b]); registerContextMenu(inner, () => [a]);
    const empty = document.createElement("i"); inner.append(empty); registerContextMenu(empty, () => []);
    expect(collectItems(empty, ev(empty))).toEqual([a, sep, b]);
    expect(joinGroups([[], [a], [], [b]])).toEqual([a, sep, b]);
  });
  it("keeps the native menu for text entry and Shift", () => {
    const t = document.createElement("input"); t.type = "text"; const r = document.createElement("input"); r.type = "range"; const d = document.createElement("div"); document.body.append(t, r, d);
    expect(wantsNativeMenu(ev(t))).toBe(true); expect(wantsNativeMenu(ev(r))).toBe(false); expect(wantsNativeMenu(ev(d))).toBe(false); expect(wantsNativeMenu(ev(d, { shiftKey: true }))).toBe(true);
  });
  it("runs actions, flips toggles in place, and closes on Escape", () => {
    const run = vi.fn(); let on = false;
    openContextMenu(10, 10, [{ kind: "action", label: "Go", run }, { kind: "toggle", label: "T", get: () => on, set: (v) => { on = v; } }]);
    const rows = document.querySelectorAll<HTMLElement>(".cm-row");
    rows[1].click(); expect(on).toBe(true); expect(isContextMenuOpen()).toBe(true); expect(rows[1].querySelector(".cm-val")!.textContent).toBe("✓");
    rows[0].click(); expect(run).toHaveBeenCalled(); expect(isContextMenuOpen()).toBe(false);
    openContextMenu(0, 0, [{ kind: "info", label: "x" }]); document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); expect(document.querySelector(".cm")).toBeNull();
  });
  it("does not open an empty menu or run a disabled action", () => {
    expect(openContextMenu(0, 0, [])).toBeNull();
    const run = vi.fn(); openContextMenu(0, 0, [{ kind: "action", label: "no", run, disabled: true }]); document.querySelector<HTMLElement>(".cm-row")!.click(); expect(run).not.toHaveBeenCalled();
  });
  it("adjusts a choice and a slider with the arrow keys", () => {
    let c = "a", n = 1;
    openContextMenu(0, 0, [{ kind: "choice", label: "C", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], get: () => c, set: (v) => { c = v; } }, { kind: "slider", label: "S", min: 0, max: 3, step: 1, get: () => n, set: (v) => { n = v; } }]);
    const root = document.querySelector<HTMLElement>(".cm")!, rows = root.querySelectorAll<HTMLElement>(".cm-row");
    rows[0].focus(); root.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); expect(c).toBe("b");
    rows[1].focus(); root.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); root.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); root.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); expect(n).toBe(3);
  });
  it("picks an icon from the label unless the row names one", () => {
    expect(iconFor({ kind: "action", label: "Delete node", run() {} })).toBe("trash"); expect(iconFor({ kind: "action", label: "Delete node", icon: "x", run() {} })).toBe("x");
    expect(iconFor({ kind: "toggle", label: "Zzz", get: () => true, set() {} })).toBe("toggle");
    // every row we know by name gets its own icon, not the generic chevron
    for (const [label, name] of [["Re-run system check", "check"], ["Learn now", "brain"], ["Launch experience", "launch"], ["Speak aloud", "voice"], ["Test thunder", "bolt"], ["Autoplay demo game", "play"], ["Commentators", "chat"], ["Computer strength", "opponent"], ["Mode", "list"], ["Options", "sliders"], ["Time of day", "clock"], ["Volume", "sound"], ["Status", "wave"], ["Reset workflow", "refresh"]] as const)
      expect(iconFor({ kind: "action", label, run() {} })).toBe(name);
  });
  it("searches nested rows by label and path, label hits first, and shows a search box only on bigger menus", () => {
    const a = (label: string): CtxItem => ({ kind: "action", label, run() {} });
    const tree: CtxItem[] = [a("Bypass"), { kind: "submenu", label: "Performance", items: () => [a("Frame rate"), a("Shadows")] }, a("Delete"), a("Copy"), a("Undo"), a("Redo")];
    expect(searchItems(tree, "shad").map((r) => r.crumb)).toEqual(["Performance"]);
    expect(searchItems(tree, "perf").map((r) => (r.item as { label: string }).label)).toEqual(["Frame rate", "Shadows"]); // matched through the path
    expect(searchItems(tree, "nothing")).toEqual([]);
    openContextMenu(0, 0, tree);
    const box = document.querySelector<HTMLInputElement>(".cm-search input")!; expect(box).not.toBeNull();
    box.value = "shad"; box.dispatchEvent(new Event("input")); expect([...document.querySelectorAll(".cm-row .cm-label")].map((l) => l.firstChild!.textContent)).toEqual(["Shadows"]);
    box.value = "zzz"; box.dispatchEvent(new Event("input")); expect(document.querySelector(".cm-row.info")!.textContent).toContain("No matches");
    closeContextMenu(); openContextMenu(0, 0, [a("One"), a("Two")]); expect(document.querySelector(".cm-search")).toBeNull();
  });
});
