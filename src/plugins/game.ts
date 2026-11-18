import { Chess } from "chess.js";
import { bus, pushLog } from "../core/bus";
import type { ExperienceEvent } from "../core/events";
import type { NodeSpec, Plugin } from "../core/types";
import { PositionTracker, type TrackResult } from "../chess/tracker";
import { createEngine, type Engine } from "../chess/engine";
import type { DirectorOut } from "../experience/director";
import { virtualTable } from "../sim/virtualTable";
import type { BoardBelief } from "../vision/types";
import { chesscomNode } from "./chesscom";
import { drawBoard, withDetail } from "./shared";

interface TrackState { tracker: PositionTracker; res: TrackResult | null; board: BoardBelief | null; prevPhase: string }
const track: NodeSpec<TrackState> = {
  type: "game.tracker", title: "Move Tracker", category: "Game",
  inputs: [{ id: "board", type: "board" }, { id: "director", type: "any" }, { id: "control", type: "event" }],
  outputs: [{ id: "game", type: "game" }, { id: "events", type: "event" }],
  params: [
    { id: "confirm", kind: "number", label: "Confirm frames", min: 1, max: 8, step: 1, value: 2 },
    { id: "maxCost", kind: "number", label: "Max mismatch cost", min: 0.2, max: 2, step: 0.1, value: 0.8 },
    { id: "minConf", kind: "number", label: "Min square confidence", min: 0, max: 1, step: 0.05, value: 0.5 },
    { id: "promotion", kind: "select", label: "Promote to", options: ["q", "r", "b", "n"], value: "q" },
    { id: "resync", kind: "bool", label: "Reset to start position", value: false, action: true },
  ],
  previewSize: [140, 140],
  init: () => ({ tracker: new PositionTracker(), res: null, board: null, prevPhase: "idle" }),
  process({ board, director, control }, { params, state, setFidelity, span }) {
    const t = state.tracker;
    t.cfg.confirm = Number(params.confirm); t.cfg.maxCost = Number(params.maxCost); t.cfg.minConf = Number(params.minConf); t.cfg.promotion = params.promotion as "q";
    const phase = (director as DirectorOut | undefined)?.phase ?? "idle";
    const restart = ((control as ExperienceEvent[] | undefined) ?? []).some((e) => e.type === "scenario-start");
    if (restart || params.resync || (phase === "idle" && state.prevPhase !== "idle")) { t.reset(); virtualTable.reset(); params.resync = false; }
    state.prevPhase = phase;
    state.board = board ?? null;
    if (!board) return { game: state.res, events: [] };
    state.res = span("track moves (observe)", () => t.observe(board));
    bus.game = state.res;
    setFidelity(Math.min(state.res.fidelity, state.res.status === "illegal" ? 0.2 : 1));
    return { game: state.res, events: state.res.events };
  },
  preview(ctx, w, h, s) {
    withDetail(ctx, w, h, [140, 140], (pw, ph) => {
      drawBoard(ctx, pw, ph - 20, s.board, { diff: s.res?.diff, fen: s.res?.fen });
      ctx.fillStyle = "#04101c"; ctx.fillRect(0, ph - 20, pw, 20);
      ctx.fillStyle = s.res?.status === "illegal" ? "#ff5a6e" : "#b9c6e4"; ctx.font = `500 12px "IBM Plex Mono",ui-monospace,monospace`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
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
    state.now = now;
    const g = game as TrackResult | undefined, d = director as DirectorOut | undefined;
    const out: ExperienceEvent[] = [];
    if (!g || !d || d.mode !== "engine" || d.phase !== "game") { bus.engineHint = null; return { events: [] }; }
    if (!state.engine && !state.loading) { state.loading = true; void createEngine().then((e) => { state.engine = e; state.loading = false; state.info = e.constructor.name; }); }
    if (state.hintFen && state.hintFen !== g.fen) { bus.engineHint = null; state.hintFen = ""; }
    if (state.engine && g.status === "synced" && !g.over && g.turn === params.color && state.thinkingFen !== g.fen) {
      state.thinkingFen = g.fen;
      state.engine.setElo(d.elo);
      const fen = g.fen;
      void state.engine.bestMove(fen).then((uci) => {
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
