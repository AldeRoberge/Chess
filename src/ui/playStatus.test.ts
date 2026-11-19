import { describe, expect, it } from "vitest";
import { playStatus, type PlayView } from "./playStatus";

const view = (over: Partial<PlayView> = {}): PlayView => ({
  cameras: 1,
  board: { settled: true, handOver: false, cams: 1 },
  startPosition: true,
  game: { status: "synced", ply: 0, turn: "w", over: false, history: [] },
  phase: "idle",
  botColor: null,
  hint: null,
  ...over,
});

describe("playStatus", () => {
  it("waits for a camera, then for a still picture, then says the first move will start the game", () => {
    expect(playStatus(view({ cameras: 0, board: null })).title).toBe("Getting ready");
    expect(playStatus(view({ board: { settled: false, handOver: false, cams: 1 } })).detail).toMatch(/hands off/);
    expect(playStatus(view()).title).toBe("Ready");
    expect(playStatus(view()).detail).toMatch(/first move/);
    expect(playStatus(view({ game: { status: "moved", ply: 1, turn: "b", over: false, history: ["e4"] } })).title).toBe("Move seen");
  });
  it("says when a piece is in hand, a move is being checked, or the position is illegal", () => {
    expect(playStatus(view({ game: { status: "lifted", ply: 0, turn: "w", over: false, history: [], lifted: "e2" } })).title).toBe("Piece in hand");
    expect(playStatus(view({ game: { status: "pending", ply: 0, turn: "w", over: false, history: [] } })).title).toBe("Ready");
    expect(playStatus(view({ game: { status: "pending", ply: 1, turn: "b", over: false, history: ["e4"] } })).title).toBe("Watching your move");
    expect(playStatus(view({ game: { status: "illegal", ply: 0, turn: "w", over: false, history: [] } })).title).toBe("Set up a new game");
    expect(playStatus(view({ game: { status: "unclear", ply: 2, turn: "w", over: false, history: ["e4", "e5"] } })).title).toBe("Can't read the board");
    expect(playStatus(view({ game: { status: "illegal", ply: 2, turn: "w", over: false, history: ["e4", "e5"] } })).tone).toBe("bad");
  });
  it("once the game is open, names whose turn it is and the move Stockfish wants played", () => {
    const playing = view({ phase: "game", botColor: "b" });
    expect(playStatus(playing).title).toBe("Your move");
    const after = view({ phase: "game", botColor: "b", game: { status: "synced", ply: 1, turn: "b", over: false, history: ["e4"] } });
    expect(playStatus(after).title).toBe("Stockfish is thinking");
    expect(playStatus({ ...after, hint: { from: "e7", to: "e5" } }).detail).toBe("Move the piece from e7 to e5 on the board.");
    expect(playStatus(view({ phase: "game", game: { status: "synced", ply: 2, turn: "w", over: true, history: ["e4", "e5"] } })).title).toBe("Game over");
  });
});
