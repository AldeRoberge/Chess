import { describe, expect, it } from "vitest";
import { CE_EXTENSION, CE_VERSION, ceFileName, parseCe, serializeCe } from "./ceFile";

const g = (n: number) => ({ nodes: Array.from({ length: n }, (_, i) => ({ id: `n${i}`, type: "x", x: 0, y: 0, params: {} })), edges: [] }) as any;

describe("Chess Experience .ce.json files", () => {
  it("round-trips the graph and setup in a tagged envelope", () => {
    const text = serializeCe(g(2), { completed: true } as any, 1234);
    const j = JSON.parse(text);
    expect(j).toMatchObject({ format: "chess-experience", version: CE_VERSION, savedAt: 1234 });
    const back = parseCe(text);
    expect(back.ok && back.graph.nodes).toHaveLength(2);
    expect(back.ok && back.setup).toEqual({ completed: true });
  });

  it("names saved files with the .ce.json extension", () => {
    expect(ceFileName()).toBe("chess-experience-workflow" + CE_EXTENSION);
    expect(ceFileName("my.ce.json")).toBe("my" + CE_EXTENSION);
    expect(ceFileName("my.json")).toBe("my" + CE_EXTENSION);
  });

  it("still opens legacy exports and backup-style files", () => {
    const legacy = parseCe(JSON.stringify({ app: "chess-experience", graph: g(3), setup: null }));
    expect(legacy.ok && legacy.graph.nodes).toHaveLength(3);
    expect(parseCe(JSON.stringify(g(1))).ok).toBe(true);
  });

  it("rejects other files with a reason", () => {
    expect(parseCe("nope")).toEqual({ ok: false, error: "That file is not a Chess Experience file." });
    expect(parseCe("{}").ok).toBe(false);
    expect(parseCe(JSON.stringify({ format: "other", version: 1, graph: g(1) })).ok).toBe(false);
    expect(parseCe(JSON.stringify({ format: "chess-experience", version: 1 })).ok).toBe(false);
  });

  it("refuses files from a newer format version", () => {
    const r = parseCe(JSON.stringify({ format: "chess-experience", version: CE_VERSION + 1, graph: g(1) }));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("newer version");
  });
});
