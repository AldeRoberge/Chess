import { runAgent, type AgentEvent, type AgentOptions, type AgentTool, type ChatMsg, type ToolCtx } from "./agent";
import type { AssistantHost } from "./host";
import { SYSTEM, stateMessage } from "./prompt";
import type { Watcher } from "./proactive";
import { buildTools } from "./tools";

/** Everything the chat window needs to show. The session never touches the DOM: a view listens to these. */
export type SessionEvent =
  | { type: "user"; text: string; queued: boolean }
  | { type: "dequeued" }
  | { type: "busy"; on: boolean }
  | { type: "agent"; event: AgentEvent }
  | { type: "approval"; title: string; detail: string; answer(ok: boolean): void }
  | { type: "choice"; question: string; options: string[]; answer(text: string): void }
  | { type: "error"; message: string; badKey: boolean }
  | { type: "stopped" }
  | { type: "needKey"; draft: string }
  | { type: "cleared" };

export interface SessionDeps {
  host: AssistantHost;
  watcher: Pick<Watcher, "take">;
  /** The key and model are read per message, so changing them in settings takes effect at once. */
  settings: () => Pick<AgentOptions, "apiKey" | "model">;
  emit(e: SessionEvent): void;
  fetchImpl?: typeof fetch;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  tools?: (h: AssistantHost) => AgentTool[];
  storageKey?: string;
}

/** One conversation: history, persistence, a queue for messages typed while a reply runs, and turning the agent's events into view events. */
export class ChatSession {
  history: ChatMsg[] = [];
  usage = { prompt: 0, completion: 0 };
  private ctl: AbortController | null = null;
  private queue: string[] = [];
  private readonly key: string;

  constructor(private d: SessionDeps) {
    this.key = d.storageKey ?? "cx.assistant.v1";
    this.history = this.load();
  }

  get busy() { return !!this.ctl; }
  get queued() { return this.queue.length; }

  /** The messages worth showing again after a reload. */
  transcript(): { role: "user" | "assistant"; text: string }[] {
    return this.history.flatMap((m) => (m.role === "user" || m.role === "assistant") && m.content ? [{ role: m.role, text: m.content }] : []);
  }

  private load(): ChatMsg[] {
    let saved: unknown = []; try { saved = JSON.parse(this.d.storage?.getItem(this.key) ?? "[]"); } catch { /* corrupt */ }
    const h = Array.isArray(saved) ? (saved as ChatMsg[]).filter((m) => m && typeof m.role === "string") : [];
    while (h.length && h[0].role !== "user") h.shift();
    return h;
  }
  private save() { try { this.d.storage?.setItem(this.key, JSON.stringify(this.history.slice(-60))); } catch { /* quota or blocked */ } }

  clear() {
    this.stop(); this.history = []; this.queue = []; this.usage = { prompt: 0, completion: 0 };
    try { this.d.storage?.removeItem(this.key); } catch { /* ignore */ }
    this.d.emit({ type: "cleared" });
  }

  stop() { this.ctl?.abort(); }

  /** Sends a message, or queues it while a reply is still running. */
  submit(text: string) {
    const t = text.trim(); if (!t) return;
    if (this.ctl) { this.queue.push(t); this.d.emit({ type: "user", text: t, queued: true }); return; }
    void this.turn(t);
  }

  /** Runs the last user message again (after an error). */
  retry() { void this.turn(null); }

  private async turn(text: string | null) {
    if (this.ctl) return;
    const { apiKey, model } = this.d.settings();
    if (!apiKey.trim()) { this.d.emit({ type: "needKey", draft: text ?? "" }); return; }
    if (text !== null) { this.d.emit({ type: "user", text, queued: false }); this.history.push({ role: "user", content: text }); }
    const ctl = this.ctl = new AbortController(); this.d.emit({ type: "busy", on: true });
    const ctx: ToolCtx = {
      signal: ctl.signal,
      confirm: (title, detail) => this.ask((answer) => this.d.emit({ type: "approval", title, detail, answer }), ctl.signal, false),
      choose: (question, options) => this.ask((answer) => this.d.emit({ type: "choice", question, options, answer }), ctl.signal, "(no answer: stopped)"),
    };
    try {
      const news = this.d.watcher.take();
      await runAgent({
        system: SYSTEM,
        context: () => stateMessage(this.d.host, news),
        history: this.history, tools: (this.d.tools ?? buildTools)(this.d.host), opts: { apiKey, model }, signal: ctl.signal, ctx, doFetch: this.d.fetchImpl,
        emit: (event) => { if (event.type === "usage") { this.usage.prompt += event.prompt; this.usage.completion += event.completion; } this.d.emit({ type: "agent", event }); },
      });
    } catch (e) {
      if ((e as Error)?.name === "AbortError") this.d.emit({ type: "stopped" });
      else this.d.emit({ type: "error", message: (e as Error).message, badKey: /401/.test((e as Error).message) });
    } finally {
      this.ctl = null; this.save(); this.d.emit({ type: "busy", on: false });
      const next = this.queue.shift();
      if (next) { this.d.emit({ type: "dequeued" }); void this.turn(next); }
    }
  }

  /** Turns "show a question, wait for the click" into a promise that also settles on Stop. */
  private ask<T>(show: (answer: (v: T) => void) => void, signal: AbortSignal, onStop: T): Promise<T> {
    return new Promise((res) => {
      const stopped = () => res(onStop);
      signal.addEventListener("abort", stopped, { once: true });
      show((v) => { signal.removeEventListener("abort", stopped); res(v); });
    });
  }
}
