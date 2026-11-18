import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { nextRemoteMove, pickGame } from "./chesscom";

const pgnOf = (...m: string[]) => { const c = new Chess(); m.forEach((x) => c.move(x)); return { pgn: c.pgn(), fen: c.fen() }; };
const api = (me: "white" | "black", ...m: string[]) => ({ games: [{ url: "https://www.chess.com/game/daily/1", ...pgnOf(...m), turn: "white", white: `https://api.chess.com/pub/player/${me === "white" ? "Me" : "Rival"}`, black: `https://api.chess.com/pub/player/${me === "white" ? "Rival" : "Me"}` }] });

describe("chess.com bridge", () => {
  it("picks the game, our colour and the opponent", () => {
    const g = pickGame(api("black", "e4"), "me")!; expect(g.color).toBe("b"); expect(g.opponent).toBe("rival"); expect(g.moveCount).toBe(1);
    expect(pickGame(api("white"), "me", "https://other")).toBeNull(); expect(pickGame({}, "me")).toBeNull();
  });
  it("tells where to move the opponent's piece, then reports synced", () => {
    const g = pickGame(api("black", "e4"), "me")!;
    expect(nextRemoteMove(new Chess().fen(), g)).toMatchObject({ kind: "move", move: { from: "e2", to: "e4", by: "opponent" } });
    const c = new Chess(); c.move("e4"); expect(nextRemoteMove(c.fen(), g).kind).toBe("synced");
  });
  it("catches up several plies and flags a diverged board", () => {
    const g = pickGame(api("white", "e4", "e5", "Nf3"), "me")!; const c = new Chess(); c.move("e4");
    expect(nextRemoteMove(c.fen(), g)).toMatchObject({ kind: "move", move: { san: "e5", by: "opponent" } });
    const d = new Chess(); d.move("d4"); expect(nextRemoteMove(d.fen(), g).kind).toBe("diverged");
  });
});
