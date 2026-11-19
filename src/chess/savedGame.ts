import { Chess } from "chess.js";

/**
 * The game in progress, kept in localStorage so a reload or a restart of the app picks it up where it stopped.
 * Only the moves are stored: the position is rebuilt by replaying them, so a stored game is always legal.
 */
export interface SavedGame {
  moves: string[];
  /** who the player was facing, so the same opponent comes back */
  mode?: "engine" | "human" | null;
  elo?: number;
  at: number;
}

export const SAVED_GAME_KEY = "chess-xp.ongoing-game";

const store = (): Storage | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };

/** Replays the moves from the start. Null when one of them is not legal. */
export function replay(moves: readonly string[]): Chess | null {
  const g = new Chess();
  for (const m of moves) { try { g.move(m); } catch { return null; } }
  return g;
}

/** Remembers the game. An empty or finished game is forgotten instead: there is nothing to resume. */
export function saveGame(moves: readonly string[], who: { mode?: SavedGame["mode"]; elo?: number } = {}, now = Date.now()) {
  const s = store();
  if (!s) return;
  const g = moves.length ? replay(moves) : null;
  if (!g || g.isGameOver()) { clearSavedGame(); return; }
  const data: SavedGame = { moves: [...moves], at: now, ...(who.mode ? { mode: who.mode } : {}), ...(who.elo ? { elo: who.elo } : {}) };
  try { s.setItem(SAVED_GAME_KEY, JSON.stringify(data)); } catch { /* storage full or blocked: the game just won't survive a restart */ }
}

/** The game to resume, or null when there is none (or what is stored is not a legal, unfinished game). */
export function loadGame(): SavedGame | null {
  const raw = store()?.getItem(SAVED_GAME_KEY);
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Partial<SavedGame>;
    if (!Array.isArray(d.moves) || !d.moves.length || !d.moves.every((m) => typeof m === "string")) return null;
    const g = replay(d.moves);
    if (!g || g.isGameOver()) return null;
    return { moves: d.moves, at: Number(d.at) || 0, mode: d.mode === "engine" || d.mode === "human" ? d.mode : null, elo: Number(d.elo) || undefined };
  } catch { return null; }
}

export function clearSavedGame() {
  try { store()?.removeItem(SAVED_GAME_KEY); } catch { /* nothing to clear */ }
}

let generation = 0;
/** Bumped by every "New game" request; the game nodes reset when it changes. */
export const newGameGeneration = () => generation;
/** Forgets the stored game and asks every game node to start again from the starting position. */
export function requestNewGame() { generation++; clearSavedGame(); }
