import { describe, expect, it, vi } from "vitest";
import { mixer } from "./mixer";

describe("mixer", () => {
  it("multiplies a bus level by the master, and mutes everything when muted", () => {
    mixer.set("master", 0.5); mixer.set("sfx", 0.5); mixer.setMuted(false);
    expect(mixer.gain("sfx")).toBeCloseTo(0.25);
    mixer.setMuted(true);
    expect(mixer.gain("sfx")).toBe(0);
    expect(mixer.toggleMuted()).toBe(false);
    expect(mixer.gain("sfx")).toBeCloseTo(0.25);
  });

  it("clamps levels to 0..1 and ignores non-numbers", () => {
    mixer.set("music", 3); expect(mixer.get().music).toBe(1);
    mixer.set("music", -2); expect(mixer.get().music).toBe(0);
    mixer.set("music", NaN); expect(mixer.get().music).toBe(0);
  });

  it("notifies subscribers and stops after unsubscribe", () => {
    const fn = vi.fn();
    const off = mixer.subscribe(fn);
    mixer.set("narration", 0.3);
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    mixer.set("narration", 0.4);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("persists levels to localStorage", () => {
    mixer.set("ambience", 0.2);
    expect(JSON.parse(localStorage.getItem("cx.mixer.v1")!).ambience).toBe(0.2);
  });
});
