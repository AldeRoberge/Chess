import { describe, expect, it } from "vitest";
import type { GraphJSON } from "../core/types";
import { splitBoardReaders } from "./splitReader";

const base = (): GraphJSON => ({
  nodes: [
    { id: "cam", type: "source.webcam", x: 0, y: 0, params: {} },
    { id: "rd", type: "vision.boardReader", x: 300, y: 0, params: { cam: "B", corners: "1,2;3,4;5,6;7,8", weight: 1.5, autoFind: false } },
    { id: "fuse", type: "vision.fuse", x: 600, y: 0, params: {} },
  ],
  edges: [{ id: "a", from: { node: "cam", port: "frame" }, to: { node: "rd", port: "frame" } }, { id: "b", from: { node: "rd", port: "obs" }, to: { node: "fuse", port: "o1" } }],
});

describe("splitBoardReaders", () => {
  it("replaces a Board Reader with the detector chain, keeping its camera, corners, trust and wiring", () => {
    const g = splitBoardReaders(base());
    expect(g.nodes.some((n) => n.type === "vision.boardReader")).toBe(false);
    const types = g.nodes.map((n) => n.type);
    for (const t of ["vision.clean", "vision.flatten", "vision.brightness", "vision.neuralBoard", "vision.neuralSquares", "vision.blend", "vision.observe"]) expect(types).toContain(t);
    const flat = g.nodes.find((n) => n.type === "vision.flatten")!, obs = g.nodes.find((n) => n.type === "vision.observe")!;
    expect(flat.params).toMatchObject({ cam: "B", corners: "1,2;3,4;5,6;7,8", autoFind: false }); expect(obs.params.weight).toBe(1.5);
    const into = g.edges.find((e) => e.from.node === "cam")!, clean = g.nodes.find((n) => n.type === "vision.clean")!;
    expect(into.to).toEqual({ node: clean.id, port: "frame" });
    expect(g.edges.find((e) => e.to.node === "fuse")!.from).toEqual({ node: obs.id, port: "obs" });
    expect(g.edges.filter((e) => /^r[0-9]$/.test(e.to.port)).map((e) => e.to.port).sort()).toEqual(["r1", "r2", "r3"]);
    expect(g.nodes.find((n) => n.id === "fuse")!.x).toBeGreaterThan(600 + 5 * 322); // room was made for the chain
    expect(new Set([...g.nodes.map((n) => n.id), ...g.edges.map((e) => e.id)]).size).toBe(g.nodes.length + g.edges.length);
  });
  it("leaves a graph without Board Readers alone", () => {
    const g = { nodes: [], edges: [] } as GraphJSON;
    expect(splitBoardReaders(g)).toBe(g);
  });
});
