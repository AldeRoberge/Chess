import { bus } from "../core/bus";
import type { ExperienceEvent } from "../core/events";
import { validateSetup, type Issue } from "../setup/config";
import { redact, type AssistantHost } from "./host";
import { APP_FEATURES } from "./uiContext";

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
  const g = h.graph(), game = bus.game, sel = new Set(h.selection()), route = h.route();
  const byType: Record<string, number> = {}; for (const n of g.nodes) byType[n.type] = (byType[n.type] ?? 0) + 1;
  const ev = (e: ExperienceEvent) => ({ type: e.type, ago_s: Math.max(0, r2((now - e.t) / 1000)), ...(e.data ? { data: e.data } : {}) });
  const ui = h.ui?.();
  return {
    page: route.page === "settings" ? `settings (${route.step ?? "?"})` : route.page,
    setup: h.setup() ? redact(h.setup()) : "not completed yet",
    problems: problems(h),
    selected_nodes: g.nodes.filter((n) => sel.has(n.id)).map((n) => ({ id: n.id, type: n.type, bypass: !!n.bypass, params: redact(n.params) })),
    workflow: { nodes: g.nodes.length, wires: g.edges.length, groups: g.groups?.length ?? 0, by_type: byType, bypassed: g.nodes.filter((n) => n.bypass).map((n) => n.id),
      node_index: g.nodes.slice(0, 80).map(n => ({ id: n.id, type: n.type, title: h.registry.get(n.type)?.title })), index_truncated: g.nodes.length > 80, inspect: "get_workflow for ports, parameters, connections and more nodes" },
    game: game ? { fen: game.fen, turn: game.turn, ply: game.ply, status: game.status, over: game.over, last_move: game.last,
      last_player: game.last ? { color: game.last.color, name: null, role: bus.botColor ? game.last.color === bus.botColor ? "engine opponent" : "human side" : "unknown" } : null,
      recent_moves: game.history.slice(-10), confidence: r2(game.fidelity), last_move_confidence: r2(game.moveFidelity), lifted: game.lifted ?? null, analysis: "Use analyze_game for who is winning / best move; no cached engine score is assumed." } : "no game yet (tracker idle)",
    table: { fen: h.table.fen(), player_seated: h.table.seated() },
    board_reading: bus.board ? { fidelity: r2(bus.board.fidelity), settled: bus.board.settled, hand_over: bus.board.handOver, cameras: bus.board.cams } : null,
    cameras: bus.cameras.map((c) => ({ id: c.id, online: c.online, quality: r2(c.quality), reliability: r2(c.reliability) })),
    director: bus.director ? { phase: bus.director.phase, mode: bus.director.mode, elo: bus.director.elo, seated: !!bus.director.seat } : null,
    scene: bus.scene ? { id: bus.scene.scene, rain: r2(bus.scene.rain), snow: r2(bus.scene.snow), hour: r2(bus.scene.timeOfDay) } : null,
    recent_events: bus.events.slice(-10).map(ev),
    last_commentary: bus.lines.slice(-3).map((l) => `${l.name}: ${l.text}`),
    sound: h.sound(),
    clock: bus.clock,
    opponent: { bot_color: bus.botColor, engine_hint: bus.engineHint, reconcile: bus.reconcile, scenario_paused: bus.scenarioPaused },
    ui: ui ? { mode: ui.mode, focus: ui.focus, dialogs: ui.dialogs, visible_controls: ui.controls.filter(c => c.visible).slice(0, 24).map(c => ({ label: c.label, section: c.section, disabled: c.disabled, value: c.value })), text: ui.text.slice(0, 8), inspect: "get_ui searches all rendered controls, descriptions and shortcuts" } : null,
    app_map: APP_FEATURES.map(f => ({ path: f.path, tools: f.tools })),
    history: { can_undo: h.canUndo(), can_redo: h.canRedo() },
  };
}
