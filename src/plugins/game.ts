import { calibrationRuntime } from "../vision/calibration";
import { Chess } from "chess.js";
import { bus, pushLog } from "../core/bus";
import type { ExperienceEvent } from "../core/events";
import type { NodeSpec, Plugin } from "../core/types";
import { PositionTracker, type TrackResult } from "../chess/tracker";
import { clearSavedGame, loadGame, newGameGeneration, replay, saveGame } from "../chess/savedGame";
import { createEngine, type Engine } from "../chess/engine";
import type { DirectorOut } from "../experience/director";
import { virtualTable } from "../sim/virtualTable";
import { sqIndex, sqName, type BoardBelief } from "../vision/types";
import { chesscomNode } from "./chesscom";
import { drawBoard, withDetail } from "./shared";
import { boardHover, pct, tone, visualSize } from "./hover";
import type { TipRow } from "../ui/tooltip";

interface TrackState { tracker: PositionTracker; res: TrackResult | null; board: BoardBelief | null; prevPhase: string; gen: number; resumed: ExperienceEvent | null }

/**
 * Starts a game node on the stored game, if there is one, so a reload or a restart carries on where it stopped.
 * The on-screen table follows, so the virtual cameras see the same position the tracker expects.
 * Returns the "resume" event to send on the first tick (it puts the director straight back into the game).
 */
export function resumeSaved(tracker: PositionTracker): ExperienceEvent | null {
  const saved = loadGame();
  if (!saved || !tracker.resume(saved.moves)) return null;
  if (!virtualTable.game.history().length) virtualTable.game = replay(saved.moves)!;
  return { type: "resume", t: 0, data: { ply: saved.moves.length, mode: saved.mode, elo: saved.elo, last: saved.moves.at(-1) } };
}

/** Keeps the stored game up to date after a move, and forgets it once the game is over. */
export function persistGame(res: TrackResult, director: DirectorOut | undefined) {
  if (res.status !== "moved") return;
  if (res.over) { clearSavedGame(); return; }
  saveGame(res.history, { mode: director?.mode, elo: director?.mode === "engine" ? director.elo : undefined });
}
const track: NodeSpec<TrackState> = {
  type: "game.tracker", title: "Move Tracker", category: "Game",
  inputs: [{ id: "board", type: "board" }, { id: "director", type: "any" }, { id: "control", type: "event" }],
  outputs: [{ id: "game", type: "game" }, { id: "events", type: "event" }],
  params: [
    { id: "margin", kind: "number", label: "Legal move evidence margin", min: 0.3, max: 1.2, step: 0.1, value: 0.5 },
    { id: "confirm", kind: "number", label: "Confirm frames", min: 1, max: 8, step: 1, value: 2 },
    { id: "maxCost", kind: "number", label: "Max mismatch cost", min: 0.2, max: 2, step: 0.1, value: 0.8 },
    { id: "minConf", kind: "number", label: "Min square confidence", min: 0, max: 1, step: 0.05, value: 0.5 },
    { id: "promotion", kind: "select", label: "Promote to", options: ["q", "r", "b", "n"], value: "q" },
    { id: "resync", kind: "bool", label: "Reset to start position", value: false, action: true },
  ],
  previewSize: [140, 140],
  init: () => { const tracker = new PositionTracker(); return { tracker, res: null, board: null, prevPhase: "idle", gen: newGameGeneration(), resumed: resumeSaved(tracker) }; },
  process({ board, director, control }, { params, state, setFidelity, span, now }) {
    if (calibrationRuntime.active) return { game: state.res, events: [] };
    const t = state.tracker;
    t.cfg.margin = Number(params.margin ?? 0.5);
    t.cfg.confirm = Number(params.confirm); t.cfg.maxCost = Number(params.maxCost); t.cfg.minConf = Number(params.minConf); t.cfg.promotion = params.promotion as "q";
    const phase = (director as DirectorOut | undefined)?.phase ?? "idle";
    const restart = ((control as ExperienceEvent[] | undefined) ?? []).some((e) => e.type === "scenario-start");
    const asked = state.gen !== newGameGeneration();
    if (restart || asked || params.resync || (phase === "idle" && state.prevPhase !== "idle")) { t.reset(); virtualTable.reset(); clearSavedGame(); params.resync = false; state.resumed = null; state.gen = newGameGeneration(); }
    state.prevPhase = phase;
    // a stored game was picked up: say so once, so the director goes straight back into the game
    const resumed = state.resumed ? [{ ...state.resumed, t: now }] : [];
    if (resumed.length) pushLog(bus.events, resumed);
    state.resumed = null;
    state.board = board ?? null;
    if (!board) { if (resumed.length) { state.res = t.snapshot(); bus.game = state.res; } return { game: state.res, events: resumed }; }
    state.res = span("track moves (observe)", () => t.observe(board));
    if (resumed.length) state.res = { ...state.res, events: [...resumed, ...state.res.events] };
    bus.game = state.res;
    persistGame(state.res, director as DirectorOut | undefined);
    if (state.res.events.some((e) => e.type === "new-game")) { virtualTable.reset(); clearSavedGame(); }
    if ((state.res.status === "moved" || state.res.events.some((e) => e.type === "new-game")) && state.res.events.length) pushLog(bus.events, state.res.events.filter((e) => e.type !== "resume")); // the log reads the bus; a held piece must not reprint "lifted" every tick
    setFidelity(Math.min(state.res.fidelity, state.res.status === "illegal" ? 0.2 : 1));
    return { game: state.res, events: state.res.events };
  },
  hover(p, w, h, s) {
    const v = visualSize(w, h, [140, 140]), r = s.res;
    if (p.x > v.w || p.y > v.h) return null;
    if (p.y >= v.h - 20) {
      if (!r) return { title: "Move Tracker", tag: "no position yet", body: "Waiting for a board reading." };
      return {
        title: `ply ${r.ply}`, tag: "Move Tracker", color: r.status === "illegal" ? "#ff5a6e" : "#35e0b4",
        body: r.last ? `Last move ${r.last.san}. ${r.over ? "The game is over." : r.turn === "w" ? "White to move." : "Black to move."}` : "No move recorded yet.",
        rows: [
          { label: "Status", value: r.status, tone: r.status === "illegal" ? "bad" : r.status === "synced" ? "ok" : "warn" },
          { label: "Fidelity", value: pct(r.fidelity), bar: r.fidelity, tone: tone(r.fidelity) },
          { label: "Last move certainty", value: pct(r.moveFidelity), bar: r.moveFidelity, tone: tone(r.moveFidelity) },
          { label: "Squares disagreeing", value: String(r.diff.length), tone: r.diff.length ? "warn" : "ok" },
          ...(r.lifted ? [{ label: "Piece in hand", value: r.lifted, tone: "warn" as const }] : []),
          { label: "History", value: r.history.slice(-6).join(" ") || "—" },
        ],
      };
    }
    const legal = (sq: number): { san: string; to: string }[] => { try { return r ? (new Chess(r.fen).moves({ square: sqName(sq) as any, verbose: true }) as any[]) : []; } catch { return []; } };
    return boardHover(p, v.w, v.h - 20, s.board, {
      title: "Move Tracker", fen: r?.fen, flagged: r?.diff, flagLabel: "Mismatch vs. expected",
      also: (sq) => legal(sq).map((m) => sqIndex(m.to)),
      extra: (sq): TipRow[] => {
        if (!r) return [];
        const out: TipRow[] = [], ms = legal(sq);
        if (ms.length) out.push({ label: "Legal moves", value: `${ms.length}: ${ms.slice(0, 6).map((m) => m.san).join(" ")}${ms.length > 6 ? " …" : ""}` });
        if (r.last && (r.last.from === sqName(sq) || r.last.to === sqName(sq))) out.push({ label: "Last move", value: `${r.last.from} → ${r.last.to}` });
        return out;
      },
      body: (sq) => (r ? `Green squares are where the piece on ${sqName(sq)} can legally go. Red-outlined squares are where the cameras disagree with the tracked game.` : undefined),
    });
  },
  preview(ctx, w, h, s) {
    withDetail(ctx, w, h, [140, 140], (pw, ph) => {
      drawBoard(ctx, pw, ph - 20, s.board, { diff: s.res?.diff, fen: s.res?.fen });
      ctx.fillStyle = "#04101c"; ctx.fillRect(0, ph - 20, pw, 20);
      ctx.fillStyle = s.res?.status === "illegal" ? "#ff5a6e" : "#b9c6e4"; ctx.font = `500 12px "Chakra Petch",system-ui,sans-serif`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      ctx.fillText(`${s.res?.status ?? "—"}  ${s.res?.history.slice(-1)[0] ?? ""}  ply ${s.res?.ply ?? 0}`, 4, ph - 5);
    }, () => {
      const r = s.res, hist = r?.history ?? [], pairs: string[] = [];
      for (let i = 0; i < hist.length; i += 2) pairs.push(`${i / 2 + 1}. ${hist[i]}${hist[i + 1] ? " " + hist[i + 1] : ""}`);
      return [["status", r?.status ?? "—", r?.status === "illegal" ? "#ff5a6e" : undefined], ["ply", String(r?.ply ?? 0)], ["fidelity", r ? r.fidelity.toFixed(2) : "—"], ["over", r?.over ? "yes" : "no"],
        ["changed squares", String(r?.diff?.length ?? 0)], ["fen", r?.fen ?? "—"], ...pairs.slice(-12).map((p, i): [string, string] => [i === 0 ? "moves" : "", p])];
    });
  },
};

interface EngState { engine: Engine | null; loading: boolean; thinkingFen: string; hintFen: string; out: ExperienceEvent[]; info: string; now: number }
const engine: NodeSpec<EngState> = {
  type: "game.engine", title: "Stockfish Opponent", category: "Game",
  inputs: [{ id: "game", type: "game" }, { id: "director", type: "any" }],
  outputs: [{ id: "events", type: "event" }],
  params: [
    { id: "color", kind: "select", label: "Engine plays", options: ["b", "w"], labels: ["Black", "White"], icons: ["bq", "wq"], value: "b" },
    { id: "virtualHand", kind: "bool", label: "Virtual hand", value: true },
  ],
  init: () => ({ engine: null, loading: false, thinkingFen: "", hintFen: "", out: [], info: "", now: 0 }),
  process({ game, director }, { params, state, now }) {
    if (calibrationRuntime.active) { state.thinkingFen = ""; return { events: [] }; }
    state.now = now;
    const g = game as TrackResult | undefined, d = director as DirectorOut | undefined;
    const out: ExperienceEvent[] = [];
    if (!g || !d || d.mode !== "engine" || d.phase !== "game") { bus.engineHint = null; bus.botColor = null; return { events: [] }; }
    bus.botColor = params.color === "w" ? "w" : "b";
    if (!state.engine && !state.loading) { state.loading = true; void createEngine().then((e) => { state.engine = e; state.loading = false; state.info = e.constructor.name; }); }
    if (state.hintFen && state.hintFen !== g.fen) { bus.engineHint = null; state.hintFen = ""; }
    if (state.engine && (g.status === "synced" || g.status === "moved") && !g.over && g.turn === params.color && state.thinkingFen !== g.fen) {
      state.thinkingFen = g.fen;
      state.engine.setElo(d.elo);
      const fen = g.fen;
      void state.engine.bestMove(fen).then((uci) => {
        if (calibrationRuntime.active) { state.thinkingFen = ""; return; }
        const c = new Chess(fen);
        const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
        state.hintFen = fen;
        bus.engineHint = { from: m.from, to: m.to };
        const ev: ExperienceEvent = { type: "engine-move", t: state.now, data: { uci, san: m.san, from: m.from, to: m.to } };
        state.out.push(ev);
        if (params.virtualHand) virtualTable.play(uci, state.now);
      });
    }
    out.push(...state.out.splice(0));
    pushLog(bus.events, out);
    return { events: out };
  },
  dispose(s) { s.engine?.dispose(); },
};

export const gamePlugin: Plugin = { id: "game", name: "Game", register: (r) => { r.register(track); r.register(engine); r.register(chesscomNode); } };
