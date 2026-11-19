import { bus } from "../core/bus";
import { validateSetup } from "../setup/config";
import type { AssistantHost } from "./host";
import { problems } from "./snapshot";

/** Things worth telling the person about, without being asked. Each fires once, until the condition clears and returns. */
export interface Nudge { id: string; level: "info" | "warn"; text: string; ask: string }

export class Watcher {
  private lastT = -Infinity; private since = new Map<string, number>(); private fired = new Set<string>();
  private news: string[] = [];
  /** Starts after what is already in the log, so old events are not reported as news. */
  constructor(private h: AssistantHost) { this.lastT = bus.events.reduce((m, e) => Math.max(m, e.t), -Infinity); }

  /** Checks the app. Call a few times a second. */
  poll(nowMs: number): Nudge[] {
    const out: Nudge[] = [], h = this.h;
    const fresh = bus.events.filter((e) => e.t > this.lastT);
    if (fresh.length) {
      this.lastT = Math.max(...fresh.map((e) => e.t));
      for (const e of fresh) {
        const d = e.data ? ` ${JSON.stringify(e.data)}` : "";
        this.news.push(`${e.type}${d}`);
        if (e.type === "mate" || e.type === "draw") out.push({ id: `end-${e.t}`, level: "info", text: e.type === "mate" ? "Checkmate. The game is over." : "The game ended in a draw.", ask: "The game just ended. Give me a short recap and tell me what I can do next (rematch, reset the table, change the opponent)." });
        if (e.type === "illegal") out.push({ id: `ill-${e.t}`, level: "warn", text: "The tracker saw an illegal position.", ask: "The tracker just reported an illegal move or position. What happened and what should I do?" });
      }
      if (this.news.length > 20) this.news.splice(0, this.news.length - 20);
    }
    // a condition that persists is a problem; a blip is not
    const hold = (id: string, bad: boolean, secs: number, make: () => Omit<Nudge, "id">) => {
      if (!bad) { this.since.delete(id); this.fired.delete(id); return; }
      const t0 = this.since.get(id) ?? nowMs; this.since.set(id, t0);
      if (nowMs - t0 >= secs * 1000 && !this.fired.has(id)) { this.fired.add(id); const n = make(); out.push({ id, ...n }); this.news.push(n.text); }
    };
    for (const c of bus.cameras) hold(`cam-${c.id}`, !c.online || c.quality < 0.35, 6, () => ({ level: "warn", text: c.online ? `Camera ${c.id} picture quality is only ${Math.round(c.quality * 100)}%.` : `Camera ${c.id} is offline.`, ask: `Camera ${c.id} has a problem. Diagnose it and tell me how to fix it.` }));
    hold("board", !!bus.cameras.length && !!bus.board && bus.board.fidelity < 0.5, 10, () => ({ level: "warn", text: "The cameras read the board poorly.", ask: "The board reading is poor. Find out why and how to improve it." }));
    const errs = h.nodeErrors();
    hold("node-errors", errs.length > 0, 3, () => ({ level: "warn", text: `${errs.length} node${errs.length > 1 ? "s are" : " is"} reporting errors.`, ask: "Some nodes are reporting errors. Find the cause and fix what you can." }));
    const s = h.setup(); const bad = s ? validateSetup(s).filter((i) => i.level === "error").length : 0;
    hold("setup-errors", bad > 0, 2, () => ({ level: "warn", text: `The setup has ${bad} error${bad > 1 ? "s" : ""}.`, ask: "The setup has errors. Fix them." }));
    return out;
  }

  /** News since the last call, for the next message to the model. */
  take(): string[] { const n = this.news; this.news = []; return n; }
}

/** Starter questions that fit what is happening right now. */
export function suggestions(h: AssistantHost): string[] {
  const out: string[] = [], p = problems(h), s = h.setup();
  if (!s || !s.completed) out.push("Help me set the game up from scratch");
  out.push("Talk me through the cameras");
  if (p.some((x) => x.level === "error")) out.push("Fix the errors in my setup");
  else if (p.length) out.push("Check my setup and tell me what to improve");
  if (bus.cameras.some((c) => !c.online || c.quality < 0.4)) out.push("Why is a camera performing badly?");
  if (h.selection().length) out.push("Explain the selected node and what to tweak");
  if (bus.game?.over) out.push("Recap the game and set up a rematch");
  else if (bus.game && bus.game.ply > 0) out.push("What is going on in this game?");
  if (s && s.opponent.mode !== "engine") out.push("Make me play against the engine");
  out.push("Change the scene and the narrators", "What can you do?");
  return [...new Set(out)].slice(0, 5);
}
