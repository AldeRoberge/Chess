import { describe, expect, it } from "vitest";
import { formatRoute, parseRoute } from "./route";
import { suggestNext } from "./nextSteps";

const steps = ["briefing", "cameras", "board"];
describe("routes", () => {
  it("round-trips pages and settings steps", () => {
    for (const h of ["#/table", "#/world", "#/log", "#/settings/board"]) expect(formatRoute(parseRoute(h, steps))).toBe(h);
  });
  it("falls back safely, and old setup links still open settings", () => {
    expect(parseRoute("", steps)).toEqual({ page: "table" });
    expect(parseRoute("#/nope", steps)).toEqual({ page: "table" });
    expect(parseRoute("#/settings/zzz", steps)).toEqual({ page: "settings", step: "briefing" });
    expect(parseRoute("#/SETTINGS/Cameras", steps)).toEqual({ page: "settings", step: "cameras" });
    expect(parseRoute("#/setup/board", steps)).toEqual({ page: "settings", step: "board" });
    expect(formatRoute(parseRoute("#/setup/board", steps))).toBe("#/settings/board");
  });
});
describe("suggestNext", () => {
  const base = { route: { page: "table" } as const, setupDone: true, soundOn: true, boardFidelity: 1, cameras: 1 };
  it("sends unfinished setups to the wizard first", () => {
    expect(suggestNext({ ...base, setupDone: false })[0].to).toEqual({ page: "settings", step: "briefing" });
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
