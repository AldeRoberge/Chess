import { beforeEach, describe, expect, it } from "vitest";
import { displayItems, radioMenu, renderItems, styleItems, viewMenu } from "./viewMenu";
import type { CtxItem } from "../contextMenu";
import { resetViewSettings, setDisplay, setRender, viewSettings } from "../viewSettings";

type Sub = { kind: "submenu"; label: string; items: () => CtxItem[] };
type Row = CtxItem & { label: string };
const labels = (items: CtxItem[]) => items.map((i) => (i as Row).label);

describe("viewMenu", () => {
  beforeEach(() => { resetViewSettings(); });

  it("marks the current option in a radio submenu and applies the picked one", () => {
    let value = "a";
    const menu = radioMenu("Pick", [{ value: "a", label: "A" }, { value: "b", label: "B" }], () => value as "a" | "b", (v) => { value = v; });
    const items = (menu as Sub).items() as { label: string; run: () => void }[];
    expect(items.map((i) => i.label)).toEqual(["●  A", "○  B"]);
    items[1].run();
    expect(value).toBe("b");
  });

  it("lists the style, performance and display submenus and a reset row", () => {
    const top = viewMenu();
    expect(labels(top.filter((i) => i.kind !== "separator"))).toEqual(["Style", "Performance & resolution", "Display", "Reset view settings"]);
  });

  it("puts extra rows first and adds projector frusta only for the world view", () => {
    const extra: CtxItem[] = [{ kind: "action", label: "Extra", run: () => {} }];
    expect(labels(viewMenu(extra))[0]).toBe("Extra");
    const display = (viewMenu({}, { world: true }).find((i) => (i as Row).label === "Display") as unknown as Sub).items();
    expect(labels(display)).toContain("Projector frusta");
    const plain = (viewMenu().find((i) => (i as Row).label === "Display") as unknown as Sub).items();
    expect(labels(plain)).not.toContain("Projector frusta");
  });

  it("the reset row restores default view settings", () => {
    setRender({ fps: 15 });
    setDisplay({ coords: false });
    const reset = viewMenu().find((i) => (i as Row).label === "Reset view settings") as unknown as { run: () => void };
    reset.run();
    expect(viewSettings().render.fps).not.toBe(15);
    expect(viewSettings().display.coords).not.toBe(false);
  });

  it("style, render and display items reflect and change the settings", () => {
    expect(labels(styleItems())).toEqual(["Board look", "Piece set", "White pieces colour", "Black pieces colour", "Original piece colours"]);
    const quality = (renderItems()[0] as unknown as Sub).items() as { label: string; run: () => void }[];
    quality.find((i) => i.label.endsWith("High"))!.run();
    expect(viewSettings().render.quality).toBe("high");
    quality.find((i) => i.label.endsWith("Custom"))!.run();
    expect(viewSettings().render.quality).toBe("high");

    const aa = renderItems()[4] as unknown as { get: () => boolean; set: (v: boolean) => void };
    const before = aa.get();
    aa.set(!before);
    expect(viewSettings().render.aa).toBe(!before);

    const coords = displayItems()[0] as unknown as { get: () => boolean; set: (v: boolean) => void };
    coords.set(false);
    expect(coords.get()).toBe(false);
  });
});
