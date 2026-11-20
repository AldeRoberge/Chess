import { Chess } from "chess.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bus } from "../core/bus";
import { buildTools } from "./tools";
import { fakeHost, scripted } from "./testHost";
import { readUI, appMap } from "./uiContext";
import { gameContext } from "./tools/chess";
import { ChatSession } from "./session";
import { createAppHost } from "./appHost";
import * as analysis from "../chess/analysis";

const ctx = () => ({ signal: new AbortController().signal, confirm: vi.fn(async () => true), choose: vi.fn(async () => "") });
const tool = (h: ReturnType<typeof fakeHost>, name: string) => buildTools(h.host).find(t => t.name === name)!;
beforeEach(() => { bus.game = null; bus.board = null; bus.cameras = []; bus.events = []; bus.botColor = null; document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("workflow tools", () => {
  it("duplicates selected nodes and only their internal wires, preserving original runtime state", () => {
    const h = fakeHost(), from = h.graph.addNode("vision.fuse", 10, 20), to = h.graph.addNode("vision.stabilize", 300, 20);
    const out = h.host.registry.get(from.type)!.outputs[0], inp = h.host.registry.get(to.type)!.inputs[0];
    h.graph.connect({ node: from.id, port: out.id }, { node: to.id, port: inp.id });
    const originalState = h.graph.states.get(from.id), originalNodes = h.graph.nodes.size, originalEdges = h.graph.edges.length;
    h.select([from.id, to.id]); const result: any = tool(h, "duplicate_nodes").run({ include_internal_wires: true }, ctx());
    expect(h.graph.nodes.size).toBe(originalNodes + 2); expect(h.graph.edges).toHaveLength(originalEdges + 1);
    const copy = h.graph.nodes.get(result.duplicated[from.id])!; expect(copy).toMatchObject({ x: 50, y: 60, params: from.params }); expect(copy.params).not.toBe(from.params);
    expect(h.graph.states.get(from.id)).toBe(originalState); expect(h.host.applyGraph).not.toHaveBeenCalled();
  });
  it("connects a unique port pair, refuses occupied inputs, and disconnects by wire id", () => {
    const h = fakeHost(), a = h.graph.addNode("vision.fuse"), b = h.graph.addNode("vision.stabilize"), other = h.graph.addNode("vision.fuse");
    const connect = tool(h, "connect_nodes"), before = h.graph.edges.length;
    const result: any = connect.run({ from_node: a.id, to_node: b.id }, ctx());
    expect(h.graph.edges).toHaveLength(before + 1);
    expect(connect.run({ from_node: a.id, to_node: b.id }, ctx())).toHaveProperty("already_connected");
    expect(connect.run({ from_node: other.id, to_node: b.id }, ctx())).toMatchObject({ changed: false, occupied: { id: result.connected.id } });
    const replaced: any = connect.run({ from_node: other.id, to_node: b.id, replace: true }, ctx()); expect(replaced.replaced.id).toBe(result.connected.id); expect(h.graph.edges).toHaveLength(before + 1);
    tool(h, "disconnect_nodes").run({ edge_id: replaced.connected.id }, ctx()); expect(h.graph.edges).toHaveLength(before);
    expect(() => connect.run({ from_node: a.id, to_node: a.id }, ctx())).toThrow(/itself/);
    expect(() => connect.run({ from_node: a.id, to_node: b.id, to_port: "fake" }, ctx())).toThrow(/compatible/);
  });
  it("returns ambiguous ports without making any changes", () => {
    const h = fakeHost();
    h.host.registry.register({ type: "test.multi", title: "Multi", category: "Vision", inputs: [{ id: "a", type: "board" }, { id: "b", type: "board" }], outputs: [], process() {} });
    const a = h.graph.addNode("vision.fuse"), b = h.graph.addNode("test.multi");
    expect(tool(h, "connect_nodes").run({ from_node: a.id, to_node: b.id }, ctx())).toMatchObject({ changed: false, candidates: [{ to_port: "a" }, { to_port: "b" }] });
    expect(h.host.editGraph).not.toHaveBeenCalled();
  });
  it("validates edits atomically, removes incident edges, and paginates real ids/ports", () => {
    const h = fakeHost(), total = h.graph.nodes.size;
    expect(() => tool(h, "add_node").run({ type: "not.real" }, ctx())).toThrow(/Unknown/);
    expect(() => tool(h, "add_node").run({ type: "narration.ai", params: { apiKey: "bad" } }, ctx())).toThrow(/Secrets/);
    const created: any = tool(h, "add_node").run({ type: "vision.fuse", x: 24, y: 32 }, ctx()); expect(h.graph.nodes.size).toBe(total + 1);
    expect(() => tool(h, "move_nodes").run({ node_ids: [created.created.id, "missing"], dx: 20, dy: 20 }, ctx())).toThrow(/No node/);
    expect(h.graph.nodes.get(created.created.id)?.x).toBe(24);
    const page: any = tool(h, "get_workflow").run({ limit: 1 }, ctx()); expect(page.nodes).toHaveLength(1); expect(page.next_offset).toBe(1); expect(page.nodes[0]).toHaveProperty("inputs");
    const victim = h.graph.nodes.values().next().value!;
    tool(h, "remove_nodes").run({ node_ids: [victim.id] }, ctx()); expect(h.graph.nodes.has(victim.id)).toBe(false); expect(h.graph.edges.some(e => e.from.node === victim.id || e.to.node === victim.id)).toBe(false);
  });
  it("the production host persists edits without replacing existing node state", () => {
    const h = fakeHost(), refresh = vi.fn(), persist = vi.fn(), state = h.graph.states.values().next().value;
    const adapter = createAppHost({ registry: h.host.registry, graph: h.graph, loadSetup: () => null, applySetup() {}, applyGraph() {}, refreshGraph: refresh, persist, toggleBypass() {}, selection: () => [], route: () => ({ page: "table" }), go() {}, history: { canUndo: false, canRedo: false }, undo() {}, redo() {}, table: h.host.table, sound: h.host.sound, now: h.host.now });
    adapter.editGraph!(h.graph.toJSON()); expect(persist).toHaveBeenCalledOnce(); expect(refresh).toHaveBeenCalledOnce(); expect(h.graph.states.values().next().value).toBe(state);
  });
});

describe("UI and feature awareness", () => {
  it("reads names, disabled/hidden state, tooltips and choices without keys or chat text", () => {
    document.body.innerHTML = `<div class="panel as"><p>PRIVATE CHAT</p><button>Approve</button></div><section class="rpane" data-rpane="edit"><button id="seldup" disabled data-tip="Duplicate" data-tip-body="Copies selected nodes">Copy</button><button hidden>Hidden command</button><input type="password" value="sk-private"><input type="text" aria-label="Personal text" value="secret-text"><select aria-label="Theme"><option value="dark">Dark</option></select></section><p role="status">Camera is offline</p>`;
    const ui = readUI(document), json = JSON.stringify(ui);
    expect(ui.controls.find(c => c.id === "seldup")).toMatchObject({ label: "Duplicate", section: "edit", disabled: true, description: "Copies selected nodes" });
    expect(ui.controls.find(c => c.label === "Hidden command")?.visible).toBe(false);
    expect(ui.controls.find(c => c.label === "Theme")).toMatchObject({ value: "dark", options: [{ value: "dark", label: "Dark" }] });
    expect(ui.text).toContain("Camera is offline"); expect(json).not.toMatch(/PRIVATE CHAT|Approve|sk-private|secret-text/);
  });
  it("indexes actual settings, node types and parameter docs and searches UI observations", () => {
    const h = fakeHost({ ui: () => ({ mode: "nodes", focus: null, dialogs: [], controls: [], text: ["Camera offline"] }) }), map = appMap(h.host);
    expect(map.features.some(f => f.path === "Settings / Board")).toBe(true); expect(map.node_types.some(n => n.type === "game.tracker")).toBe(true);
    expect(map.parameter_help.some(p => p.path.endsWith("game.tracker.minConf"))).toBe(true);
    const found: any = tool(h, "get_app_map").run({ query: "duplicate" }, ctx()); expect(found.items[0].path).toBe("Workflow / nodes");
    expect(tool(h, "get_ui").run({ query: "offline" }, ctx())).toHaveProperty("text.items", ["Camera offline"]);
    expect(() => tool(h, "app_action").run({ action: "reset_everything" }, ctx())).toThrow(/Unknown/);
    expect(() => tool(h, "set_view_settings").run({ display: { flip: true, fake: false } }, ctx())).toThrow(/Invalid display/);
  });
});

describe("game awareness and fresh per-step state", () => {
  it("distinguishes last mover from side to move without inventing a person", () => {
    const game = new Chess(); game.move("e4"); game.move("e5");
    bus.game = { fen: game.fen(), turn: "w", ply: 2, over: false, last: { color: "b", san: "e5" }, history: ["e4", "e5"], fidelity: 0.9, moveFidelity: 0.95 } as any;
    const h = fakeHost(); bus.botColor = "b";
    expect(gameContext(h.host)).toMatchObject({ side_to_move: "White", last_player: { color: "b", side: "Black", move: "e5", identity: null, role: "engine opponent" } });
    const history: any = tool(h, "get_move_history").run({}, ctx()); expect(history.moves).toEqual([{ ply: 1, color: "w", san: "e4" }, { ply: 2, color: "b", san: "e5" }]);
  });
  it("analyzes the captured live FEN and reports a position change during search", async () => {
    const game = new Chess(), fen = game.fen(); bus.game = { fen, fidelity: 0.9 } as any;
    const analyze = vi.spyOn(analysis, "analyzePosition").mockImplementation(async () => { game.move("e4"); bus.game!.fen = game.fen(); return { fen, engine: "Stockfish", score: { unit: "centipawns", white: 30, bound: "exact" }, best_move: { uci: "e2e4", san: "e4" }, turn: "w", terminal: null, depth: 10, principal_variation: [], elapsed_ms: 5 }; });
    const h = fakeHost(), result = await tool(h, "analyze_game").run({}, ctx());
    expect(result).toMatchObject({ fen, position_changed: true, current_fen: game.fen(), source: "tracked" }); expect(analyze).toHaveBeenCalledWith(fen, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    bus.game = null; await expect(tool(h, "analyze_game").run({}, ctx())).rejects.toThrow(/No tracked game/);
  });
  it("refreshes state after a tool changes the page, without storing snapshots in conversation history", async () => {
    const h = fakeHost(), f = scripted([{ tools: [{ name: "navigate", args: { page: "world" } }] }, { content: "Opened World" }]);
    const session = new ChatSession({ host: h.host, watcher: { take: () => ["context-news"] }, settings: () => ({ apiKey: "test", model: "test" }), emit() {}, fetchImpl: f.fetch });
    session.submit("Open World"); await vi.waitFor(() => expect(session.busy).toBe(false));
    const live = (i: number) => f.calls[i].messages.find((m: any) => m.role === "system" && m.content.startsWith("LIVE STATE"))?.content;
    expect(live(0)).toContain('"page":"table"'); expect(live(1)).toContain('"page":"world"'); expect(live(1)).toContain("context-news"); expect(session.history.some(m => m.role === "system")).toBe(false);
  });
});
