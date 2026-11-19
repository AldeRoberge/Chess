import "./assistant.css";
import type { AssistantHost } from "../assistant/host";
import { Watcher, suggestions, type Nudge } from "../assistant/proactive";
import { ChatSession, type SessionEvent } from "../assistant/session";
import { icon } from "./icons";
import { KeyBox } from "./assistantKeyBox";
import { Transcript } from "./assistantTranscript";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
const button = (label: string, cls = "", fn?: () => void) => { const b = el("button", cls, label); b.type = "button"; if (fn) b.onclick = fn; return b; };

export interface AssistantDeps { fetchImpl?: typeof fetch; storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> }

/** The Assistant tab. Only layout and wiring: the conversation is a ChatSession, the messages a Transcript, the settings a KeyBox. */
export class AssistantPanel {
  readonly root = el("div", "panel as");
  readonly session: ChatSession;
  /** Something new worth a look arrived (the app lights up the tab when it is not open). */
  onNudge?: () => void;
  private view = new Transcript();
  private keys: KeyBox;
  private watcher: Watcher;
  private pills = el("div", "as-pills"); private nudges = el("div", "as-nudges"); private chips = el("div", "as-chips");
  private input = el("textarea", "as-in"); private send = el("button", "as-send primary");
  private shown = new Set<string>(); private lastPoll = 0; private pillKey = "";

  constructor(private h: AssistantHost, deps: AssistantDeps = {}) {
    this.watcher = new Watcher(h);
    this.keys = new KeyBox(() => h.setup()?.ai.apiKey ?? "");
    const storage = deps.storage ?? (() => { try { return localStorage; } catch { return undefined; } })();
    this.session = new ChatSession({ host: h, watcher: this.watcher, settings: () => ({ apiKey: this.keys.apiKey(), model: this.keys.model() }), emit: (e) => this.on(e), fetchImpl: deps.fetchImpl, storage });
    this.view.onUndo = () => h.undo();

    const head = el("div", "as-head"), clear = button("Clear", "ghost", () => this.session.clear()), cfg = button("Key", "ghost", () => this.keys.toggle());
    clear.title = "Start a new conversation"; cfg.title = "OpenAI API key and model";
    head.append(el("b", "", "Assistant"), this.pills, clear, cfg);
    this.input.rows = 2; this.input.placeholder = "Ask for anything: “set up two cameras and a forest scene”, “why is camera B bad?”…  (Enter sends, Shift+Enter = new line)";
    this.input.setAttribute("aria-label", "Message to the assistant");
    this.input.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.submit(); } };
    this.send.type = "button"; this.send.onclick = () => (this.session.busy ? this.session.stop() : this.submit());
    const row = el("div", "as-row"); row.append(this.input, this.send);
    this.root.append(head, this.keys.root, this.view.root, this.nudges, this.chips, row);
    for (const m of this.session.transcript()) m.role === "user" ? this.view.user(m.text) : this.view.assistant(m.text);
    this.setBusy(false); this.refreshChips();
  }

  /** Sends what is typed, or the given text (a chip, a nudge). */
  submit(text = this.input.value) { this.input.value = ""; this.session.submit(text); }
  get history() { return this.session.history; }

  /** Turns what the session reports into what the screen shows. */
  private on(e: SessionEvent) {
    const v = this.view;
    switch (e.type) {
      case "user": v.user(e.text, e.queued); break;
      case "dequeued": v.dequeue(); break;
      case "busy": if (e.on) { v.begin(); this.chips.replaceChildren(); } else { v.end(); this.refreshChips(); } this.setBusy(e.on); break;
      case "agent": v.agent(e.event); break;
      case "approval": v.approval(e.title, e.detail, e.answer); break;
      case "choice": v.choice(e.question, e.options, e.answer); break;
      case "stopped": v.stopped(); break;
      case "error": v.error(e.message, () => this.session.retry()); if (e.badKey) this.keys.demand(); break;
      case "needKey": this.input.value = e.draft; this.keys.demand(); break;
      case "cleared": v.clear(); this.refreshChips(); break;
    }
  }

  private setBusy(on: boolean) {
    this.send.innerHTML = on ? `${icon("stop", 16)}<span>Stop</span>` : `${icon("send", 16)}<span>Send</span>`;
    this.send.classList.toggle("on", on); this.send.title = on ? "Stop (Enter on a new message queues it)" : "Send (Enter)";
  }
  private refreshChips() {
    this.chips.replaceChildren();
    if (this.session.busy) return;
    for (const s of suggestions(this.h)) this.chips.append(button(s, "as-chip", () => this.submit(s)));
  }

  // ---- context clues -------------------------------------------------------------------------
  private pillText() {
    const r = this.h.route(), sel = this.h.selection().length, parts = [`page: ${r.page}`];
    if (sel) parts.push(`${sel} node${sel > 1 ? "s" : ""} selected`);
    return parts;
  }
  /** Called from the app loop: shows what the assistant would notice by itself, and keeps the context pills current. */
  frame(nowMs: number) {
    if (nowMs - this.lastPoll < 500) return; this.lastPoll = nowMs;
    const parts = this.pillText(), key = parts.join("|");
    if (key !== this.pillKey) { this.pillKey = key; this.pills.replaceChildren(...parts.map((p) => el("span", "as-pill", p))); this.pills.title = "What the assistant sees right now"; }
    for (const n of this.watcher.poll(nowMs)) this.nudge(n);
  }
  private nudge(n: Nudge) {
    if (this.shown.has(n.id)) return; this.shown.add(n.id);
    const c = el("div", `as-nudge ${n.level}`), x = button("✕", "ghost", () => c.remove());
    x.setAttribute("aria-label", "Dismiss");
    c.append(el("span", "", n.text), button("Ask AI", "primary", () => { c.remove(); this.submit(n.ask); }), x); this.nudges.append(c);
    while (this.nudges.children.length > 3) this.nudges.firstElementChild!.remove();
    this.onNudge?.();
  }
}
