import { Chess } from "chess.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bus } from "../core/bus";
import { node, tick } from "../test/helpers";

const trackerAt = (...m: string[]) => { const c = new Chess(); m.forEach((x) => c.move(x)); return { status: "synced", fen: c.fen(), over: false } as any; };
const pgnOf = (...m: string[]) => { const c = new Chess(); m.forEach((x) => c.move(x)); return c.pgn(); };
const dir = { phase: "game", mode: "2p" } as any;

beforeEach(() => { bus.engineHint = null; bus.events.length = 0; });
afterEach(() => { vi.unstubAllGlobals(); });

describe("game.chesscom node", () => {
  it("shows the opponent's pasted-PGN move as a hint, then clears it once the board catches up", () => {
    const n = node("game.chesscom", { pgn: pgnOf("e4"), color: "b" });
    const out = n.run({ game: trackerAt(), director: dir })!;
    expect(bus.engineHint).toEqual({ from: "e2", to: "e4" }); expect(out.events[0].data).toMatchObject({ san: "e4", by: "opponent", source: "chess.com" });
    n.run({ game: trackerAt("e4"), director: dir }); expect(bus.engineHint).toBeNull();
    n.paint(220, 250);
  });
  it("stays quiet in Stockfish mode, with a bad PGN, or off the game phase", () => {
    const n = node("game.chesscom", { pgn: pgnOf("e4"), color: "b" });
    n.run({ game: trackerAt(), director: { ...dir, mode: "engine" } }); expect(bus.engineHint).toBeNull();
    n.run({ game: trackerAt(), director: { phase: "menu" } }); expect(bus.engineHint).toBeNull();
    const bad = node("game.chesscom", { pgn: "not a game" }); bad.run({ game: trackerAt(), director: dir }); expect(bus.engineHint).toBeNull(); bad.paint();
  });
  it("polls the chess.com API for the user's daily game and reports failures instead of throwing", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ games: [{ url: "u", pgn: pgnOf("e4"), white: "https://api.chess.com/pub/player/Rival", black: "https://api.chess.com/pub/player/Me", turn: "black" }] }) })
      .mockResolvedValueOnce({ ok: false, status: 403 });
    vi.stubGlobal("fetch", fetchMock);
    const n = node("game.chesscom", { username: "Me", poll: 3 });
    n.run({ game: trackerAt(), director: dir }, 5000); await tick(); await tick();
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.chess.com/pub/player/Me/games");
    n.run({ game: trackerAt(), director: dir }, 5100); expect(fetchMock).toHaveBeenCalledTimes(1); // not before the poll interval
    n.run({ game: trackerAt(), director: dir }, 9000); await tick(); await tick();
    expect((n.state as any).tone).toBe("err"); expect((n.state as any).info).toContain("403");
  });
});
