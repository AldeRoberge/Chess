// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { installMenuBar, MENUS } from "./menuBar";

describe("menuBar", () => {
  it("starts with File and clicks the matching button", () => {
    document.body.innerHTML = '<div id="h"></div><button id="export"></button><button id="undo" disabled></button>';
    const spy = vi.fn(); document.getElementById("export")!.onclick = spy;
    const { bar } = installMenuBar(document.getElementById("h")!);
    expect(MENUS[0].name).toBe("File");
    const file = bar.querySelector<HTMLElement>(".mb-item")!;
    file.querySelector<HTMLElement>(".mb-title")!.click();
    expect(file.querySelector<HTMLElement>(".mb-drop")!.hidden).toBe(false);
    file.querySelector<HTMLButtonElement>('button[data-for="export"]')!.click();
    expect(spy).toHaveBeenCalled();
    expect(file.querySelector<HTMLElement>(".mb-drop")!.hidden).toBe(true);
  });
  it("disables rows whose button is disabled", () => {
    document.body.innerHTML = '<div id="h"></div><button id="undo" disabled></button>';
    const { bar } = installMenuBar(document.getElementById("h")!);
    const edit = bar.querySelectorAll<HTMLElement>(".mb-item")[1];
    edit.querySelector<HTMLElement>(".mb-title")!.click();
    expect(edit.querySelector<HTMLButtonElement>('button[data-for="undo"]')!.disabled).toBe(true);
  });
});
