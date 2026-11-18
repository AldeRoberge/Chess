import { describe, expect, it } from "vitest";
import { Graph } from "./graph";
import { AMPLE_W, GROUP_COLORS, fitAround, nextGroupId, nodesInside, organize } from "./groups";
import { createRegistry } from "../plugins";
import { WORKFLOWS } from "../workflows";

describe("organize", () => {
  it("puts every node in exactly one section, by role, top to bottom, with titles and colours", () => {
    const g = new Graph(createRegistry()); g.load(WORKFLOWS[1].graph);
    const json = g.toJSON(); organize(json);
    const titles = json.groups!.map((s) => s.title);
    expect(titles).toEqual(["Demo & input", "Analysis", "Game & experience", "Output: sound & narration"]);
    expect(json.groups!.map((s) => s.color)).toEqual(GROUP_COLORS.slice(0, 4));
    for (let i = 1; i < json.groups!.length; i++) expect(json.groups![i].y).toBeGreaterThan(json.groups![i - 1].y + json.groups![i - 1].h - 1);
    const owner = new Map<string, string[]>();
    for (const s of json.groups!) for (const id of nodesInside(json, s)) owner.set(id, [...(owner.get(id) ?? []), s.title]);
    expect(owner.size).toBe(json.nodes.length);
    expect([...owner.values()].every((o) => o.length === 1)).toBe(true);
    const type = (id: string) => json.nodes.find((n) => n.id === id)!.type;
    for (const [id, [title]] of owner) {
      if (type(id).startsWith("narration.") || type(id).startsWith("scene.")) expect(title).toMatch(/^Output/);
      if (type(id).startsWith("vision.")) expect(title).toBe("Analysis");
      if (type(id).startsWith("sim.") || type(id).startsWith("source.")) expect(title).toBe("Demo & input");
    }
  });
  it("keeps pipeline order left to right and wraps long bands; unknown nodes go to Other", () => {
    const g = new Graph(createRegistry());
    const nodes = Array.from({ length: 7 }, (_, i) => g.addNode("vision.boardReader", 0, 0, {}, `r${i}`));
    const json = g.toJSON(); json.nodes.push({ id: "z", type: "mystery.node", x: 0, y: 0, params: {} });
    organize(json);
    const xs = json.nodes.filter((n) => n.type === "vision.boardReader").map((n) => n.x);
    expect(xs.slice(0, 5)).toEqual([...xs.slice(0, 5)].sort((a, b) => a - b));
    expect(new Set(json.nodes.slice(0, 7).map((n) => n.y)).size).toBe(2);
    expect(json.groups!.map((s) => s.title)).toEqual(["Analysis", "Other"]);
    expect(nodes).toHaveLength(7);
  });
  it("widens narrow nodes to ample width and keeps wider ones as they are", () => {
    const g = new Graph(createRegistry());
    g.addNode("vision.boardReader", 0, 0, {}, "narrow"); g.addNode("vision.boardReader", 0, 0, {}, "wide");
    const json = g.toJSON(); json.nodes.find((n) => n.id === "wide")!.w = 500;
    organize(json, () => ({ w: 320, h: 300 }));
    expect(json.nodes.find((n) => n.id === "narrow")!.w).toBe(AMPLE_W);
    expect(json.nodes.find((n) => n.id === "wide")!.w).toBe(500);
  });
  it("orders by wire depth and survives feedback loops", () => {
    const g = new Graph(createRegistry());
    const t = g.addNode("game.tracker"), d = g.addNode("experience.director");
    g.connect({ node: d.id, port: "director" }, { node: t.id, port: "director" }); g.connect({ node: t.id, port: "events" }, { node: d.id, port: "events" });
    const json = g.toJSON(); organize(json); expect(json.groups).toHaveLength(1);
  });
});

describe("helpers", () => {
  it("fitAround leaves room for the title; ids never collide; nodesInside uses centres", () => {
    expect(fitAround([{ x: 100, y: 100, w: 200, h: 100 }])).toEqual({ x: 76, y: 36, w: 248, h: 188 });
    expect(nextGroupId([])).toBe("g1"); expect(nextGroupId([{ id: "g2" } as any])).toBe("g3"); expect(nextGroupId([{ id: "g1" } as any, { id: "g2" } as any])).toBe("g3");
    const s = { id: "g", title: "", color: "", x: 0, y: 0, w: 300, h: 300 };
    expect(nodesInside({ nodes: [{ id: "in", x: 10, y: 10 }, { id: "out", x: 900, y: 10 }, { id: "big", x: 250, y: 10, w: 50, h: 50 }] }, s)).toEqual(["in", "big"]);
  });
});

describe("groups in the graph", () => {
  it("round-trip through toJSON / load and older saves without groups still load", () => {
    const g = new Graph(createRegistry()); g.load(WORKFLOWS[0].graph);
    expect(g.groups.length).toBeGreaterThan(0);
    const copy = new Graph(createRegistry()); copy.load(g.toJSON()); expect(copy.groups).toEqual(g.groups);
    copy.load({ nodes: [], edges: [] }); expect(copy.groups).toEqual([]);
  });
  it("the shipped demos each arrive with titled sections", () => {
    for (const w of WORKFLOWS) expect(w.graph.groups!.length).toBeGreaterThanOrEqual(3);
  });
});
