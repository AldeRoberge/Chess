import { Chess } from "chess.js";
import { bus } from "../../core/bus";
import { analyzePosition, terminalPosition } from "../../chess/analysis";
import type { AssistantHost } from "../host";
import { obj, str, type ToolGroup } from "./shared";

export function gameContext(h: AssistantHost) {
  const tracked = bus.game;
  if (!tracked) return { available: false, note: "No tracked game yet. The virtual table is separate; request source=virtual explicitly to inspect it." };
  let game: Chess; try { game = new Chess(tracked.fen); } catch { return { available: false, note: "The tracker has not published a valid FEN yet." }; }
  const material = { white: 0, black: 0 }, values: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  for (const p of game.board().flat()) if (p) material[p.color === "w" ? "white" : "black"] += values[p.type];
  return {
    available: true, source: "tracker", fen: tracked.fen, turn: game.turn(), side_to_move: game.turn() === "w" ? "White" : "Black",
    last_player: tracked.last ? { color: tracked.last.color, side: tracked.last.color === "w" ? "White" : "Black", move: tracked.last.san, identity: null,
      role: bus.botColor ? tracked.last.color === bus.botColor ? "engine opponent" : "human side" : "unknown" } : null,
    identity_note: "No verified player names are recorded by the tracker. Do not infer a person's name from a color, commentator name or seat.",
    ply: tracked.ply, last_move: tracked.last, status: tracked.status, over: tracked.over, result: terminalPosition(game),
    in_check: game.inCheck(), legal_moves: game.moves(), material: { ...material, white_minus_black: material.white - material.black, note: "Material count only, not an engine evaluation." },
    confidence: tracked.fidelity, last_move_confidence: tracked.moveFidelity, clock: bus.clock, bot_color: bus.botColor, reconcile: bus.reconcile,
  };
}

export const chessTools: ToolGroup = h => [
  { name: "get_game", risk: "read", label: { doing: "Reading the game", done: "Read the game" }, description: "Live tracked position, whose turn, who moved last (color, SAN and known role), result, checks, legal moves, material and clocks. Player names are not recorded; never invent them. Material is not a positional evaluation.", parameters: obj({}), run: () => gameContext(h) },
  { name: "get_move_history", risk: "read", description: "Accepted tracker moves in chronological order, including absolute ply and side. Paginated (newest 40 by default). The last move contains the reliable mover color. No named-player identity is inferred.",
    parameters: obj({ offset: { type: "number", description: "zero-based history offset, default latest page" }, limit: { type: "number", description: "default 40, max 100" } }),
    run: a => {
      if (!bus.game) return { available: false, moves: [] };
      const g = bus.game, limit = Math.max(1, Math.min(100, Math.floor(Number(a.limit) || 40))), offset = a.offset === undefined ? Math.max(0, g.history.length - limit) : Math.max(0, Math.floor(Number(a.offset) || 0));
      return { total: g.history.length, offset, next_offset: offset + limit < g.history.length ? offset + limit : null, last_player: gameContext(h).last_player ?? null,
        moves: g.history.slice(offset, offset + limit).map((san, i) => {
          const distance = g.history.length - 1 - (offset + i), lastColor = g.last?.color ?? (g.turn === "w" ? "b" : "w");
          return { ply: g.ply - distance, color: distance % 2 ? lastColor === "w" ? "b" : "w" : lastColor, san };
        }) };
    } },
  { name: "analyze_game", risk: "read", label: { doing: "Analyzing with Stockfish", done: "Analyzed the position" },
    description: "Evaluate who is winning and find the best move / principal variation using a separate full-strength Stockfish worker. Default is the tracker's live FEN; source=virtual inspects the separate simulated table; source=fen requires a FEN. Does not play a move. Scores are White's perspective, centipawns or mate distance. Positive favors White, negative Black. Report engine errors honestly; never call material a Stockfish score. Snapshot includes position-changed flag after search.",
    parameters: obj({ source: str("default tracked", { enum: ["tracked", "virtual", "fen"] }), fen: str("required only for source=fen"), movetime_ms: { type: "number", description: "100–5000ms, default 1000" } }),
    run: async (a, ctx) => {
      const source = a.source ?? "tracked";
      if (!["tracked", "virtual", "fen"].includes(source)) throw new Error("source must be tracked, virtual or fen.");
      if (source === "tracked" && !bus.game) throw new Error("No tracked game yet. Do not substitute the virtual table silently.");
      const fen = source === "tracked" ? bus.game!.fen : source === "virtual" ? h.table.fen() : a.fen;
      if (typeof fen !== "string" || !fen.trim()) throw new Error("A valid FEN is required.");
      const result = await analyzePosition(fen, { signal: ctx.signal, movetime_ms: a.movetime_ms });
      const current = source === "tracked" ? bus.game?.fen : source === "virtual" ? h.table.fen() : fen;
      return { ...result, source, position_changed: current !== fen, current_fen: current ?? null,
        confidence: source === "tracked" ? bus.game?.fidelity : null,
        score_perspective: "White; 100 centipawns = one pawn. This is a search estimate, not a guaranteed result.",
        history_note: "FEN-only analysis does not reconstruct repetition history.", };
    } },
];
