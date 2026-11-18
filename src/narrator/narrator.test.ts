import { describe, expect, it } from "vitest";
import { Narrator } from "./narrator";

describe("Narrator", () => {
  it("announces the player and uses two voices on a queen capture", () => {
    const n = new Narrator();
    expect(n.handle([{ type: "seat", t: 0 }])[0].priority).toBe(3);
    const l = n.handle([{ type: "capture", t: 10000, data: { color: "w", piece: "p", captured: "q", to: "d5" } }]);
    expect(new Set(l.map((x) => x.speaker))).toEqual(new Set(["A", "B"]));
    expect(l[0].text).toContain("dame");
  });
  it("single-voice mode never uses speaker B", () => {
    const n = new Narrator({ voices: 1, names: ["Jean", "Margot"], seed: 1, minGapMs: 0 });
    const l = n.handle([{ type: "check", t: 5000, data: {} }]);
    expect(l.every((x) => x.speaker === "A")).toBe(true);
  });
});
