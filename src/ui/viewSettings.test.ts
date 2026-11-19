import { beforeEach, describe, expect, it } from "vitest";
import { dueFrame, pixelRatio, resetViewSettings, setDisplay, setQuality, setRender, viewSettings } from "./viewSettings";

beforeEach(() => { localStorage.clear(); resetViewSettings(); });

describe("view settings", () => {
  it("presets set every value, and a manual change falls back to custom (or back to a matching preset)", () => {
    setQuality("low"); expect(viewSettings().render).toMatchObject({ scale: 0.5, fps: 30, aa: false, shadows: "off", quality: "low" });
    setRender({ fps: 60 }); expect(viewSettings().render.quality).toBe("custom");
    setRender({ fps: 30 }); expect(viewSettings().render.quality).toBe("low");
  });
  it("persists across loads and resets to defaults", () => {
    setDisplay({ coords: false, flip: true }); expect(JSON.parse(localStorage.getItem("cx.prefs.v1")!).view2.display.coords).toBe(false);
    expect(viewSettings().display.flip).toBe(true);
    resetViewSettings(); expect(viewSettings().display.coords).toBe(true); expect(viewSettings().display.flip).toBe(false);
  });
  it("gates frames by the cap and clamps the pixel ratio", () => {
    expect(dueFrame(100, 0, 0)).toBe(true); expect(dueFrame(110, 100, 30)).toBe(false); expect(dueFrame(140, 100, 30)).toBe(true);
    expect(pixelRatio(0.5, 2)).toBe(0.5); expect(pixelRatio(1.5, 1)).toBe(1); expect(pixelRatio(0, 2)).toBe(2);
  });
});
