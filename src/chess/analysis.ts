import { Chess } from "chess.js";

export interface PositionAnalysis {
  fen: string;
  engine: "Stockfish" | "rules";
  turn: "w" | "b";
  terminal: string | null;
  /** Scores are normalized to White, irrespective of who is to move. */
  score: { unit: "centipawns" | "mate"; white: number; bound: "exact" | "lower" | "upper" } | null;
  depth: number | null;
  best_move: { uci: string; san: string } | null;
  principal_variation: { uci: string; san: string }[];
  elapsed_ms: number;
}
export interface AnalysisOptions {
  movetime_ms?: number;
  signal?: AbortSignal;
  worker?: () => Worker;
  timeout_ms?: number;
}
export function terminalPosition(game: Chess): string | null {
  if (game.isCheckmate()) return `${game.turn() === "w" ? "Black" : "White"} won by checkmate`;
  if (game.isStalemate()) return "Draw by stalemate";
  if (game.isInsufficientMaterial()) return "Draw by insufficient material";
  if (game.isThreefoldRepetition()) return "Draw by threefold repetition";
  if (game.isDrawByFiftyMoves()) return "Draw by the fifty-move rule";
  return null;
}

/** A separate, bounded worker: analysis never changes the opponent's Elo, pending search or position. */
export async function analyzePosition(fen: string, options: AnalysisOptions = {}): Promise<PositionAnalysis> {
  const game = new Chess(fen), start = performance.now(), terminal = terminalPosition(game);
  const base: PositionAnalysis = { fen: game.fen(), engine: terminal ? "rules" : "Stockfish", turn: game.turn(), terminal, score: null, depth: null, best_move: null, principal_variation: [], elapsed_ms: 0 };
  if (options.signal?.aborted) throw new DOMException("Stopped", "AbortError");
  if (terminal) return base;
  const movetime = Math.min(5000, Math.max(100, Math.round(Number(options.movetime_ms) || 1000)));
  return new Promise((resolve, reject) => {
    let worker: Worker | undefined, stage: "uci" | "ready" | "search" = "uci", finished = false;
    const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); worker?.terminate(); };
    const fail = (e: Error) => { if (finished) return; finished = true; cleanup(); reject(e); };
    const abort = () => fail(new DOMException("Stopped", "AbortError"));
    const timer = setTimeout(() => fail(new Error("Stockfish analysis timed out. Check that the Stockfish worker and WASM assets are installed (npm run setup:stockfish).")), options.timeout_ms ?? movetime + 15000);
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      worker = options.worker?.() ?? new Worker(`${import.meta.env.BASE_URL}stockfish/stockfish-19-lite-single.js`);
      worker.onerror = () => fail(new Error("Stockfish could not load. Install its assets with npm run setup:stockfish. No engine evaluation is available."));
      worker.onmessageerror = () => fail(new Error("Stockfish sent an unreadable response."));
      worker.onmessage = e => {
        if (finished) return;
        try { for (const raw of String(e.data).split(/\r?\n/)) {
          const line = raw.trim();
          if (stage === "uci" && line === "uciok") { stage = "ready"; worker!.postMessage("setoption name Threads value 1"); worker!.postMessage("setoption name Hash value 16"); worker!.postMessage("setoption name UCI_LimitStrength value false"); worker!.postMessage("setoption name Skill Level value 20"); worker!.postMessage("setoption name MultiPV value 1"); worker!.postMessage("isready"); }
          else if (stage === "ready" && line === "readyok") { stage = "search"; worker!.postMessage(`position fen ${game.fen()}`); worker!.postMessage(`go movetime ${movetime}`); }
          else if (stage === "search" && line.startsWith("info ")) {
            if (/\bmultipv\s+(?!1\b)\d+/.test(line)) continue;
            const score = /\bscore (cp|mate) (-?\d+)(?: (lowerbound|upperbound))?/.exec(line);
            if (!score) continue;
            const sign = game.turn() === "w" ? 1 : -1;
            const bound = score[3] === "lowerbound" ? "lower" : score[3] === "upperbound" ? "upper" : "exact";
            base.score = { unit: score[1] === "cp" ? "centipawns" : "mate", white: sign * Number(score[2]), bound: sign < 0 && bound !== "exact" ? bound === "lower" ? "upper" : "lower" : bound };
            base.depth = Number(/\bdepth (\d+)/.exec(line)?.[1]) || null;
            const pv = /\bpv (.+)$/.exec(line)?.[1]?.trim().split(/\s+/).slice(0, 12) ?? [];
            const replay = new Chess(fen); base.principal_variation = [];
            for (const uci of pv) { try { const move = replay.move(uci); base.principal_variation.push({ uci, san: move.san }); } catch { break; } }
          } else if (stage === "search" && line.startsWith("bestmove ")) {
            const uci = line.split(/\s+/)[1];
            if (!uci || uci === "(none)" || uci === "0000") throw new Error("Stockfish returned no legal move for a nonterminal position.");
            const move = new Chess(fen).move(uci); base.best_move = { uci, san: move.san };
            base.elapsed_ms = Math.round(performance.now() - start);
            finished = true; cleanup(); resolve(base); break;
          }
        } } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
      };
      worker.postMessage("uci");
    } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
  });
}
