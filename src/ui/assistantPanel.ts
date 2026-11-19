import "./assistant.css";
import { runAgent, type AgentEvent, type ChatMsg, type Risk, type ToolCtx } from "../assistant/agent";
import { SYSTEM, stateMessage, suggestions, Watcher, type AssistantHost, type Nudge } from "../assistant/context";
import { buildTools } from "../assistant/tools";
import { AI_DEFAULT_MODEL, loadAiSettings, saveAiSettings } from "../workflows/ai";
import { icon } from "./icons";
import { spinnerHTML } from "./spinner";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** A small, safe Markdown: paragraphs, "-" lists, **bold**, *italic*, `code`. Everything is escaped first. */
export function md(src: string): string {
  const inline = (t: string) => esc(t).replace(/`([^`\n]+)`/g, "<code>$1</code>").replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>").replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, "$1<i>$2</i>");
  const out: string[] = []; let list: string[] = [], para: string[] = [];
  const flushP = () => { if (para.length) { out.push(`<p>${para.join("<br>")}</p>`); para = []; } };
  const flushL = () => { if (list.length) { out.push(`<ul>${list.map((x) => `<li>${x}</li>`).join("")}</ul>`); list = []; } };
  for (const raw of src.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd(), m = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (m) { flushP(); list.push(inline(m[1])); } else if (!line.trim()) { flushP(); flushL(); } else { flushL(); para.push(inline(line.replace(/^#{1,4}\s+/, ""))); }
  }
  flushP(); flushL();
  return out.join("");
}

/** Plain-language labels for what each tool is doing, shown on its card. */
const LABEL: Record<string, [doing: string, done: string]> = {
  think: ["Thinking", "Thought it through"], get_state: ["Looking at the app", "Looked at the app"], get_events: ["Reading recent events", "Read recent events"], get_setup: ["Reading the setup", "Read the setup"],
  diagnose: ["Diagnosing", "Diagnosed"], list_node_types: ["Looking up node types", "Looked up node types"], get_node: ["Inspecting a node", "Inspected a node"], update_setup: ["Changing the setup", "Changed the setup"],
  camera: ["Changing cameras", "Changed cameras"], set_node_param: ["Setting a parameter", "Set a parameter"], set_bypass: ["Switching a node", "Switched a node"], apply_workflow: ["Replacing the workflow", "Replaced the workflow"],
  navigate: ["Opening a page", "Opened a page"], table_play: ["Playing a move", "Played a move"], table_seat: ["Moving the player", "Moved the player"], table_reset: ["Resetting the table", "Reset the table"],
  undo: ["Undoing", "Undid the last change"], redo: ["Redoing", "Redid it"], wait_for_event: ["Waiting for the game", "Got an event"], ask_user: ["Asking you", "You answered"], list_scenarios: ["Listing demo games", "Listed demo games"],
};
const UNDOABLE = new Set(["update_setup", "camera", "set_node_param", "set_bypass", "apply_workflow"]);
const KEY = "cx.assistant.v1";

export interface AssistantDeps { fetchImpl?: typeof fetch; storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> }

/** The Assistant tab: a chat that can see the whole app, reason with tools, and change things on request. */
export class AssistantPanel {
  root = el("div", "panel as");
  history: ChatMsg[] = [];
  private log = el("div", "as-log"); private nudges = el("div", "as-nudges"); private chips = el("div", "as-chips"); private pills = el("div", "as-pills");
  private input = el("textarea", "as-in"); private send = el("button", "as-send primary"); private keyBox = el("div", "as-key");
  private ctl: AbortController | null = null; private queued: string[] = []; private usage = { prompt: 0, completion: 0 };
  private watcher: Watcher; private shown = new Set<string>(); private lastPoll = 0; private pillKey = "";
  private cur: { box: HTMLElement; text: HTMLElement; raw: string; waiting: HTMLElement } | null = null;
  private cards = new Map<string, HTMLElement>();
  private store: AssistantDeps["storage"];
  /** Something new worth a look arrived (the app lights up the tab when it is not open). */
  onNudge?: () => void;

  constructor(private h: AssistantHost, private deps: AssistantDeps = {}) {
    this.watcher = new Watcher(h);
    this.store = deps.storage ?? (() => { try { return localStorage; } catch { return undefined; } })();
    const head = el("div", "as-head"), clear = el("button", "ghost", "Clear"), cfg = el("button", "ghost", "Key");
    clear.type = "button"; cfg.type = "button"; clear.title = "Start a new conversation"; cfg.title = "OpenAI API key and model";
    clear.onclick = () => this.clear(); cfg.onclick = () => this.keyBox.classList.toggle("open");
    head.append(el("b", "", "Assistant"), this.pills, clear, cfg);
    this.input.rows = 2; this.input.placeholder = "Ask for anything: “set up two cameras and a forest scene”, “why is camera B bad?”…  (Enter sends, Shift+Enter = new line)";
    this.input.setAttribute("aria-label", "Message to the assistant");
    this.input.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.submit(); } };
    this.send.type = "button"; this.send.onclick = () => (this.ctl ? this.stop() : this.submit());
    const row = el("div", "as-row"); row.append(this.input, this.send);
    this.root.append(head, this.keyBox, this.log, this.nudges, this.chips, row);
    this.buildKeyBox(); this.restore(); this.syncSend(); this.refreshChips();
  }

  // ---- settings ---------------------------------------------------------------------------------
  private apiKey = () => loadAiSettings().apiKey || this.h.setup()?.ai.apiKey || "";
  private model = () => loadAiSettings().model || AI_DEFAULT_MODEL;
  private buildKeyBox() {
    const s = loadAiSettings(), key = el("input"), model = el("input"), rem = el("input"), save = el("button", "primary", "Save");
    key.type = "password"; key.placeholder = "OpenAI API key (sk-...)"; key.autocomplete = "off"; key.value = s.apiKey; key.setAttribute("aria-label", "OpenAI API key");
    model.value = s.model; model.setAttribute("aria-label", "Model"); model.placeholder = AI_DEFAULT_MODEL;
    rem.type = "checkbox"; rem.checked = s.remember; save.type = "button";
    const keep = el("label", "chk"); keep.append(rem, el("span", "", "Remember the key in this browser (stored unencrypted)"));
    save.onclick = () => { saveAiSettings({ apiKey: key.value, model: model.value.trim() || AI_DEFAULT_MODEL, remember: rem.checked }); this.keyBox.classList.remove("open"); this.refreshKeyState(); };
    this.keyBox.replaceChildren(el("p", "", "Messages go straight from this page to OpenAI with your own key. The assistant never sees API keys, and never sets them."), key, model, keep, save);
    this.refreshKeyState();
  }
  private refreshKeyState() { this.keyBox.classList.toggle("need", !this.apiKey().trim()); if (!this.apiKey().trim()) this.keyBox.classList.add("open"); }

  // ---- persistence ------------------------------------------------------------------------------
  private save() { try { this.store?.setItem(KEY, JSON.stringify(this.history.slice(-60))); } catch { /* quota or blocked */ } }
  private restore() {
    let saved: ChatMsg[] = []; try { saved = JSON.parse(this.store?.getItem(KEY) ?? "[]"); } catch { /* corrupt */ }
    this.history = Array.isArray(saved) ? saved.filter((m) => m && typeof m.role === "string") : [];
    while (this.history.length && this.history[0].role !== "user") this.history.shift();
    for (const m of this.history) { if (m.role === "user" && m.content) this.bubble("user", m.content); else if (m.role === "assistant" && m.content) this.bubble("assistant", m.content, true); }
    this.scroll();
  }
  clear() { this.stop(); this.history = []; this.queued = []; this.usage = { prompt: 0, completion: 0 }; this.log.replaceChildren(); try { this.store?.removeItem(KEY); } catch { /* ignore */ } this.refreshChips(); }

  // ---- rendering --------------------------------------------------------------------------------
  private scroll() { this.log.scrollTop = this.log.scrollHeight; }
  private bubble(who: "user" | "assistant", text: string, rich = who === "assistant") {
    const b = el("div", `as-msg ${who}`), body = el("div", "as-body"); if (rich) body.innerHTML = md(text); else body.textContent = text;
    b.append(body); this.log.append(b); return { box: b, body };
  }
  private ensureTurn() {
    if (this.cur) return this.cur;
    const { box, body } = this.bubble("assistant", "", false), waiting = el("div", "as-wait"); waiting.innerHTML = `${spinnerHTML("knight", 16)}<span>Thinking…</span>`;
    box.prepend(waiting); this.cur = { box, text: body, raw: "", waiting }; return this.cur;
  }
  private card(id: string, name: string, risk: Risk, args: any) {
    const t = this.ensureTurn(), c = el("div", `as-tool ${risk}`), head = el("div", "as-tool-h");
    head.innerHTML = `<span class="as-tool-i">${spinnerHTML("orbit", 14)}</span><span class="as-tool-l"></span><span class="as-tool-t"></span>`;
    head.querySelector(".as-tool-l")!.textContent = (LABEL[name] ?? [name, name])[0] + (name === "think" ? "" : "…");
    c.append(head);
    if (name === "think") { const th = el("div", "as-thought", String(args?.thought ?? "")); c.classList.add("think"); c.append(th); }
    t.box.insertBefore(c, t.text); this.cards.set(id, c); this.scroll(); return c;
  }
  private endCard(id: string, name: string, ok: boolean, result: unknown, ms: number) {
    const c = this.cards.get(id); if (!c) return;
    c.classList.add(ok ? "ok" : "bad"); c.classList.remove("running");
    c.querySelector(".as-tool-i")!.innerHTML = name === "think" ? icon("brain", 14) : ok ? icon("check", 14) : "✕";
    const label = c.querySelector(".as-tool-l")!, [, done] = LABEL[name] ?? [name, name];
    const declined = !!(result as any)?.declined, blocked = !!(result as any)?.blocked_by;
    label.textContent = !ok ? `${done} failed` : declined ? "You declined" : blocked ? "Blocked: it would break the setup" : done;
    if (name !== "think" && ms >= 50) c.querySelector(".as-tool-t")!.textContent = ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
    if (name === "think") { const th = c.querySelector(".as-thought"); if (th) c.classList.add("collapsed"), (c.querySelector(".as-tool-h") as HTMLElement).onclick = () => c.classList.toggle("collapsed"); return; }
    const det = el("details", "as-det"), sum = el("summary", "", ok ? "details" : "error");
    const pre = el("pre", "", this.pretty(result)); det.append(sum, pre); c.append(det);
    if (!ok) c.append(el("div", "as-err", String((result as any)?.error ?? "")));
    if (ok && UNDOABLE.has(name) && !declined && !blocked && ((result as any)?.applied?.length || (result as any)?.now !== undefined || (result as any)?.bypass !== undefined)) {
      const u = el("button", "ghost as-undo", "Undo"); u.type = "button"; u.onclick = () => { if (this.h.undo()) { u.textContent = "Undone"; u.disabled = true; } };
      c.append(u);
    }
    this.scroll();
  }
  private pretty(v: unknown) { try { const s = JSON.stringify(v, null, 1); return s.length > 2500 ? `${s.slice(0, 2500)}\n…` : s; } catch { return String(v); } }

  /** An approval card in the chat. Resolves true on Approve. */
  private ask(title: string, detail: string, signal: AbortSignal): Promise<boolean> {
    const t = this.ensureTurn(), c = el("div", "as-ask"), ok = el("button", "primary", "Approve"), no = el("button", "", "Decline");
    ok.type = "button"; no.type = "button";
    c.append(el("b", "", "Needs your approval"), el("p", "", detail || title), el("div", "as-ask-b"));
    c.lastElementChild!.append(ok, no); t.box.insertBefore(c, t.text); this.scroll(); no.focus();
    return new Promise((res) => {
      const done = (v: boolean) => { signal.removeEventListener("abort", stopped); c.classList.add("answered"); c.querySelector(".as-ask-b")!.replaceChildren(el("span", "", v ? "Approved" : "Declined")); res(v); };
      const stopped = () => done(false);
      signal.addEventListener("abort", stopped); ok.onclick = () => done(true); no.onclick = () => done(false);
    });
  }
  private pick(question: string, options: string[], signal: AbortSignal): Promise<string> {
    const t = this.ensureTurn(), c = el("div", "as-ask"), row = el("div", "as-ask-b"), free = el("input");
    free.placeholder = "or type your own answer, then Enter"; free.setAttribute("aria-label", "Your answer");
    c.append(el("b", "", question), row, free); t.box.insertBefore(c, t.text); this.scroll();
    return new Promise((res) => {
      const done = (v: string) => { signal.removeEventListener("abort", stopped); c.classList.add("answered"); c.replaceChildren(el("b", "", question), el("span", "", `→ ${v}`)); res(v); };
      const stopped = () => done("(no answer: stopped)");
      signal.addEventListener("abort", stopped);
      for (const o of options) { const b = el("button", "", o); b.type = "button"; b.onclick = () => done(o); row.append(b); }
      free.onkeydown = (e) => { if (e.key === "Enter" && free.value.trim()) done(free.value.trim()); };
    });
  }

  // ---- the conversation -------------------------------------------------------------------------
  private onEvent = (e: AgentEvent) => {
    if (e.type === "text") { const t = this.ensureTurn(); t.raw += e.delta; t.waiting.remove(); t.text.innerHTML = md(t.raw); this.scroll(); }
    else if (e.type === "tool_start") { this.ensureTurn().waiting.querySelector("span:last-child")!.textContent = (LABEL[e.name] ?? [e.name])[0] + "…"; this.card(e.id, e.name, e.risk, e.args); }
    else if (e.type === "tool_end") this.endCard(e.id, e.name, e.ok, e.result, e.ms);
    else if (e.type === "usage") { this.usage.prompt += e.prompt; this.usage.completion += e.completion; }
    else if (e.type === "step" && this.cur) { this.cur.waiting.querySelector("span:last-child")!.textContent = e.n > 1 ? "Working…" : "Thinking…"; if (!this.cur.waiting.isConnected) this.cur.box.prepend(this.cur.waiting); }
  };

  /** Sends what is typed (or queues it while a reply is still running). */
  submit(text = this.input.value) {
    const t = text.trim(); if (!t) return;
    this.input.value = "";
    if (this.ctl) { this.queued.push(t); this.bubble("user", t, false).box.classList.add("queued"); this.scroll(); return; }
    void this.turn(t);
  }
  stop() { this.ctl?.abort(); }

  private async turn(text: string | null) {
    if (this.ctl) return;
    if (!this.apiKey().trim()) { this.keyBox.classList.add("open", "need"); this.input.value = text ?? ""; this.keyBox.scrollIntoView?.({ block: "nearest" }); return; }
    if (text !== null) { this.bubble("user", text, false); this.history.push({ role: "user", content: text }); }
    for (const c of this.log.querySelectorAll(".as-msg.retry")) c.remove();
    this.ctl = new AbortController(); this.syncSend(); this.cur = null; this.cards.clear(); this.chips.replaceChildren(); this.scroll();
    const ctl = this.ctl;
    const ctx: ToolCtx = { signal: ctl.signal, confirm: (title, detail) => this.ask(title, detail, ctl.signal), choose: (q, o) => this.pick(q, o, ctl.signal) };
    this.ensureTurn();
    try {
      const system = `${SYSTEM}\n\n${stateMessage(this.h, this.watcher.take())}`;
      await runAgent({ system, history: this.history, tools: buildTools(this.h), opts: { apiKey: this.apiKey(), model: this.model() }, signal: ctl.signal, ctx, emit: this.onEvent, doFetch: this.deps.fetchImpl });
    } catch (e) {
      const stopped = (e as Error)?.name === "AbortError";
      const t = this.ensureTurn(); t.waiting.remove();
      if (stopped) t.box.append(el("div", "as-stopped", "Stopped."));
      else {
        const msg = el("div", "as-err", (e as Error).message), retry = el("button", "", "Retry"); retry.type = "button"; retry.onclick = () => { t.box.remove(); void this.turn(null); };
        t.box.append(msg, retry); t.box.classList.add("retry");
        if (/401/.test((e as Error).message)) this.keyBox.classList.add("open", "need");
      }
      if (!t.raw && !t.box.querySelector(".as-tool,.as-ask") && stopped) t.box.classList.add("empty");
    } finally {
      (this.cur as AssistantPanel["cur"])?.waiting.remove(); this.cur = null; this.ctl = null; this.save(); this.syncSend(); this.refreshChips(); this.scroll();
      const next = this.queued.shift();
      if (next) { for (const q of this.log.querySelectorAll(".as-msg.queued")) { q.remove(); break; } void this.turn(next); }
    }
  }

  private syncSend() {
    const run = !!this.ctl; this.send.innerHTML = run ? `${icon("stop", 16)}<span>Stop</span>` : `${icon("send", 16)}<span>Send</span>`;
    this.send.classList.toggle("on", run); this.send.title = run ? "Stop (Enter on a new message queues it)" : "Send (Enter)";
  }

  // ---- context clues ----------------------------------------------------------------------------
  private refreshChips() {
    this.chips.replaceChildren();
    if (this.ctl) return;
    for (const s of suggestions(this.h)) { const b = el("button", "as-chip", s); b.type = "button"; b.onclick = () => this.submit(s); this.chips.append(b); }
  }
  private pillsNow() {
    const h = this.h, r = h.route(), sel = h.selection().length;
    const parts = [`page: ${r.page === "setup" ? "setup" : r.page}`]; if (sel) parts.push(`${sel} node${sel > 1 ? "s" : ""} selected`);
    return parts;
  }

  /** Called from the app loop: shows what the assistant would notice by itself, and keeps the context pills current. */
  frame(nowMs: number) {
    if (nowMs - this.lastPoll < 500) return; this.lastPoll = nowMs;
    const parts = this.pillsNow(), key = parts.join("|");
    if (key !== this.pillKey) { this.pillKey = key; this.pills.replaceChildren(...parts.map((p) => el("span", "as-pill", p))); this.pills.title = "What the assistant sees right now"; }
    for (const n of this.watcher.poll(nowMs)) this.nudge(n);
  }
  private nudge(n: Nudge) {
    if (this.shown.has(n.id)) return; this.shown.add(n.id);
    const c = el("div", `as-nudge ${n.level}`), ask = el("button", "primary", "Ask AI"), x = el("button", "ghost", "✕");
    ask.type = "button"; x.type = "button"; x.setAttribute("aria-label", "Dismiss");
    ask.onclick = () => { c.remove(); this.submit(n.ask); }; x.onclick = () => c.remove();
    c.append(el("span", "", n.text), ask, x); this.nudges.append(c);
    while (this.nudges.children.length > 3) this.nudges.firstElementChild!.remove();
    this.onNudge?.();
  }
}
