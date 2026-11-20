import { describe, expect, it } from "vitest";
import { GAP_MS, PerfAdvisor, SUSTAIN_MS, suggestions, type PerfSample } from "./perfAdvisor";

const base: PerfSample = { frameMs: 16, tickMs: 5, editorMs: 0, viewMs: 1, tab: 0, simple: true, heat: false, lite: false, quality: "medium", scale: 0.75, fps: 60 };
const slow = (p: Partial<PerfSample> = {}): PerfSample => ({ ...base, frameMs: 40, ...p });

describe("suggestions", () => {
  it("has nothing to say about a healthy setup", () => expect(suggestions(base)).toEqual([]));

  it("flags the 3D view when it is open and costly", () => {
    const t = suggestions(slow({ tab: 1, viewMs: 20 }));
    expect(t[0].id).toBe("three-d");
    expect(t[0].actions.map((a) => a.act)).toEqual(["table-tab", "quality-low"]);
  });

  it("does not blame the 3D view when another tab is open", () => expect(suggestions(slow({ tab: 0, viewMs: 20 })).some((t) => t.id === "three-d")).toBe(false));

  it("offers automatic node simplification only while the editor is visible and not yet lite", () => {
    expect(suggestions(slow({ simple: false, editorMs: 12 }))[0]).toMatchObject({ id: "lite-nodes", auto: true });
    expect(suggestions(slow({ simple: true, editorMs: 12 }))).toEqual([]);
    expect(suggestions(slow({ simple: false, editorMs: 12, lite: true }))).toEqual([]);
  });

  it("suggests a lighter table only when it is drawn at high quality", () => {
    expect(suggestions(slow({ viewMs: 12, scale: 1.5, fps: 0 }))[0].actions.map((a) => a.act)).toEqual(["quality-medium", "fps-30"]);
    expect(suggestions(slow({ viewMs: 12, scale: 0.75, fps: 30 }))).toEqual([]);
  });

  it("names the slowest node", () => {
    const t = suggestions(slow({ hot: { title: "Vision", avg: 30 } }));
    expect(t[0].id).toBe("heavy-node");
    expect(t[0].title).toContain("Vision");
  });

  it("ranks by how much time would be won back", () => {
    const t = suggestions(slow({ tab: 1, viewMs: 20, simple: false, editorMs: 4, heat: true }));
    expect(t.map((x) => x.id)).toEqual(["three-d", "lite-nodes", "heat"]);
  });
});

describe("PerfAdvisor", () => {
  it("stays quiet until the slowdown has lasted", () => {
    const a = new PerfAdvisor(), s = slow({ tab: 1, viewMs: 20 });
    expect(a.feed(1000, s)).toBeNull();
    expect(a.feed(1000 + SUSTAIN_MS - 1, s)).toBeNull();
    expect(a.feed(1000 + SUSTAIN_MS, s)?.id).toBe("three-d");
  });

  it("resets when the page recovers", () => {
    const a = new PerfAdvisor(), s = slow({ tab: 1, viewMs: 20 });
    a.feed(0, s); a.feed(3000, base); a.feed(6000, s);
    expect(a.feed(6000 + SUSTAIN_MS - 1, s)).toBeNull();
  });

  it("spaces notifications apart and does not repeat one it just gave", () => {
    const a = new PerfAdvisor(), s = slow({ tab: 1, viewMs: 20, simple: false, editorMs: 5 });
    a.feed(0, s);
    const first = a.feed(SUSTAIN_MS, s)!;
    expect(first.id).toBe("three-d");
    expect(a.feed(SUSTAIN_MS + 1000, s)).toBeNull();
    expect(a.feed(SUSTAIN_MS + GAP_MS, s)?.id).toBe("lite-nodes");
  });

  it("respects a muted tip", () => {
    const a = new PerfAdvisor(); a.mute("three-d");
    const s = slow({ tab: 1, viewMs: 20 });
    a.feed(0, s);
    expect(a.feed(SUSTAIN_MS, s)).toBeNull();
  });

  it("treats a heavy graph tick as struggling even when the average frame is fine", () => {
    const a = new PerfAdvisor(), s = { ...base, tickMs: 60, hot: { title: "Vision", avg: 50 } };
    a.feed(0, s);
    expect(a.feed(SUSTAIN_MS, s)?.id).toBe("heavy-node");
  });
});
