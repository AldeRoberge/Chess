import { describe, expect, it, vi } from "vitest";
import { bus, pushLog } from "./bus";
import { Graph } from "./graph";
import { Registry, portsCompatible, type NodeSpec } from "./types";

const spec = (over: Partial<NodeSpec> & { type: string }): NodeSpec => ({ title: over.type, category: "Game", inputs: [], outputs: [], process: () => undefined, ...over });
const reg = () => {
  const r = new Registry();
  r.register(spec({ type: "num", outputs: [{ id: "o", type: "text" }], params: [{ id: "v", kind: "number", label: "v", min: 0, max: 9, value: 2 }], process: (_i, rt) => ({ o: rt.params.v }) }));
  r.register(spec({ type: "dbl", inputs: [{ id: "i", type: "text" }], outputs: [{ id: "o", type: "text" }], process: (i) => ({ o: (i.i ?? 0) * 2 }) }));
  r.register(spec({ type: "add", inputs: [{ id: "a", type: "text" }, { id: "b", type: "text" }], outputs: [{ id: "o", type: "text" }], process: (i) => ({ o: i.a + i.b }) }));
  r.register(spec({ type: "ev", outputs: [{ id: "o", type: "event" }], process: () => ({ o: [] }) }));
  r.register(spec({ type: "any", inputs: [{ id: "i", type: "any" }] }));
  r.register(spec({ type: "boom", process: () => { throw new Error("kaput"); } }));
  return r;
};

describe("Registry & plugins", () => {
  it("registers specs, lists them, and installs plugins (remembering them)", () => {
    const r = new Registry(), seen: string[] = [];
    const ret = r.use({ id: "p1", name: "Plugin One", register: (reg) => { reg.register(spec({ type: "a" })); seen.push("p1"); } });
    expect(ret).toBe(r); expect(r.get("a")!.type).toBe("a"); expect(r.get("zzz")).toBeUndefined();
    expect(r.all().map((s) => s.type)).toEqual(["a"]); expect(r.pluginList()).toEqual([{ id: "p1", name: "Plugin One" }]); expect(seen).toEqual(["p1"]);
  });
  it("port compatibility: equal types or 'any'", () => {
    expect(portsCompatible("frame", "frame")).toBe(true); expect(portsCompatible("frame", "obs")).toBe(false);
    expect(portsCompatible("any", "obs")).toBe(true); expect(portsCompatible("event", "any")).toBe(true);
  });
});

describe("Graph", () => {
  it("creates nodes with parameter defaults, overridable, with generated unique ids", () => {
    const g = new Graph(reg());
    const a = g.addNode("num"), b = g.addNode("num", 10, 20, { v: 7 });
    expect(a.params.v).toBe(2); expect(b.params.v).toBe(7); expect(a.id).not.toBe(b.id); expect([b.x, b.y]).toEqual([10, 20]);
    expect(g.uid("q")).toMatch(/^q\d+$/);
  });
  it("rejects unknown node types", () => { expect(() => new Graph(reg()).addNode("nope")).toThrow("unknown node type nope"); });
  it("runs nodes in dependency order and passes values along", () => {
    const g = new Graph(reg());
    const d2 = g.addNode("dbl"), d1 = g.addNode("dbl"), n = g.addNode("num");
    g.connect({ node: n.id, port: "o" }, { node: d1.id, port: "i" });
    g.connect({ node: d1.id, port: "o" }, { node: d2.id, port: "i" });
    g.tick(0);
    expect(g.outputs.get(d2.id)!.o).toBe(8);
    expect(g.stats.get(n.id)!.ms).toBeGreaterThanOrEqual(0);
  });
  it("waits for every input of a node with several incoming wires", () => {
    const g = new Graph(reg()), add = g.addNode("add"), x = g.addNode("num", 0, 0, { v: 3 }), y = g.addNode("num", 0, 0, { v: 4 });
    g.connect({ node: x.id, port: "o" }, { node: add.id, port: "a" }); g.connect({ node: y.id, port: "o" }, { node: add.id, port: "b" });
    g.tick(0); expect(g.outputs.get(add.id)!.o).toBe(7);
  });
  it("gives nodes dt (clamped to 250ms), now, params, state and fidelity reporting", () => {
    const r = reg(), seen: any[] = [];
    r.register(spec({ type: "probe", init: () => ({ n: 0 }), process: (_i, rt) => { rt.state.n++; rt.setFidelity(0.5); seen.push([rt.dt, rt.now, rt.state.n]); } }));
    const g = new Graph(r), p = g.addNode("probe");
    g.tick(1000); g.tick(1100); g.tick(5000);
    expect(seen).toEqual([[0, 1000, 1], [0.1, 1100, 2], [0.25, 5000, 3]]);
    expect(g.stats.get(p.id)!.fidelity).toBe(0.5);
  });
  it("refuses mismatched, self, and dangling connections; accepts 'any'", () => {
    const g = new Graph(reg());
    const ev = g.addNode("ev"), d = g.addNode("dbl"), any = g.addNode("any");
    expect(g.connect({ node: ev.id, port: "o" }, { node: d.id, port: "i" })).toBeNull();
    expect(g.canConnect({ node: d.id, port: "o" }, { node: d.id, port: "i" })).toBe(false);
    expect(g.canConnect({ node: "ghost", port: "o" }, { node: d.id, port: "i" })).toBe(false);
    expect(g.canConnect({ node: ev.id, port: "o" }, { node: "ghost", port: "i" })).toBe(false);
    expect(g.canConnect({ node: ev.id, port: "nope" }, { node: d.id, port: "i" })).toBe(false);
    expect(g.canConnect({ node: ev.id, port: "o" }, { node: any.id, port: "i" })).toBe(true);
  });
  it("keeps one wire per input port (a new wire replaces the old) and can disconnect", () => {
    const g = new Graph(reg());
    const a = g.addNode("num"), b = g.addNode("num"), d = g.addNode("dbl");
    g.connect({ node: a.id, port: "o" }, { node: d.id, port: "i" });
    const e2 = g.connect({ node: b.id, port: "o" }, { node: d.id, port: "i" })!;
    expect(g.edges).toHaveLength(1); expect(g.edges[0].from.node).toBe(b.id);
    g.disconnect(e2.id); expect(g.edges).toHaveLength(0);
  });
  it("tolerates cycles by reading the previous tick's output", () => {
    const g = new Graph(reg()), a = g.addNode("dbl"), b = g.addNode("dbl");
    g.connect({ node: a.id, port: "o" }, { node: b.id, port: "i" }); g.connect({ node: b.id, port: "o" }, { node: a.id, port: "i" });
    expect(() => { g.tick(0); g.tick(1); }).not.toThrow();
    expect(g.outputs.has(a.id) && g.outputs.has(b.id)).toBe(true);
  });
  it("isolates a failing node: records the error, other nodes keep running", () => {
    const g = new Graph(reg()), boom = g.addNode("boom"), n = g.addNode("num");
    g.tick(0);
    expect(g.stats.get(boom.id)!.error).toContain("kaput"); expect(g.stats.get(boom.id)!.fidelity).toBeNull(); expect(g.outputs.get(n.id)!.o).toBe(2);
  });
  it("bypassed nodes output nothing", () => {
    const g = new Graph(reg()), n = g.addNode("num"); n.bypass = true;
    g.tick(0); expect(g.outputs.get(n.id)).toEqual({});
  });
  it("forwards node events to listeners", () => {
    const r = reg();
    r.register(spec({ type: "emit", process: (_i, rt) => rt.emit("hello", 42) }));
    const g = new Graph(r), fn = vi.fn(); g.listeners.add(fn);
    const n = g.addNode("emit"); g.tick(0);
    expect(fn).toHaveBeenCalledWith(n.id, "hello", 42);
  });
  it("removes nodes with their wires and state, calling dispose; ignores unknown ids", () => {
    const dispose = vi.fn(), r = reg();
    r.register(spec({ type: "res", init: () => ({ k: 1 }), dispose }));
    const g = new Graph(r), res = g.addNode("res"), d = g.addNode("dbl"), n = g.addNode("num");
    g.connect({ node: n.id, port: "o" }, { node: d.id, port: "i" });
    g.removeNode(d.id); expect(g.edges).toHaveLength(0); // wire to a removed destination goes too
    g.connect({ node: n.id, port: "o" }, { node: g.addNode("dbl").id, port: "i" });
    g.removeNode(n.id); expect(g.edges).toHaveLength(0); // and from a removed source
    g.removeNode(res.id); expect(dispose).toHaveBeenCalledWith({ k: 1 }); expect(g.states.has(res.id)).toBe(false);
    expect(() => g.removeNode("ghost")).not.toThrow();
  });
  it("serialises to JSON and loads it back over an existing graph", () => {
    const g = new Graph(reg()), n = g.addNode("num", 5, 6, { v: 9 }), d = g.addNode("dbl");
    g.connect({ node: n.id, port: "o" }, { node: d.id, port: "i" });
    const json = g.toJSON();
    const g2 = new Graph(reg()); g2.addNode("num");
    g2.load(json);
    expect(g2.nodes.size).toBe(2); expect(g2.edges).toHaveLength(1); expect(g2.nodes.get(n.id)!.params.v).toBe(9); g2.tick(0);
    expect(g2.outputs.get(d.id)!.o).toBe(18);
  });
});

describe("bus", () => {
  it("pushLog appends and trims to the newest N", () => {
    const a = [1, 2, 3]; pushLog(a, [4, 5], 4);
    expect(a).toEqual([2, 3, 4, 5]);
    const b = [1]; pushLog(b, [2]); expect(b).toEqual([1, 2]);
  });
  it("exposes the shared state slots", () => { expect(Object.keys(bus)).toEqual(expect.arrayContaining(["board", "game", "director", "scene", "poses", "lines", "events", "engineHint", "cameras"])); });
});
