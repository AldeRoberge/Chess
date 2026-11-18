import { Chess } from "chess.js";

/**
 * chess.com bridge (read-only). chess.com's public API only publishes data: it cannot make moves and it has no live
 * (real-time) games. It does list a player's current *daily* games with the PGN, so we can read the opponent's moves
 * from there and show where to move the pieces on the physical board.
 */
export interface RemoteGame { url: string; pgn: string; fen: string; turn: "white" | "black"; white: string; black: string; color: "w" | "b"; opponent: string; moveCount: number }

const nameOf = (u: unknown) => String(u ?? "").split("/").pop()!.toLowerCase();
export const API = "https://api.chess.com/pub/player/";

/** Pick the game to follow from a `/pub/player/{user}/games` response (`gameUrl` narrows it when several are running). */
export function pickGame(json: any, username: string, gameUrl = ""): RemoteGame | null {
  const me = username.trim().toLowerCase();
  const list: any[] = Array.isArray(json?.games) ? json.games : [];
  const g = list.find((x) => !gameUrl.trim() || String(x.url) === gameUrl.trim()) ?? null;
  if (!g || typeof g.pgn !== "string") return null;
  const white = nameOf(g.white), black = nameOf(g.black), color = white === me ? "w" : "b";
  const c = new Chess(); try { c.loadPgn(g.pgn); } catch { return null; }
  return { url: String(g.url ?? ""), pgn: g.pgn, fen: String(g.fen ?? c.fen()), turn: g.turn === "black" ? "black" : "white", white, black, color, opponent: color === "w" ? black : white, moveCount: c.history().length };
}

export interface RemoteMove { from: string; to: string; uci: string; san: string; by: "you" | "opponent" }
export type RemoteStep = { kind: "move"; move: RemoteMove } | { kind: "synced" } | { kind: "diverged" };

const placement = (fen: string) => fen.split(" ")[0];

/** Given the position on the physical board, the next move to play so it catches up with the chess.com game. */
export function nextRemoteMove(trackerFen: string, game: Pick<RemoteGame, "pgn" | "color">): RemoteStep {
  const src = new Chess(); try { src.loadPgn(game.pgn); } catch { return { kind: "diverged" }; }
  const moves = src.history({ verbose: true });
  const replay = new Chess();
  const target = placement(trackerFen), turn = trackerFen.split(" ")[1];
  for (let i = 0; i <= moves.length; i++) {
    if (placement(replay.fen()) === target && replay.turn() === turn) {
      const m = moves[i];
      if (!m) return { kind: "synced" };
      return { kind: "move", move: { from: m.from, to: m.to, uci: m.from + m.to + (m.promotion ?? ""), san: m.san, by: m.color === game.color ? "you" : "opponent" } };
    }
    if (i < moves.length) replay.move(moves[i].san);
  }
  return { kind: "diverged" };
}
