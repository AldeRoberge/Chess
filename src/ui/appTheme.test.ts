import { describe, expect, it } from "vitest";
import { APP_THEMES, applyAppTheme, nextMode, pickMode, pickTheme, resolveMode, setAppMode, setAppTheme } from "./appTheme";

describe("app theme", () => {
  it("resolves system mode from the OS scheme", () => {
    expect(resolveMode("system", true)).toBe("dark");
    expect(resolveMode("system", false)).toBe("light");
    expect(resolveMode("light", true)).toBe("light");
  });
  it("falls back to defaults for unknown values", () => {
    expect(pickTheme("nope").id).toBe(APP_THEMES[0].id);
    expect(pickMode("nope")).toBe("dark");
  });
  it("cycles dark, light, system", () => {
    expect(nextMode("dark")).toBe("light");
    expect(nextMode("light")).toBe("system");
    expect(nextMode("system")).toBe("dark");
  });
  it("applies and persists to the document", () => {
    setAppTheme("glass"); setAppMode("light");
    expect(document.documentElement.dataset.theme).toBe("glass");
    expect(document.documentElement.dataset.mode).toBe("light");
    expect(localStorage.getItem("ce-app-theme")).toBe("glass");
    setAppTheme("classic"); setAppMode("dark"); applyAppTheme();
    expect(document.documentElement.dataset.mode).toBe("dark");
  });
});
