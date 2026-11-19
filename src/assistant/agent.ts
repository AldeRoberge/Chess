/**
 * The assistant's brain: an OpenAI tool-calling loop with streaming.
 * Pure of the DOM so it can be tested with a fake fetch. The panel drives it and renders its events.
 */
import { vendorFetch } from "../net/vendorFetch";
export interface ToolCall{ id: string; type: "function"; function: { name: string; arguments: string } }
export interface ChatMsg { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string }

/** read = no side effects; write = changes the app but can be undone; danger = asks you first. */
export type Risk = "read" | "write" | "danger";

export interface ToolCtx {
  signal: AbortSignal;
  /** Ask the person to approve something (resolves false when they decline). */
  confirm(title: string, detail: string): Promise<boolean>;
  /** Ask the person to pick one of several answers (resolves with the picked text, or what they typed). */
  choose(question: string, options: string[]): Promise<string>;
}

export interface AgentTool {
  name: string;
  description: string;
  /** JSON schema of the arguments. */
  parameters: Record<string, unknown>;
  risk: Risk;
  /** What the chat shows while the tool runs and after it ran. Defaults to the tool name. */
  label?: { doing: string; done: string };
  /** The tool changes the app in a way the Undo button on its card can take back. */
  undoable?: boolean;
  /** One line shown on the approval card of a "danger" tool. */
  describe?(args: any): string;
  run(args: any, ctx: ToolCtx): Promise<unknown> | unknown;
}

export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "tool_start"; id: string; name: string; args: any; risk: Risk; label?: AgentTool["label"]; undoable?: boolean }
  | { type: "tool_end"; id: string; name: string; ok: boolean; result: unknown; ms: number }
  | { type: "usage"; prompt: number; completion: number }
  | { type: "step"; n: number };

export interface AgentOptions { apiKey: string; model: string; maxSteps?: number; timeoutMs?: number }
const REASONING = /^(o\d|gpt-5)/;

/** What came back from one model call. */
export interface Completion { content: string; toolCalls: ToolCall[]; usage?: { prompt: number; completion: number } }

const failure = async (r: Response) => {
  let detail = ""; try { detail = (await r.json())?.error?.message ?? ""; } catch { /* not JSON */ }
  if (r.status === 401) return new Error("OpenAI rejected the API key (401).");
  if (r.status === 429) return new Error(`OpenAI says slow down or out of quota (429). ${detail}`.trim());
  return new Error(`OpenAI error ${r.status}${detail ? `: ${detail}` : ""}`);
};

/** One streamed chat completion. Falls back to a plain JSON body when the response is not a stream. */
export async function complete(messages: ChatMsg[], tools: AgentTool[], o: AgentOptions, signal: AbortSignal, onText: (d: string) => void, doFetch: typeof fetch = vendorFetch): Promise<Completion> {
  const body: Record<string, unknown> = { model: o.model, messages, stream: true, stream_options: { include_usage: true } };
  if (tools.length) { body.tools = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })); body.tool_choice = "auto"; }
  if (REASONING.test(o.model)) body.reasoning_effort = "medium"; else body.temperature = 0.3;
  const timeout = new AbortController(), timer = setTimeout(() => timeout.abort(), o.timeoutMs ?? 120000);
  const onAbort = () => timeout.abort(); signal.addEventListener("abort", onAbort);
  try {
    const r = await doFetch("https://api.openai.com/v1/chat/completions", { method: "POST", signal: timeout.signal, headers: { "Content-Type": "application/json", Authorization: `Bearer ${o.apiKey.trim()}` }, body: JSON.stringify(body) });
    if (!r.ok) throw await failure(r);
    const out: Completion = { content: "", toolCalls: [] };
    const take = (j: any) => {
      if (j?.usage) out.usage = { prompt: j.usage.prompt_tokens ?? 0, completion: j.usage.completion_tokens ?? 0 };
      const ch = j?.choices?.[0]; if (!ch) return;
      const d = ch.delta ?? ch.message ?? {};
      if (typeof d.content === "string" && d.content) { out.content += d.content; onText(d.content); }
      for (const tc of d.tool_calls ?? []) {
        const i = tc.index ?? out.toolCalls.length, cur = (out.toolCalls[i] ??= { id: "", type: "function", function: { name: "", arguments: "" } });
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.function.name += tc.function.name;
        if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
      }
    };
    const reader = r.body?.getReader?.();
    if (!reader) take(await r.json());
    else {
      const dec = new TextDecoder(); let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data && data !== "[DONE]") { try { take(JSON.parse(data)); } catch { /* a partial or keep-alive line */ } }
        }
      }
    }
    out.toolCalls = out.toolCalls.filter((c) => c?.function.name).map((c, i) => ({ ...c, id: c.id || `call_${i}_${Date.now()}` }));
    return out;
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw signal.aborted ? e : new Error("The request timed out.");
    throw e;
  } finally { clearTimeout(timer); signal.removeEventListener("abort", onAbort); }
}

const RESULT_MAX = 7000;
/** What the model sees of a tool's result: JSON, cut to a sane size. */
export function stringify(v: unknown): string {
  let s: string; try { s = JSON.stringify(v ?? null) ?? "null"; } catch { s = String(v); }
  return s.length > RESULT_MAX ? `${s.slice(0, RESULT_MAX)}…[truncated ${s.length - RESULT_MAX} chars; ask for a narrower view]` : s;
}

/** Keeps the last `max` messages, never starting on a tool result whose assistant message was cut off. */
export function trimHistory(h: ChatMsg[], max = 60): ChatMsg[] {
  if (h.length <= max) return h;
  let out = h.slice(h.length - max);
  while (out.length && out[0].role !== "user") out = out.slice(1);
  return out;
}

export interface RunOptions {
  system: string;
  /** Persistent conversation (user, assistant and tool messages). Completed steps are appended in place. */
  history: ChatMsg[];
  tools: AgentTool[];
  opts: AgentOptions;
  signal: AbortSignal;
  ctx: ToolCtx;
  emit(e: AgentEvent): void;
  doFetch?: typeof fetch;
}

/** Runs the model until it answers without asking for tools. Returns its final text. A step cut short by Stop or an error is dropped from `history`. */
export async function runAgent(r: RunOptions): Promise<string> {
  const byName = new Map(r.tools.map((t) => [t.name, t]));
  const max = r.opts.maxSteps ?? 10;
  for (let step = 1; step <= max; step++) {
    r.emit({ type: "step", n: step });
    const c = await complete([{ role: "system", content: r.system }, ...trimHistory(r.history)], r.tools, r.opts, r.signal, (d) => r.emit({ type: "text", delta: d }), r.doFetch);
    if (c.usage) r.emit({ type: "usage", ...c.usage });
    const turn: ChatMsg[] = [{ role: "assistant", content: c.content || null, ...(c.toolCalls.length ? { tool_calls: c.toolCalls } : {}) }];
    if (!c.toolCalls.length) { r.history.push(...turn); return c.content; }
    const run = async (call: ToolCall): Promise<ChatMsg> => {
      const tool = byName.get(call.function.name); let args: any = {}, t0 = performance.now(), ok = true, result: unknown;
      try { args = call.function.arguments.trim() ? JSON.parse(call.function.arguments) : {}; } catch { args = null; }
      r.emit({ type: "tool_start", id: call.id, name: call.function.name, args, risk: tool?.risk ?? "read", label: tool?.label, undoable: tool?.undoable });
      try {
        if (!tool) throw new Error(`Unknown tool "${call.function.name}".`);
        if (args === null || typeof args !== "object") throw new Error("The arguments were not valid JSON.");
        if (tool.risk === "danger" && !(await r.ctx.confirm(call.function.name, tool.describe?.(args) ?? tool.description))) result = { declined: true, note: "The person declined. Do not retry; ask what they would prefer." };
        else result = await tool.run(args, r.ctx);
      } catch (e) {
        if ((e as Error)?.name === "AbortError") throw e;
        ok = false; result = { error: (e as Error).message };
      }
      r.emit({ type: "tool_end", id: call.id, name: call.function.name, ok, result, ms: performance.now() - t0 });
      return { role: "tool", tool_call_id: call.id, content: stringify(result) };
    };
    // reads cannot step on each other, so they run together; anything that changes the app runs one at a time, in order
    const parallel = c.toolCalls.every((x) => (byName.get(x.function.name)?.risk ?? "read") === "read");
    const results: ChatMsg[] = [];
    if (parallel) results.push(...(await Promise.all(c.toolCalls.map(run))));
    else for (const call of c.toolCalls) { if (r.signal.aborted) throw new DOMException("Stopped", "AbortError"); results.push(await run(call)); }
    if (r.signal.aborted) throw new DOMException("Stopped", "AbortError");
    r.history.push(...turn, ...results);
  }
  const msg = "I hit my step limit for one message. Tell me to continue and I will pick up from here.";
  r.emit({ type: "text", delta: msg }); r.history.push({ role: "assistant", content: msg });
  return msg;
}
