import { beforeEach, describe, expect, it, vi } from "vitest";
import { bus } from "../core/bus";
import { defaultSetup } from "../setup/config";
import { complete, runAgent, stringify, trimHistory, type AgentEvent, type ChatMsg, type AgentTool } from "./agent";
import { redact } from "./host";
import { Watcher, suggestions } from "./proactive";
import { SYSTEM, stateMessage } from "./prompt";
import { problems, snapshot } from "./snapshot";
import { check, editCameras, patchSetup } from "./setupPatch";
import { buildTools, nodeTypes } from "./tools";
import { fakeHost, scripted } from "./testHost";

const O = { apiKey: "sk-test", model: "gpt-4.1-mini" };
const ctx = (over = {}) => ({ signal: new AbortController().signal, confirm: vi.fn(async () => true), choose: vi.fn(async () => "B"), ...over });
const tool = (h: ReturnType<typeof fakeHost>, name: string) => buildTools(h.host).find((t) => t.name === name)!;

beforeEach(() => { bus.events.length = 0; bus.cameras.length = 0; bus.game = null; bus.board = null; bus.lines.length = 0; });

describe("agent loop", () => {
  it("streams text, and falls back to a plain JSON reply", async () => {
    const seen: string[] = [];
    const s = scripted([{ content: "Hello there, friend" }]);
    const c = await complete([{ role: "user", content: "hi" }], [], O, new AbortController().signal, (d) => seen.push(d), s.fetch);
    expect(c.content).toBe("Hello there, friend"); expect(seen.length).toBeGreaterThan(1); expect(c.usage).toEqual({ prompt: 10, completion: 4 });
    expect(s.calls[0]).toMatchObject({ stream: true, temperature: 0.3 }); expect(s.calls[0].tools).toBeUndefined();
    const j = scripted([{ content: "plain" }], { stream: false });
    expect((await complete([], [], { ...O, model: "o3-mini" }, new AbortController().signal, () => {}, j.fetch)).content).toBe("plain");
    expect(j.calls[0]).toMatchObject({ reasoning_effort: "medium" }); expect(j.calls[0].temperature).toBeUndefined();
  });

  it("reports HTTP failures in plain words", async () => {
    for (const [status, re] of [[401, /key/], [429, /quota/], [500, /500: nope/]] as const) await expect(complete([], [], O, new AbortController().signal, () => {}, scripted([{}], { status }).fetch)).rejects.toThrow(re);
    const bad = vi.fn(async () => ({ ok: false, status: 502, json: async () => { throw new Error("html"); } })) as unknown as typeof fetch;
    await expect(complete([], [], O, new AbortController().signal, () => {}, bad)).rejects.toThrow("502");
  });

  it("times out and aborts", async () => {
    const hang = ((_u: string, init: any) => new Promise((_r, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("x"), { name: "AbortError" }))))) as unknown as typeof fetch;
    await expect(complete([], [], { ...O, timeoutMs: 5 }, new AbortController().signal, () => {}, hang)).rejects.toThrow("timed out");
    const ac = new AbortController(); const p = complete([], [], O, ac.signal, () => {}, hang); ac.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });

  it("calls tools, feeds results back, and keeps the history consistent", async () => {
    const h = fakeHost(), events: AgentEvent[] = [], history: ChatMsg[] = [{ role: "user", content: "scene?" }];
    const s = scripted([{ tools: [{ name: "get_state", args: { sections: ["page"] } }, { name: "nope", args: {} }, { name: "think", args: { thought: "x" } }] }, { content: "Done." }]);
    const out = await runAgent({ system: "s", history, tools: buildTools(h.host), opts: O, signal: new AbortController().signal, ctx: ctx(), emit: (e) => events.push(e), doFetch: s.fetch });
    expect(out).toBe("Done."); expect(history.map((m) => m.role)).toEqual(["user", "assistant", "tool", "tool", "tool", "assistant"]);
    expect(history[3].content).toContain("Unknown tool"); expect(history[2].content).toContain('"page":"table"');
    expect(events.filter((e) => e.type === "tool_end").map((e: any) => e.ok).sort()).toEqual([false, true, true]);
    expect(s.calls[1].messages.at(-1).role).toBe("tool"); expect(events.some((e) => e.type === "usage")).toBe(true);
  });

  it("reports malformed arguments, asks before danger tools, honours a decline", async () => {
    const run = vi.fn(() => "ran"), danger: AgentTool = { name: "boom", description: "d", parameters: {}, risk: "danger", run, describe: () => "blow it up" };
    const c = ctx({ confirm: vi.fn(async () => false) }), history: ChatMsg[] = [{ role: "user", content: "go" }];
    const calls = [{ id: "1", type: "function", function: { name: "boom", arguments: "{" } }, { id: "2", type: "function", function: { name: "boom", arguments: "" } }];
    const f = vi.fn().mockResolvedValueOnce(streamOf({ tool_calls: calls.map((x, i) => ({ index: i, ...x })) })).mockResolvedValueOnce(streamOf({ content: "ok" }));
    await runAgent({ system: "s", history, tools: [danger], opts: O, signal: new AbortController().signal, ctx: c, emit: () => {}, doFetch: f as any });
    expect(history[1 + 1].content).toContain("not valid JSON"); expect(history[3].content).toContain("declined"); expect(c.confirm).toHaveBeenCalledWith("boom", "blow it up"); expect(run).not.toHaveBeenCalled();
  });

  it("drops a step cut short by Stop, and stops at the step limit", async () => {
    const ac = new AbortController(), slow: AgentTool = { name: "slow", description: "", parameters: {}, risk: "write", run: () => { ac.abort(); return 1; } };
    const history: ChatMsg[] = [{ role: "user", content: "x" }];
    await expect(runAgent({ system: "s", history, tools: [slow], opts: O, signal: ac.signal, ctx: ctx(), emit: () => {}, doFetch: scripted([{ tools: [{ name: "slow", args: {} }, { name: "slow", args: {} }] }]).fetch })).rejects.toMatchObject({ name: "AbortError" });
    expect(history).toHaveLength(1);
    const ev: AgentEvent[] = [], h2: ChatMsg[] = [{ role: "user", content: "x" }];
    const out = await runAgent({ system: "s", history: h2, tools: [{ ...slow, run: () => 1 }], opts: { ...O, maxSteps: 2 }, signal: new AbortController().signal, ctx: ctx(), emit: (e) => ev.push(e), doFetch: scripted([{ tools: [{ name: "slow", args: {} }] }]).fetch });
    expect(out).toMatch(/step limit/); expect(h2.at(-1)!.content).toMatch(/step limit/);
    const ab = new AbortController(), t2: AgentTool = { name: "r", description: "", parameters: {}, risk: "read", run: () => { throw new DOMException("s", "AbortError"); } };
    await expect(runAgent({ system: "s", history: [], tools: [t2], opts: O, signal: ab.signal, ctx: ctx(), emit: () => {}, doFetch: scripted([{ tools: [{ name: "r", args: {} }] }]).fetch })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("trims history on a user turn and truncates huge results", () => {
    const h: ChatMsg[] = Array.from({ length: 70 }, (_, i) => ({ role: i % 3 === 0 ? "user" : i % 3 === 1 ? "assistant" : "tool", content: String(i) }) as ChatMsg);
    expect(trimHistory(h, 10)[0].role).toBe("user"); expect(trimHistory(h.slice(0, 5))).toHaveLength(5);
    expect(stringify("x".repeat(9000))).toContain("truncated"); expect(stringify(undefined)).toBe("null"); const cyc: any = {}; cyc.a = cyc; expect(stringify(cyc)).toContain("object");
  });
});

function streamOf(delta: any): Response {
  const bytes = new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n`); let sent = false;
  return { ok: true, status: 200, body: { getReader: () => ({ read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: bytes })) }) } } as unknown as Response;
}

describe("setup patching", () => {
  it("applies valid settings, rejects the rest, never touches secrets", () => {
    const r = patchSetup(defaultSetup(), { scene: "cavern", rain: "0.5", narrator: { voices: 1, nameA: "Zed", volume: 7 }, ai: { apiKey: "sk-x", engine: "openai" }, cameras: [], nonsense: 1, projectors: { dmxUrl: "http://x" }, opponent: { elo: 1200.4 }, voice: "browser" });
    expect(r.applied).toEqual(["scene", "rain", "narrator.voices", "narrator.nameA", "ai.engine", "opponent.elo"]); expect(r.setup.opponent.elo).toBe(1200); expect(r.setup.rain).toBe(0.5);
    expect(r.rejected.map((x) => x.path)).toEqual(["narrator.volume", "ai.apiKey", "cameras", "nonsense", "projectors.dmxUrl", "voice"]); expect(r.setup.ai.apiKey).toBe("");
  });
  it("checks every kind of value", () => {
    expect(check({ kind: "bool" }, "true")).toEqual({ v: true }); expect(check({ kind: "bool" }, 3)).toHaveProperty("err");
    expect(check({ kind: "num", min: 0, max: 1 }, "x")).toHaveProperty("err"); expect(check({ kind: "num", min: 0, max: 1 }, "")).toHaveProperty("err");
    expect(check({ kind: "enum", of: [1, 2] }, "2")).toEqual({ v: 2 }); expect(check({ kind: "enum", of: ["a"] }, "z")).toHaveProperty("err");
    expect(check({ kind: "text", max: 3 }, "abcdef")).toEqual({ v: "abc" }); expect(check({ kind: "text", max: 3 }, "  ")).toHaveProperty("err"); expect(check({ kind: "text", max: 9, pattern: /^w/ }, "x")).toHaveProperty("err");
  });
  it("adds, edits and removes cameras within limits", () => {
    let s = defaultSetup(); const add = (kind: "virtual" | "webcam", rig?: string, label?: string) => (s = editCameras(s, { action: "add", kind, rig, label }).setup);
    add("virtual"); expect(s.cameras.map((c) => c.id)).toEqual(["A", "B", "C"]); expect(s.cameras[2].rig).toBe("C");
    add("webcam", "", "Desk cam"); expect(s.cameras[3]).toMatchObject({ kind: "webcam", online: false, label: "Desk cam" }); add("webcam", "B");
    expect(editCameras(s, { action: "add", kind: "virtual" }).rejected[0].reason).toMatch(/at most/);
    const u = editCameras(s, { action: "update", id: "a", set: { online: false, trust: 1.5, fov: 500, corners: "1,1;2,2;3,3;4,4", bad: 1 } });
    expect(u.applied).toEqual(["cameras.A.online", "cameras.A.trust", "cameras.A.corners"]); expect(u.rejected.map((x) => x.path)).toEqual(["cameras.A.fov", "cameras.A.bad"]);
    expect(editCameras(s, { action: "update", id: "A", set: { corners: "nope" } }).rejected[0].reason).toMatch(/x,y/); expect(editCameras(s, { action: "update", id: "Q", set: {} }).rejected).toHaveLength(1);
    expect(editCameras(s, { action: "remove", id: "B" }).setup.cameras.map((c) => c.id)).not.toContain("B"); expect(editCameras(s, { action: "remove", id: "Z" }).rejected).toHaveLength(1);
    expect(editCameras(s, { action: "update", id: "A", set: null as any }).applied).toEqual([]);
  });
});

describe("context", () => {
  it("redacts secrets and describes the live app", () => {
    const s = defaultSetup(); s.ai.apiKey = "sk-secret"; const r: any = redact(s);
    expect(r.ai.apiKey).toBe("(set)"); expect(r.voice.apiKey).toBe("(empty)"); expect(JSON.stringify(r)).not.toContain("sk-secret");
    const h = fakeHost(); h.select([[...h.graph.nodes.keys()][0]]);
    bus.cameras.push({ id: "A", online: true, quality: 0.2, reliability: 1 }, { id: "B", online: false, quality: 0, reliability: 0 });
    bus.board = { fidelity: 0.3, settled: true, handOver: false, cams: 2 } as any;
    bus.game = { fen: "f", turn: "w", ply: 3, status: "synced", over: false, last: null, history: ["e4"], fidelity: 1, moveFidelity: 1, diff: [], events: [] } as any;
    bus.events.push({ type: "move", t: 99000, data: { san: "e4" } }); bus.lines.push({ speaker: "A", name: "Jean", text: "Beau coup", t: 0, priority: 0 } as any);
    const snap: any = snapshot(h.host);
    expect(snap.selected_nodes).toHaveLength(1); expect(snap.recent_events[0]).toMatchObject({ type: "move", ago_s: 1 }); expect(snap.game.recent_moves).toEqual(["e4"]); expect(snap.last_commentary[0]).toContain("Jean");
    expect(problems(h.host).map((p) => p.message).join(" ")).toMatch(/poor picture[\s\S]*offline[\s\S]*confidence/);
    expect(stateMessage(h.host, ["a thing"])).toContain("SINCE YOUR LAST MESSAGE"); expect(SYSTEM).toContain("think");
    expect(suggestions(h.host)).toEqual(expect.arrayContaining(["Why is a camera performing badly?", "Explain the selected node and what to tweak"]));
    h.setSetup(null); bus.game = { ...bus.game!, over: true }; expect((snapshot(h.host) as any).setup).toBe("not completed yet"); expect(suggestions(h.host)[0]).toMatch(/from scratch/);
  });
  it("includes node errors and setup issues in the problems", () => {
    const h = fakeHost({ nodeErrors: () => [{ node: "n1", type: "x.y", message: "boom", hint: "fix" }] }); const s = defaultSetup(); s.cameras = []; h.setSetup(s);
    expect(problems(h.host).map((p) => p.message).join(" ")).toMatch(/boom \(fix\)[\s\S]*|Add at least one camera/);
    h.setSetup({ ...defaultSetup(), completed: true, opponent: { mode: "menu", elo: 1000 } });
    expect(suggestions(h.host)).toContain("Fix the errors in my setup");
  });
  it("watches for news and persistent trouble, once each", () => {
    const h = fakeHost(); bus.events.push({ type: "old", t: 1 }); const w = new Watcher(h.host);
    expect(w.poll(0)).toEqual([]);
    bus.events.push({ type: "move", t: 5, data: { san: "e4" } }, { type: "illegal", t: 6 }, { type: "mate", t: 7 }, { type: "draw", t: 8 });
    const n = w.poll(1000); expect(n.map((x) => x.level)).toEqual(["warn", "info", "info"]); expect(n[1].text).toMatch(/Checkmate/); expect(n[2].text).toMatch(/draw/);
    expect(w.take().join(" ")).toContain("move"); expect(w.take()).toEqual([]);
    bus.cameras.push({ id: "A", online: false, quality: 0, reliability: 0 }); bus.board = { fidelity: 0.1 } as any;
    expect(w.poll(2000)).toEqual([]); const later = w.poll(20000); expect(later.map((x) => x.id)).toEqual(expect.arrayContaining(["cam-A", "board"])); expect(w.poll(30000)).toEqual([]);
    bus.cameras[0].online = true; bus.cameras[0].quality = 0.9; bus.board = null; w.poll(31000); bus.cameras[0].online = false; w.poll(32000); expect(w.poll(40000).map((x) => x.id)).toContain("cam-A");
    for (let i = 0; i < 30; i++) bus.events.push({ type: "move", t: 100 + i }); w.poll(41000); expect(w.take().length).toBeLessThanOrEqual(20);
    const bad = defaultSetup(); bad.cameras = []; h.setSetup(bad); w.poll(50000); expect(w.poll(53000).map((x) => x.id)).toContain("setup-errors");
    const e = fakeHost({ nodeErrors: () => [{ node: "a", type: "t", message: "m" }, { node: "b", type: "t", message: "m" }] }); const w2 = new Watcher(e.host); w2.poll(0); expect(w2.poll(4000)[0].text).toMatch(/2 nodes are/);
  });
});

describe("tools", () => {
  it("reads: state, events, setup, node, node types, scenarios, diagnose", async () => {
    const h = fakeHost(); bus.events.push({ type: "move", t: 99000 }, { type: "capture", t: 99500 });
    expect(Object.keys(await tool(h, "get_state").run({ sections: ["page", "x"] }, ctx()) as object)).toEqual(["page"]); expect(await tool(h, "get_state").run({}, ctx())).toHaveProperty("workflow");
    expect(await tool(h, "get_events").run({ types: ["capture"], limit: 5 }, ctx())).toEqual([{ type: "capture", ago_s: 0.5, data: undefined }]); expect(await tool(h, "get_events").run({}, ctx())).toHaveLength(2);
    expect((await tool(h, "get_setup").run({}, ctx()) as any).issues).toBeDefined(); h.setSetup(null); expect((await tool(h, "get_setup").run({}, ctx()) as any).setup).toBeNull(); h.setSetup({ ...defaultSetup(), completed: true });
    const id = [...h.graph.nodes.values()].find((n) => n.type === "narration.ai")!.id; const g: any = await tool(h, "get_node").run({ id }, ctx());
    expect(g.type).toBe("narration.ai"); expect(JSON.stringify(g)).not.toMatch(/aiKey.*sk-/); expect(g.allowed.some((p: any) => /key/i.test(p.id))).toBe(false); expect(() => tool(h, "get_node").run({ id: "zz" }, ctx())).toThrow("No node");
    expect(nodeTypes(h.host.registry, "tracker")).toContain("game.tracker"); expect(nodeTypes(h.host.registry, "zzzz")).toMatch(/No node type/); expect(nodeTypes(h.host.registry, "", "Source")).toContain("source."); expect(nodeTypes(h.host.registry)).toContain("more");
    expect(await tool(h, "list_node_types").run({ query: "tracker" }, ctx())).toContain("game.tracker"); expect((await tool(h, "list_scenarios").run({}, ctx()) as any[])[0]).toHaveProperty("plies");
    expect((await tool(h, "diagnose").run({}, ctx()) as any).hints[0]).toMatch(/No problems/);
    bus.cameras.push({ id: "A", online: false, quality: 0, reliability: 0 }); const d: any = await tool(h, "diagnose").run({}, ctx()); expect(d.count).toBeGreaterThan(0); expect(d.hints[0]).toMatch(/corners/);
    const h2 = fakeHost({ nodeErrors: () => [{ node: "n", type: "t", message: "m" }] }); expect((await tool(h2, "diagnose").run({}, ctx()) as any).hints.join()).toMatch(/get_node/);
  });

  it("writes: setup, cameras, params, bypass, navigate, table, undo", async () => {
    const h = fakeHost(), t = (n: string, a: any) => tool(h, n).run(a, ctx()) as any;
    const r = await t("update_setup", { changes: { scene: "cavern" } }); expect(r.applied).toEqual(["scene"]); expect(h.host.applySetup).toHaveBeenCalledTimes(1); expect(r.note).toMatch(/Ctrl\+Z/);
    expect((await t("update_setup", { changes: { bogus: 1 } })).note).toMatch(/Nothing/); expect((await t("update_setup", {})).applied).toEqual([]);
    expect((await t("camera", { action: "add", kind: "webcam", label: "x" })).applied).toEqual(["cameras.C"]); expect((await t("camera", { action: "update", id: "A", set: { trust: 2 } })).applied).toHaveLength(1);
    expect((await t("camera", { action: "remove", id: "C" })).applied[0]).toMatch(/removed/); expect((await t("camera", { action: "add" })).applied).toHaveLength(1);
    h.setSetup({ ...defaultSetup(), completed: true, cameras: [] }); // already broken: a change may still go through
    expect((await t("update_setup", { changes: { scene: "cavern" } })).applied).toEqual(["scene"]);
    const one = defaultSetup(); one.cameras = one.cameras.slice(0, 1); h.setSetup({ ...one, completed: true }); expect(await t("camera", { action: "remove", id: "A" })).toHaveProperty("blocked_by");
    h.setSetup(null); expect((await t("update_setup", { changes: { scene: "cavern" } })).applied).toEqual(["scene"]);
    const trk = [...h.graph.nodes.values()].find((n) => n.type === "narration.narrator")!;
    const p = await t("set_node_param", { node_id: trk.id, param: "voices", value: "1" }); expect(p).toMatchObject({ param: "voices", now: "1" });
    expect(() => t("set_node_param", { node_id: "q", param: "x", value: 1 })).toThrow("No node"); expect(() => t("set_node_param", { node_id: trk.id, param: "apiKey", value: 1 })).toThrow("Secrets"); expect(() => t("set_node_param", { node_id: trk.id, param: "zzz", value: 1 })).toThrow("no parameter"); expect(() => t("set_node_param", { node_id: trk.id, param: "voices", value: "five" })).toThrow("not valid");
    expect(await t("set_bypass", { node_id: trk.id, bypass: true })).toEqual({ node: trk.id, bypass: true }); expect(() => t("set_bypass", { node_id: "q", bypass: true })).toThrow("No node");
    expect(await t("navigate", { page: "log" })).toEqual({ now_on: { page: "log" } }); await t("navigate", { page: "setup", step: "cameras" }); expect(h.host.go).toHaveBeenLastCalledWith({ page: "settings", step: "cameras" }); await t("navigate", { page: "settings" }); expect(h.host.go).toHaveBeenLastCalledWith({ page: "settings", step: null });
    expect(await t("table_play", { move: "e4" })).toHaveProperty("played"); expect(() => t("table_play", { move: "e5" })).toThrow("Legal moves: e4 Nf3"); expect(await t("table_seat", { seated: true })).toEqual({ seated: true }); expect(await t("table_reset", {})).toEqual({ reset: true });
    expect(await t("undo", {})).toMatchObject({ undone: true }); expect(await t("redo", {})).toEqual({ redone: true }); expect(await t("think", {})).toEqual({ ok: true });
  });

  it("replaces the workflow only through a validated draft, with a clear approval line", async () => {
    const h = fakeHost(), apply = tool(h, "apply_workflow"), draft = { name: "Mini", nodes: [{ id: "a", type: "source.synthetic" }, { id: "b", type: "vision.boardReader" }], edges: [{ from: "a.frame", to: "b.frame" }] };
    expect(apply.risk).toBe("danger"); expect(apply.describe!({ draft })).toContain("Mini"); expect(apply.describe!({})).toContain("new workflow");
    const r: any = await apply.run({ draft }, ctx()); expect(r).toMatchObject({ applied: "Mini", nodes: 2, wires: 1 }); expect(h.host.applyGraph).toHaveBeenCalled();
    expect((await apply.run({ draft: JSON.stringify(draft) }, ctx()) as any).nodes).toBe(2);
    await expect(Promise.resolve().then(() => apply.run({ draft: { nodes: [{ type: "nope" }] } }, ctx()))).rejects.toThrow("No usable nodes"); await expect(Promise.resolve().then(() => apply.run({ draft: "{" }, ctx()))).rejects.toThrow();
  });

  it("waits for events (async) and asks questions", async () => {
    const h = fakeHost(), wait = tool(h, "wait_for_event");
    setTimeout(() => bus.events.push({ type: "move", t: 123456, data: { san: "e4" } }), 30); bus.game = { fen: "F", turn: "b", ply: 1 } as any;
    expect(await wait.run({ types: ["move"], timeout_s: 5 }, ctx())).toMatchObject({ event: { type: "move" }, game: { fen: "F" } });
    bus.game = null; expect(await wait.run({ types: ["mate"], timeout_s: 0.2 }, ctx())).toMatchObject({ timed_out: true, game: null });
    const ac = new AbortController(); setTimeout(() => ac.abort(), 20); await expect(wait.run({ timeout_s: 5 }, ctx({ signal: ac.signal }))).rejects.toMatchObject({ name: "AbortError" });
    const c = ctx(); expect(await tool(h, "ask_user").run({ question: "q", options: ["A", "B", "C", "D", "E"] }, c)).toEqual({ answer: "B" }); expect(c.choose).toHaveBeenCalledWith("q", ["A", "B", "C", "D"]); await tool(h, "ask_user").run({ question: "q" }, c);
  });
});
