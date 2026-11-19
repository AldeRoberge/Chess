import { vi } from "vitest";
import { createRegistry } from "../plugins";
import { Graph } from "../core/graph";
import { buildGraphFromConfig, defaultSetup, type SetupConfig } from "../setup/config";
import type { AssistantHost } from "./host";
import type { Route } from "../ui/route";

/** A real graph and setup behind the host interface, with spies for what the assistant changes. Test helper only. */
export function fakeHost(over: Partial<AssistantHost> = {}) {
  const registry = createRegistry(), graph = new Graph(registry);
  let setup: SetupConfig | null = { ...defaultSetup(), completed: true };
  buildGraphFromConfig(graph, setup);
  let route: Route = { page: "table" }, seated = false, selection: string[] = [];
  const host: AssistantHost = {
    registry, graph: () => graph.toJSON(), setup: () => setup,
    applySetup: vi.fn((c: SetupConfig) => { setup = c; buildGraphFromConfig(graph, c); }),
    applyGraph: vi.fn(),
    setParam: vi.fn((id: string, k: string, v: string | number | boolean) => { const n = graph.nodes.get(id); if (!n) return false; n.params[k] = v; return true; }),
    setBypass: vi.fn((id: string, on: boolean) => { const n = graph.nodes.get(id); if (!n) return false; n.bypass = on; return true; }),
    selection: () => selection, nodeErrors: () => [], route: () => route, go: vi.fn((r: Route) => { route = r; }),
    undo: vi.fn(() => true), redo: vi.fn(() => true), canUndo: () => true, canRedo: () => false,
    table: { fen: () => "start", legal: () => ["e4", "Nf3"], reset: vi.fn(), seat: vi.fn((on: boolean) => { seated = on; }), seated: () => seated, play: vi.fn((m: string) => m === "e4") },
    sound: () => ({ on: false, muted: false }), now: () => 100000, ...over,
  };
  return { host, graph, select: (ids: string[]) => { selection = ids; }, setSetup: (s: SetupConfig | null) => { setup = s; } };
}

/** A fetch that answers with scripted completions, as a stream (default) or a plain JSON body. */
export function scripted(replies: { content?: string; tools?: { name: string; args: unknown }[]; usage?: boolean }[], opts: { stream?: boolean; status?: number } = {}) {
  const calls: any[] = []; let i = 0;
  const fn = vi.fn(async (_url: string, init: any) => {
    calls.push(JSON.parse(init.body));
    if (opts.status) return { ok: false, status: opts.status, json: async () => ({ error: { message: "nope" } }) } as unknown as Response;
    const r = replies[Math.min(i++, replies.length - 1)];
    const tool_calls = (r.tools ?? []).map((t, k) => ({ index: k, id: `c${i}_${k}`, type: "function", function: { name: t.name, arguments: JSON.stringify(t.args) } }));
    if (opts.stream === false) return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: r.content ?? null, tool_calls } }], usage: { prompt_tokens: 5, completion_tokens: 2 } }) } as unknown as Response;
    const lines: string[] = [];
    for (const w of (r.content ?? "").match(/.{1,6}/gs) ?? []) lines.push(`data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}`);
    for (const tc of tool_calls) { // split the arguments across two chunks like the real API
      const a = tc.function.arguments, mid = Math.floor(a.length / 2);
      lines.push(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: tc.index, id: tc.id, type: "function", function: { name: tc.function.name, arguments: a.slice(0, mid) } }] } }] })}`);
      lines.push(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: tc.index, function: { arguments: a.slice(mid) } }] } }] })}`);
    }
    lines.push(": keep-alive", "data: {broken", `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 4 } })}`, "data: [DONE]");
    const bytes = new TextEncoder().encode(lines.join("\n") + "\n");
    let sent = false;
    return { ok: true, status: 200, body: { getReader: () => ({ read: async () => (sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: bytes })) }) } } as unknown as Response;
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}
