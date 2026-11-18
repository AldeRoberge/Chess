import { describe, expect, it } from "vitest";
import { CueEngine } from "./cues";

describe("CueEngine", () => {
  it("queen capture strobes DMX, flashes and schedules thunder; ordinary capture is subtle", () => {
    const c = new CueEngine();
    c.fire([{ type: "capture", t: 0, data: { captured: "q" } }], 0);
    const fired = c.tick(0).map((f) => f.action.do);
    expect(fired).toContain("thunder");
    expect(c.state.flash).toBe(1);
    expect(c.state.dmx[0]).toBe(255);
    c.tick(40);
    expect(c.state.dmx[0]).toBe(0);
    const c2 = new CueEngine();
    c2.fire([{ type: "capture", t: 0, data: { captured: "p" } }], 0);
    expect(c2.tick(0).map((f) => f.action.do)).not.toContain("thunder");
  });
  it("phase changes switch scenes", () => {
    const c = new CueEngine();
    c.fire([{ type: "phase", t: 0, data: { phase: "game" } }], 0);
    c.tick(0);
    expect(c.state.scene).toBe("fire-watchtower");
    expect(c.state.rain).toBeGreaterThan(0);
  });
});
