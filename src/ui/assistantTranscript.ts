import type { AgentEvent } from "../assistant/agent";
import { icon, withIcon, setLabel } from "./icons";
import { md } from "./markdown";
import { spinnerHTML } from "./spinner";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
const button = (label: string, cls = "", fn?: () => void) => { const b = el("button", cls, label); b.type = "button"; if (fn) b.onclick = fn; return withIcon(b, ({ Clear: "trash", Key: "key", "✕": "x", "Ask AI": "assistant", Undo: "undo", Decline: "x", Approve: "check", Retry: "refresh" } as Record<string, string>)[label] ?? "chat", 14); };

interface Turn { box: HTMLElement; text: HTMLElement; raw: string; waiting: HTMLElement }

/** The scrolling conversation: bubbles, tool cards, approval and choice cards. Knows nothing about the model or the app. */
export class Transcript {
  readonly root = el("div", "as-log");
  private turn: Turn | null = null;
  private cards = new Map<string, HTMLElement>();
  /** Called when an Undo button on a card is pressed; returns whether anything was undone. */
  onUndo: () => boolean = () => false;

  private scroll() { this.root.scrollTop = this.root.scrollHeight; }
  clear() { this.root.replaceChildren(); this.turn = null; this.cards.clear(); }

  user(text: string, queued = false) {
    const box = el("div", `as-msg user${queued ? " queued" : ""}`), body = el("div", "as-body", text);
    box.append(body); this.root.append(box); this.scroll();
  }
  /** A queued message is about to run: its grey copy goes, the real one is added by `user`. */
  dequeue() { this.root.querySelector(".as-msg.queued")?.remove(); }
  /** An earlier assistant answer, restored from storage. `spoken` marks a line that was also said aloud. */
  assistant(text: string, spoken = false) { const box = el("div", "as-msg assistant"), body = el("div", "as-body"); body.innerHTML = md(text); box.append(body); if (spoken) box.append(el("span", "as-said", "Said aloud")); this.root.append(box); }
  /** The latest assistant bubble was spoken. */
  markSpoken() {
    const last = this.root.querySelector(".as-msg.assistant:last-child");
    if (last && !last.querySelector(".as-said")) last.append(el("span", "as-said", "Said aloud"));
  }

  /** Opens the assistant's reply (with its "thinking" line) if one is not open yet. */
  begin(): Turn {
    if (this.turn) return this.turn;
    const box = el("div", "as-msg assistant"), body = el("div", "as-body"), waiting = el("div", "as-wait");
    waiting.innerHTML = `${spinnerHTML("knight", 16)}<span>Thinking…</span>`;
    box.append(waiting, body); this.root.append(box); this.cards.clear();
    return (this.turn = { box, text: body, raw: "", waiting });
  }
  /** Closes the reply: no more spinner. */
  end() { this.turn?.waiting.remove(); this.turn = null; this.scroll(); }
  private status(t: string) { this.begin().waiting.querySelector("span:last-child")!.textContent = t; }

  /** Renders one event from the agent: streamed text, tool cards, step changes. */
  agent(e: AgentEvent) {
    const t = this.begin();
    if (e.type === "text") { t.raw += e.delta; t.waiting.remove(); t.text.innerHTML = md(t.raw); }
    else if (e.type === "tool_start") { this.status(`${e.label?.doing ?? e.name}…`); this.startCard(e); }
    else if (e.type === "tool_end") this.endCard(e);
    else if (e.type === "step" && e.n > 1) { this.status("Working…"); if (!t.waiting.isConnected) t.box.prepend(t.waiting); }
    this.scroll();
  }

  private startCard(e: Extract<AgentEvent, { type: "tool_start" }>) {
    const t = this.begin(), c = el("div", `as-tool ${e.risk}`), head = el("div", "as-tool-h");
    head.innerHTML = `<span class="as-tool-i">${spinnerHTML("orbit", 14)}</span><span class="as-tool-l"></span><span class="as-tool-t"></span>`;
    head.querySelector(".as-tool-l")!.textContent = e.name === "think" ? (e.label?.doing ?? "Thinking") : `${e.label?.doing ?? e.name}…`;
    c.dataset.undoable = e.undoable ? "1" : ""; c.dataset.done = e.label?.done ?? e.name; c.append(head);
    if (e.name === "think") { c.classList.add("think"); c.append(el("div", "as-thought", String(e.args?.thought ?? ""))); }
    t.box.insertBefore(c, t.text); this.cards.set(e.id, c);
  }
  private endCard(e: Extract<AgentEvent, { type: "tool_end" }>) {
    const c = this.cards.get(e.id); if (!c) return;
    const r = e.result as any, declined = !!r?.declined, blocked = !!r?.blocked_by, think = e.name === "think", done = c.dataset.done!;
    c.classList.add(e.ok ? "ok" : "bad");
    c.querySelector(".as-tool-i")!.innerHTML = think ? icon("brain", 14) : e.ok ? icon("check", 14) : "✕";
    c.querySelector(".as-tool-l")!.textContent = !e.ok ? `${done} failed` : declined ? "You declined" : blocked ? "Blocked: it would break the setup" : done;
    if (think) { c.classList.add("collapsed"); (c.querySelector(".as-tool-h") as HTMLElement).onclick = () => c.classList.toggle("collapsed"); return; }
    if (e.ms >= 50) c.querySelector(".as-tool-t")!.textContent = e.ms >= 1000 ? `${(e.ms / 1000).toFixed(1)} s` : `${Math.round(e.ms)} ms`;
    const det = el("details", "as-det"), pre = el("pre", "", pretty(e.result));
    det.append(el("summary", "", e.ok ? "details" : "error"), pre); c.append(det);
    if (!e.ok) c.append(el("div", "as-err", String(r?.error ?? "")));
    if (e.ok && c.dataset.undoable && !declined && !blocked) {
      const u = button("Undo", "ghost as-undo"); u.onclick = () => { if (this.onUndo()) { setLabel(u, "Undone"); u.disabled = true; } }; c.append(u);
    }
  }

  /** Approve / Decline card. */
  approval(title: string, detail: string, answer: (ok: boolean) => void) {
    const t = this.begin(), c = el("div", "as-ask"), row = el("div", "as-ask-b");
    const done = (v: boolean) => { c.classList.add("answered"); row.replaceChildren(el("span", "", v ? "Approved" : "Declined")); answer(v); };
    const no = button("Decline", "", () => done(false));
    row.append(button("Approve", "primary", () => done(true)), no);
    c.append(el("b", "", "Needs your approval"), el("p", "", detail || title), row);
    t.box.insertBefore(c, t.text); this.scroll(); no.focus();
  }

  /** A question with option buttons and a free-text box. */
  choice(question: string, options: string[], answer: (text: string) => void) {
    const t = this.begin(), c = el("div", "as-ask"), row = el("div", "as-ask-b"), free = el("input");
    free.placeholder = "or type your own answer, then Enter"; free.setAttribute("aria-label", "Your answer");
    const done = (v: string) => { c.classList.add("answered"); c.replaceChildren(el("b", "", question), el("span", "", `→ ${v}`)); answer(v); };
    for (const o of options) row.append(button(o, "", () => done(o)));
    free.onkeydown = (e) => { if (e.key === "Enter" && free.value.trim()) done(free.value.trim()); };
    c.append(el("b", "", question), row, free); t.box.insertBefore(c, t.text); this.scroll();
  }

  stopped() { const t = this.begin(); t.waiting.remove(); t.box.append(el("div", "as-stopped", "Stopped.")); }
  /** An error under the reply, with a Retry button. */
  error(message: string, retry: () => void) {
    const t = this.begin(); t.waiting.remove();
    t.box.classList.add("retry"); t.box.append(el("div", "as-err", message), button("Retry", "", () => { t.box.remove(); retry(); }));
  }
}

function pretty(v: unknown) { try { const s = JSON.stringify(v, null, 1); return s.length > 2500 ? `${s.slice(0, 2500)}\n…` : s; } catch { return String(v); } }
