import type { GraphJSON, Registry } from "../core/types";
import { bus } from "../core/bus";
import type { ExperienceEvent } from "../core/events";
import { hasErrors, validateSetup, type Issue, type SetupConfig } from "../setup/config";
import type { Route } from "../ui/route";

/** What the assistant may read and change in the running app. app.ts implements it; tests fake it. */
export interface AssistantHost {
  registry: Registry;
  graph(): GraphJSON;
  /** The saved setup, or null before the first one. */
  setup(): SetupConfig | null;
  /** Save a new setup and rebuild the workflow from it. Undoable. */
  applySetup(cfg: SetupConfig, why: string): void;
  /** Replace the whole workflow. The app backs up what there was and makes it undoable. */
  applyGraph(g: GraphJSON, why: string): void;
  /** Set one node parameter (already validated). Returns false when the node does not exist. */
  setParam(nodeId: string, key: string, value: string | number | boolean): boolean;
  setBypass(nodeId: string, on: boolean): boolean;
  selection(): string[];
  /** Errors the nodes reported on their last tick. */
  nodeErrors(): { node: string; type: string; message: string; hint?: string }[];
  route(): Route;
  go(r: Route): void;
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  /** The virtual table: used when playing without cameras. */
  table: { fen(): string; legal(): string[]; reset(): void; seat(on: boolean): void; seated(): boolean; play(move: string): boolean };
  sound(): { on: boolean; muted: boolean };
  /** The app clock in ms (the same one event times use). */
  now(): number;
}

const SECRET = /key|token|secret|password/i;
/** The setup with every secret blanked, as the model is allowed to see it. */
export function redact<T>(v: T): T {
  if (Array.isArray(v)) return v.map(redact) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET.test(k) ? (x ? "(set)" : "(empty)") : redact(x)])) as T;
  return v;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Setup problems, plus live ones the validator cannot see (a camera that went dark, a node that is throwing). */
export function problems(h: AssistantHost): (Issue | { level: "error" | "warn"; field: string; message: string })[] {
  const out: Issue[] = [], s = h.setup();
  if (s) out.push(...validateSetup(s));
  for (const e of h.nodeErrors()) out.push({ level: "error", field: `node ${e.node}`, message: `${e.type}: ${e.message}${e.hint ? ` (${e.hint})` : ""}` });
  for (const c of bus.cameras) if (!c.online) out.push({ level: "warn", field: `camera ${c.id}`, message: "offline" }); else if (c.quality < 0.4) out.push({ level: "warn", field: `camera ${c.id}`, message: `poor picture quality (${Math.round(c.quality * 100)}%)` });
  if (bus.cameras.length && bus.board && bus.board.fidelity < 0.5) out.push({ level: "warn", field: "board", message: `the cameras only read the board at ${Math.round(bus.board.fidelity * 100)}% confidence` });
  return out;
}

/** The compact picture of the whole app handed to the model before each message. */
export function snapshot(h: AssistantHost, now = h.now()) {
  const g = h.graph(), game = bus.game, sel = new Set(h.selection());
  const byType: Record<string, number> = {}; for (const n of g.nodes) byType[n.type] = (byType[n.type] ?? 0) + 1;
  const ev = (e: ExperienceEvent) => ({ type: e.type, ago_s: Math.max(0, r2((now - e.t) / 1000)), ...(e.data ? { data: e.data } : {}) });
  return {
    page: h.route().page === "setup" ? `setup (${(h.route() as { step: string | null }).step ?? "?"})` : h.route().page,
    setup: h.setup() ? redact(h.setup()) : "not completed yet",
    problems: problems(h),
    selected_nodes: g.nodes.filter((n) => sel.has(n.id)).map((n) => ({ id: n.id, type: n.type, bypass: !!n.bypass, params: redact(n.params) })),
    workflow: { nodes: g.nodes.length, wires: g.edges.length, groups: g.groups?.length ?? 0, by_type: byType, bypassed: g.nodes.filter((n) => n.bypass).map((n) => n.id) },
    game: game ? { fen: game.fen, turn: game.turn, ply: game.ply, status: game.status, over: game.over, last_move: game.last, recent_moves: game.history.slice(-10), confidence: r2(game.fidelity), last_move_confidence: r2(game.moveFidelity), lifted: game.lifted ?? null } : "no game yet (tracker idle)",
    table: { fen: h.table.fen(), player_seated: h.table.seated() },
    board_reading: bus.board ? { fidelity: r2(bus.board.fidelity), settled: bus.board.settled, hand_over: bus.board.handOver, cameras: bus.board.cams } : null,
    cameras: bus.cameras.map((c) => ({ id: c.id, online: c.online, quality: r2(c.quality), reliability: r2(c.reliability) })),
    director: bus.director ? { phase: bus.director.phase, mode: bus.director.mode, elo: bus.director.elo, seated: !!bus.director.seat } : null,
    scene: bus.scene ? { id: bus.scene.scene, rain: r2(bus.scene.rain), snow: r2(bus.scene.snow), hour: r2(bus.scene.timeOfDay) } : null,
    recent_events: bus.events.slice(-10).map(ev),
    last_commentary: bus.lines.slice(-3).map((l) => `${l.name}: ${l.text}`),
    sound: h.sound(),
    history: { can_undo: h.canUndo(), can_redo: h.canRedo() },
  };
}

/** The standing instructions. The live snapshot follows in a second system message. */
export const SYSTEM = `You are the built-in assistant of Chess Experience, a real-time chess table: webcams (or simulated 3D cameras) read a physical board, a tracker follows the game, and narration, scenes, effects and projection react. You sit in the right-hand panel and can see and operate the app through tools.

How to work:
- Be concrete and brief. Answer in the person's language. Lead with the result; skip preamble and never restate the question.
- You get a LIVE STATE message with every turn: use it. Do not ask for what it already tells you (page, selection, game, cameras, problems). When the person says "this", "it" or "here", resolve it from the selection and the page they are on.
- For anything with more than one step, call think first with a short plan (what you will check, what you will change, in which order). Then act. Do not narrate the plan again in the answer.
- Prefer tools over guessing. If you are unsure of a setting, node, parameter or port, look it up (get_setup, list_node_types, get_node, get_state) before changing anything. Never invent node types, parameter ids or values.
- Make the change yourself when it is clearly asked for. Ask first (ask_user) only when there is a real fork in what they want, with 2 to 4 short options. Never ask for things you can read.
- After changing something, verify it: the tool result carries the new problems list. If something is still wrong, fix it or say plainly what is left.
- Changes to the setup rebuild the workflow and are undoable; tell the person they can undo with Ctrl+Z. Replacing the whole workflow asks for approval automatically.
- You can never see or set API keys. If one is needed, tell the person to enter it in Setup (the wizard) and say which field.
- Cameras are positioned by four board corners (a8, h8, h1, a1) in 480x360 pixels. You cannot see the picture, so tell the person to drag the corner handles themselves (the corner editor has a Negative grid toggle) and use numbers to help only when they give you coordinates.
- Be honest about uncertainty and about what you could not do. Report errors from tools as they are.
- Chess talk: use standard notation and name squares exactly. For the live game, trust the tracker's FEN in the state, not your own guess.
Format: short paragraphs, "-" lists, **bold** for key terms and \`code\` for ids and values. No headings, no tables.`;

export const stateMessage = (h: AssistantHost, news: string[]) =>
  `LIVE STATE (read fresh just now; do not mention it unless relevant):\n${JSON.stringify(snapshot(h))}${news.length ? `\n\nSINCE YOUR LAST MESSAGE:\n${news.map((n) => `- ${n}`).join("\n")}` : ""}`;

export const hasBlockingIssue = (h: AssistantHost) => problems(h).some((p) => p.level === "error") || (!!h.setup() && hasErrors(validateSetup(h.setup()!)));

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
