import { describe, expect, it } from "vitest";
import { formatRoute, parseRoute } from "./route";
import { suggestNext } from "./nextSteps";

const steps = ["briefing", "cameras", "board"];
describe("routes", () => {
  it("round-trips pages and setup steps", () => {
    for (const h of ["#/table", "#/world", "#/log", "#/setup/board"]) expect(formatRoute(parseRoute(h, steps))).toBe(h);
  });
  it("falls back safely", () => {
    expect(parseRoute("", steps)).toEqual({ page: "table" });
    expect(parseRoute("#/nope", steps)).toEqual({ page: "table" });
    expect(parseRoute("#/setup/zzz", steps)).toEqual({ page: "setup", step: "briefing" });
    expect(parseRoute("#/SETUP/Cameras", steps)).toEqual({ page: "setup", step: "cameras" });
  });
});
describe("suggestNext", () => {
  const base = { route: { page: "table" } as const, setupDone: true, soundOn: true, boardFidelity: 1, cameras: 1 };
  it("sends unfinished setups to the wizard first", () => {
    expect(suggestNext({ ...base, setupDone: false })[0].to).toEqual({ page: "setup", step: "briefing" });
  });
  it("suggests calibration when the board is poorly read", () => {
    expect(suggestNext({ ...base, boardFidelity: 0.3 })[0].id).toBe("calibrate");
  });
  it("never repeats, respects the cap, and skips sound once on", () => {
    const ids = suggestNext({ ...base, soundOn: false }, 4).map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length); expect(ids).toContain("sound");
    expect(suggestNext(base).map((x) => x.id)).not.toContain("sound");
    expect(suggestNext(base, 2)).toHaveLength(2);
  });
});
