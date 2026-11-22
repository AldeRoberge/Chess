// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { installMenuBar, MENUS } from "./menuBar";
import { coachSettings, setCoachSettings } from "../../narrator/coachSettings";

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

  it("View shows the commentary level and cycles it on click", () => {
    setCoachSettings({ level: "expert", opponentTalks: true });
    document.body.innerHTML = '<div id="h"></div>';
    const { bar } = installMenuBar(document.getElementById("h")!);
    const view = [...bar.querySelectorAll<HTMLElement>(".mb-item")].find((w) => w.querySelector(".mb-title")!.textContent === "View")!;
    view.querySelector<HTMLElement>(".mb-title")!.click();
    const row = [...view.querySelectorAll<HTMLButtonElement>("button[role=menuitem]")].find((b) => b.textContent!.startsWith("Commentary"))!;
    expect(row.textContent).toBe("Commentary: Expert");
    row.click(); expect(coachSettings().level).toBe("off");
    view.querySelector<HTMLElement>(".mb-title")!.click();
    expect(row.textContent).toBe("Commentary: Off");
    setCoachSettings({ level: "intermediate" });
  });
});
