import { afterEach, describe, expect, it, vi } from "vitest";
import { firstRun, showSplash, SPLASH_KEY, SPLASH_MS } from "./splash";

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ""; });

describe("splash", () => {
  it("is first-run only", () => {
    const m = new Map<string, string>(); const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(firstRun(s)).toBe(true); expect(m.has(SPLASH_KEY)).toBe(true); expect(firstRun(s)).toBe(false);
    expect(firstRun({ getItem: () => { throw new Error("x"); }, setItem: () => {} })).toBe(false);
  });
  it("shows name, logo and version, then removes itself", async () => {
    vi.useFakeTimers(); const p = showSplash();
    const el = document.querySelector(".splash")!;
    expect(el.textContent).toContain("Chess XP"); expect(el.querySelector(".splash-knight")).not.toBeNull(); expect(el.querySelector(".splash-ver")!.textContent).toMatch(/^v\d/);
    vi.advanceTimersByTime(SPLASH_MS); await p; expect(document.querySelector(".splash")).toBeNull();
  });
  it("skips on key press", async () => {
    const p = showSplash(); dispatchEvent(new KeyboardEvent("keydown", { key: "a" })); await p; expect(document.querySelector(".splash")).toBeNull();
  });
});
