import { describe, expect, it, vi } from "vitest";
import { createRegistry } from "../plugins";
import { Graph } from "../core/graph";
import { createAppHost, type AppHostDeps } from "./appHost";

const deps = (over: Partial<AppHostDeps> = {}) => {
  const registry = createRegistry(), graph = new Graph(registry), a = graph.addNode("game.tracker", 0, 0), history = { canUndo: true, canRedo: false };
  const d: AppHostDeps = { registry, graph, loadSetup: () => null, applySetup: vi.fn(), applyGraph: vi.fn(), persist: vi.fn(), toggleBypass: vi.fn((id) => { graph.nodes.get(id)!.bypass = !graph.nodes.get(id)!.bypass; }), selection: () => [a.id], route: () => ({ page: "table" }), go: vi.fn(), history, undo: vi.fn(), redo: vi.fn(), table: {} as any, sound: () => ({ on: false, muted: true }), now: () => 5, ...over };
  return { d, host: createAppHost(d), graph, id: a.id, history };
};

describe("app host adapter", () => {
  it("sets params and bypass only on nodes that exist, and saves the change", () => {
    const { d, host, graph, id } = deps();
    expect(host.setParam("zz", "x", 1)).toBe(false); expect(host.setParam(id, "x", 1)).toBe(true); expect(graph.nodes.get(id)!.params.x).toBe(1); expect(d.persist).toHaveBeenCalledTimes(1);
    expect(host.setBypass("zz", true)).toBe(false); expect(host.setBypass(id, true)).toBe(true); expect(host.setBypass(id, true)).toBe(true); expect(d.toggleBypass).toHaveBeenCalledTimes(1);
  });
  it("lists node errors with their node type", () => {
    const { host, graph, id } = deps(); graph.stats.set(id, { ms: 1, fidelity: null, error: "boom", errorHint: "fix" }); graph.stats.set("gone", { ms: 1, fidelity: null, error: "orphan" }); graph.stats.set("fine", { ms: 1, fidelity: 1 });
    expect(host.nodeErrors()).toEqual([{ node: id, type: "game.tracker", message: "boom", hint: "fix" }, { node: "gone", type: "?", message: "orphan", hint: undefined }]);
  });
  it("undo and redo report whether there was anything to take back", () => {
    const { d, host, history } = deps();
    expect(host.undo()).toBe(true); expect(d.undo).toHaveBeenCalled(); expect(host.redo()).toBe(false); history.canUndo = false; history.canRedo = true;
    expect(host.undo()).toBe(false); expect(host.redo()).toBe(true); expect(host.canUndo()).toBe(false); expect(host.canRedo()).toBe(true);
    expect(host.graph().nodes).toHaveLength(1); expect(host.selection()).toHaveLength(1); expect(host.now()).toBe(5); expect(host.setup()).toBeNull();
  });
});
