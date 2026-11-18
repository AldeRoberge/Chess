import { afterEach, describe, expect, it, vi } from "vitest";
import { appMenu } from "./appMenu";
import type { CtxItem } from "../contextMenu";
type Row = CtxItem & { label: string };

const ev = (target: unknown = null) => ({ target }) as unknown as MouseEvent;
const labels = (items: CtxItem[]) => items.map((i) => (i as Row).label);

describe("appMenu", () => {
  afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); });

  it("lists undo, redo and the workflow submenu with no copy or timings row on an empty page", () => {
    const items = appMenu(ev());
    expect(labels(items)).toEqual(["Undo", "Redo", "Workflow"]);
    const [undo, redo] = items as { disabled: boolean; hint?: string }[];
    expect(undo.disabled).toBe(false); expect(undo.hint).toBeUndefined();
    expect(redo.disabled).toBe(false);
  });

  it("disables undo and redo with a hint when the buttons are disabled, and clicks the buttons otherwise", () => {
    document.body.innerHTML = '<button id="undo" disabled></button><button id="redo" disabled></button>';
    const [undo, redo] = appMenu(ev()) as { disabled: boolean; hint?: string }[];
    expect(undo.disabled && redo.disabled).toBe(true); expect(undo.hint).toMatch(/Nothing to undo/); expect(redo.hint).toMatch(/Nothing to redo/);
    document.body.innerHTML = '<button id="undo"></button><button id="redo"></button>';
    const hit: string[] = [];
    for (const id of ["undo", "redo"]) document.getElementById(id)!.addEventListener("click", () => hit.push(id));
    const items = appMenu(ev()) as { run: () => void }[];
    items[0].run(); items[1].run(); expect(hit).toEqual(["undo", "redo"]);
  });

  it("copies the selection, or a chip's value, to the clipboard", () => {
    const write = vi.fn(); Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
    document.body.innerHTML = '<span class="chip"><b> 42 ms </b></span>';
    const chip = document.querySelector("b")!;
    let items = appMenu(ev(chip));
    expect((items[0] as Row).label).toBe("Copy value"); (items[0] as { run: () => void }).run(); expect(write).toHaveBeenLastCalledWith("42 ms");
    vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "picked" } as Selection);
    items = appMenu(ev(chip));
    expect((items[0] as Row).label).toBe("Copy"); (items[0] as { run: () => void }).run(); expect(write).toHaveBeenLastCalledWith("picked");
  });

  it("tolerates a missing clipboard and a target without closest()", () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    vi.spyOn(window, "getSelection").mockReturnValue(null);
    expect(labels(appMenu(ev({})))).toEqual(["Undo", "Redo", "Workflow"]);
    vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "x" } as Selection);
    expect(() => (appMenu(ev())[0] as { run: () => void }).run()).not.toThrow();
  });

  it("adds a Node timings toggle when the heat button exists and drives the workflow buttons", () => {
    document.body.innerHTML = '<button id="heat"></button><button id="workflows"></button><button id="export"></button><button id="reset"></button>';
    const heat = document.getElementById("heat")!; const hit: string[] = [];
    for (const id of ["heat", "workflows", "export", "reset"]) document.getElementById(id)!.addEventListener("click", () => hit.push(id));
    const items = appMenu(ev());
    const toggle = items.find((i) => (i as Row).label === "Node timings") as unknown as { get: () => boolean; set: () => void };
    expect(toggle.get()).toBe(false); heat.classList.add("on"); expect(toggle.get()).toBe(true); toggle.set();
    const sub = items.find((i) => (i as Row).label === "Workflow") as unknown as { items: { run: () => void; danger?: boolean }[] };
    sub.items.forEach((i) => i.run());
    expect(hit).toEqual(["heat", "workflows", "export", "reset"]); expect(sub.items[2].danger).toBe(true);
  });
});
