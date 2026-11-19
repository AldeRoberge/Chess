import { afterEach, describe, expect, it, vi } from "vitest";
import { firstRun, fromHotReload, HMR_KEY, showSplash, splashAge, SPLASH_KEY, SPLASH_MS } from "./splash";

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ""; });

describe("splash", () => {
  it("is first-run only", () => {
    const m = new Map<string, string>(); const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(firstRun(s)).toBe(true); expect(m.has(SPLASH_KEY)).toBe(true); expect(firstRun(s)).toBe(false);
    expect(firstRun({ getItem: () => { throw new Error("x"); }, setItem: () => {} })).toBe(false);
  });
  it("skips only the load that follows a hot reload", () => {
    const m = new Map<string, string>();
    const s = { getItem: (k: string) => m.get(k) ?? null, removeItem: (k: string) => void m.delete(k) };
    expect(fromHotReload(s)).toBe(false);
    m.set(HMR_KEY, "1");
    expect(fromHotReload(s)).toBe(true); expect(m.has(HMR_KEY)).toBe(false); expect(fromHotReload(s)).toBe(false);
    expect(fromHotReload({ getItem: () => { throw new Error("x"); }, removeItem: () => {} })).toBe(false);
  });
  it("shows name, logo and version, then removes itself", async () => {
    vi.useFakeTimers(); const p = showSplash();
    const el = document.querySelector(".splash")!;
    expect(el.textContent).toContain("Chess XP"); expect(el.querySelector(".splash-knight")).not.toBeNull(); expect(el.querySelector(".splash-ver")!.textContent).toMatch(/^built /);
    vi.advanceTimersByTime(SPLASH_MS); await p; expect(document.querySelector(".splash")).toBeNull();
  });
  it("says how long ago this build was made", () => {
    const t = Date.parse("2026-11-18T12:00:00Z");
    expect(splashAge(t, t + 10_000)).toBe("built just now");
    expect(splashAge(t, t + 5 * 60_000)).toBe("built 5 min ago");
    expect(splashAge(t, t + 3 * 3_600_000)).toBe("built 3 h ago");
    expect(splashAge(t, t + 2 * 86_400_000)).toBe("built 2 d ago");
    expect(splashAge(Number.NaN, t)).toBe("build time unknown");
  });
  it("skips on key press", async () => {
    const p = showSplash(); dispatchEvent(new KeyboardEvent("keydown", { key: "a" })); await p; expect(document.querySelector(".splash")).toBeNull();
  });
});
