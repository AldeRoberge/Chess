import { describe, expect, it } from "vitest";
import { CORNER_MEMORY_DAYS, recallCorners, rememberCorners } from "./cornerMemory";

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
describe("corner memory", () => {
  it("returns what was saved for the same camera and nothing for another", () => {
    const s = mem(); rememberCorners("Logitech C920", "1,1 2,1 2,2 1,2", 1000, s);
    expect(recallCorners("Logitech C920", 2000, s)).toBe("1,1 2,1 2,2 1,2");
    expect(recallCorners("Other cam", 2000, s)).toBeNull();
  });
  it("forgets corners older than the memory window and survives bad storage", () => {
    const s = mem(); rememberCorners("cam", "a", 0, s);
    expect(recallCorners("cam", (CORNER_MEMORY_DAYS + 1) * 864e5, s)).toBeNull();
    s.setItem("cx.cameraCorners.v1", "{nope"); expect(recallCorners("cam", 0, s)).toBeNull();
    expect(() => rememberCorners("cam", "b", 0, s)).not.toThrow();
  });
});
