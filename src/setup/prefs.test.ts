import { beforeEach, describe, expect, it } from "vitest";
import { clearPrefs, loadPrefs, patchPrefs } from "./prefs";

describe("prefs", () => {
  beforeEach(() => localStorage.clear());
  it("merges patches, survives corrupt data, and clears", () => {
    expect(loadPrefs()).toEqual({});
    patchPrefs({ tab: 2 });
    patchPrefs({ view: { x: 1, y: 2, k: 1 } });
    expect(loadPrefs()).toEqual({ tab: 2, view: { x: 1, y: 2, k: 1 } });
    localStorage.setItem("cx.prefs.v1", "{nope");
    expect(loadPrefs()).toEqual({});
    patchPrefs({ tab: 1 }); clearPrefs();
    expect(loadPrefs()).toEqual({});
  });
});
