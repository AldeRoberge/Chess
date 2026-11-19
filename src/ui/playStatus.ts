/** What the table panel says about whether a real game can start. */
export interface PlayNote {
  tone: "wait" | "ready" | "go" | "bad";
  title: string;
  detail: string;
}

export interface PlayView {
  cameras: number;
  board: { settled: boolean; handOver: boolean; cams: number } | null;
  /** The cameras see the pieces in the starting position. */
  startPosition: boolean;
  game: { status: string; ply: number; turn: "w" | "b"; over: boolean; history: string[]; lifted?: string } | null;
  phase: string | null;
  botColor: "w" | "b" | null;
  hint: { from: string; to: string } | null;
}

const note = (tone: PlayNote["tone"], title: string, detail: string): PlayNote => ({ tone, title, detail });

/** Plain status for the right-hand table panel: not ready, ready for the first move, or whose turn it is. */
export function playStatus(v: PlayView): PlayNote {
  const g = v.game;
  const seeing = (v.board?.cams ?? 0) > 0 || v.cameras > 0;
  const last = g?.history.at(-1);
  if (g?.over) return note("ready", "Game over", last ? `Last move ${last}.` : "The game has ended.");
  if (g?.status === "lifted" || g?.lifted) return note("go", "Piece in hand", "Put it on its square, then move your hand away.");
  // Pending describes the current camera reading; it does not undo an accepted move.
  if (g?.status === "pending" && g.ply > 0) {
    const reason = v.board?.handOver
      ? "Movement detected over the board. Waiting for a stable camera reading."
      : "The camera reading does not yet match the tracked position. Checking again.";
    return note("go", "Checking the board", `${last ?? "Your last move"} has counted. ${reason}`);
  }
  if (g?.status === "unclear") return note("wait", "Can't read the board", "The camera disagrees with the game on too many squares to be a move. Check the light and the board corners, or set up the start position and press Learn now.");
  if (g?.status === "illegal" && g.ply === 0) return note("wait", "Set up a new game", "Put every piece back on its starting square.");
  if (g?.status === "illegal") return note("bad", "Not a legal move", "Put the piece back, or finish a legal move. To start over, set up the starting position.");

  const playing = (v.phase ?? "idle") === "game";
  if (!playing) {
    if (g && g.ply > 0) return note("go", "Move seen", `${last ?? "Your move"} is in. Starting the game.`);
    if (!seeing) return note("wait", "Getting ready", "Waiting for the cameras to see the board.");
    if (!v.board || !v.board.settled || v.board.handOver) return note("wait", "Getting ready", v.board?.handOver ? "Movement detected over the board. Waiting for a stable camera reading." : "Waiting for a stable camera reading.");
    if ((g?.ply ?? 0) === 0 && g?.status !== "synced" && !v.startPosition) return note("wait", "Getting ready", "Still reading the starting position.");
    return note("ready", "Ready", "Make your first move on the board. The game starts when you do.");
  }

  const yourTurn = !v.botColor || g?.turn !== v.botColor;
  if (!yourTurn) {
    if (v.hint) return note("go", "Stockfish played", `Move the piece from ${v.hint.from} to ${v.hint.to} on the board.`);
    return note("go", "Stockfish is thinking", "Its move will show here. Play that move on the board.");
  }
  if ((g?.ply ?? 0) === 0) return note("ready", "Your move", "Play your first move on the board.");
  return note("ready", "Your move", last ? `Last move ${last}. Play the next one on the board.` : "Play your move on the board.");
}
