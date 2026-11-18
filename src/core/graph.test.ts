import { describe, expect, it } from "vitest";
import { Graph } from "./graph";
import { Registry } from "./types";

function reg() {
  const r = new Registry();
  r.register({ type: "src", title: "src", category: "Source", inputs: [], outputs: [{ id: "o", type: "text" }], process: () => ({ o: 2 }) });
  r.register({
    type: "dbl", title: "dbl", category: "Game",
    inputs: [{ id: "i", type: "text" }], outputs: [{ id: "o", type: "text" }],
    process: (i) => ({ o: (i.i ?? 0) * 2 }),
  });
  r.register({ type: "ev", title: "ev", category: "Game", inputs: [], outputs: [{ id: "o", type: "event" }], process: () => ({ o: 1 }) });
  return r;
}

describe("graph.restore (undo / redo in place)", () => {
  it("keeps the runtime state of surviving nodes, and adds, removes and edits only what differs", () => {
    const g = new Graph(reg()), a = g.addNode("src", 1, 2), b = g.addNode("dbl", 3, 4, { k: 1 });
    g.connect({ node: a.id, port: "o" }, { node: b.id, port: "i" });
    const snap = JSON.parse(JSON.stringify(g.toJSON())); const stateA = {}; g.states.set(a.id, stateA); // snapshots are serialised, like the history stores them
    const c = g.addNode("dbl"); g.connect({ node: b.id, port: "o" }, { node: c.id, port: "i" }); a.x = 99; b.params.k = 7; b.bypass = true; g.groups.push({ id: "g1", title: "s", x: 0, y: 0, w: 10, h: 10, color: "#fff" } as any);
    g.restore(snap);
    expect(g.nodes.has(c.id)).toBe(false); expect(g.edges).toHaveLength(1); expect(g.groups).toHaveLength(0);
    expect(g.nodes.get(a.id)).toBe(a); expect(g.states.get(a.id)).toBe(stateA); // same object, same state
    expect(a.x).toBe(1); expect(b.params.k).toBe(1); expect(b.bypass).toBeUndefined();
    g.restore({ nodes: [...snap.nodes, { id: "z9", type: "src", x: 0, y: 0, params: {} }], edges: snap.edges });
    expect(g.nodes.has("z9")).toBe(true); expect(g.states.get(a.id)).toBe(stateA);
  });
  it("drops wires that no longer fit and recreates a node whose type changed", () => {
    const g = new Graph(reg()), a = g.addNode("src"), b = g.addNode("dbl");
    g.restore({ nodes: [{ id: a.id, type: "src", x: 0, y: 0, params: {} }, { id: b.id, type: "ev", x: 0, y: 0, params: {} }], edges: [{ id: "e1", from: { node: a.id, port: "o" }, to: { node: b.id, port: "i" } }] });
    expect(g.nodes.get(b.id)!.type).toBe("ev"); expect(g.edges).toHaveLength(0); // "ev" has no input i
  });
});

describe("graph", () => {
  it("evaluates in topological order regardless of insertion order", () => {
    const g = new Graph(reg());
    const b = g.addNode("dbl");
    const c = g.addNode("dbl");
    const a = g.addNode("src");
    g.connect({ node: a.id, port: "o" }, { node: b.id, port: "i" });
    g.connect({ node: b.id, port: "o" }, { node: c.id, port: "i" });
    g.tick(0);
    expect(g.outputs.get(c.id)!.o).toBe(8);
  });
  it("rejects mismatched port types and self loops", () => {
    const g = new Graph(reg());
    const a = g.addNode("ev");
    const b = g.addNode("dbl");
    expect(g.connect({ node: a.id, port: "o" }, { node: b.id, port: "i" })).toBeNull();
    expect(g.canConnect({ node: b.id, port: "o" }, { node: b.id, port: "i" })).toBe(false);
  });
  it("survives cycles using cached outputs and isolates node errors", () => {
    const g = new Graph(reg());
    const a = g.addNode("dbl");
    const b = g.addNode("dbl");
    g.connect({ node: a.id, port: "o" }, { node: b.id, port: "i" });
    g.connect({ node: b.id, port: "o" }, { node: a.id, port: "i" });
    expect(() => g.tick(0)).not.toThrow();
  });
  it("round-trips JSON", () => {
    const g = new Graph(reg());
    const a = g.addNode("src");
    const b = g.addNode("dbl");
    g.connect({ node: a.id, port: "o" }, { node: b.id, port: "i" });
    const g2 = new Graph(reg());
    g2.load(g.toJSON());
    expect(g2.edges).toHaveLength(1);
  });
});
