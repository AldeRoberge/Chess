import { Chess } from "chess.js";
import type { TableAction, TableAsk, VirtualTable } from "./virtualTable";

export interface Scenario {
  id: string;
  name: string;
  description: string;
  moves: string[]; // SAN from the start position
  /** What the tracker + cues should observe by the end (asserted by the test suite). */
  expect: { plies: number; captures: number; queenCaptured: boolean; mate: boolean; castles: number; promotions: number; checks: number };
}

export const SCENARIOS: Scenario[] = [
  { id: "scholars-mate", name: "Scholar's mate", description: "Four-move mate; queen takes f7.", moves: ["e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6", "Qxf7#"],
    expect: { plies: 7, captures: 1, queenCaptured: false, mate: true, castles: 0, promotions: 0, checks: 0 } },
  { id: "opera-game", name: "The Opera Game", description: "Morphy 1858: queen sacrifice, long castle, mate.", moves: ["e4", "e5", "Nf3", "d6", "d4", "Bg4", "dxe5", "Bxf3", "Qxf3", "dxe5", "Bc4", "Nf6", "Qb3", "Qe7", "Nc3", "c6", "Bg5", "b5", "Nxb5", "cxb5", "Bxb5+", "Nbd7", "O-O-O", "Rd8", "Rxd7", "Rxd7", "Rd1", "Qe6", "Bxd7+", "Nxd7", "Qb8+", "Nxb8", "Rd8#"],
    expect: { plies: 33, captures: 12, queenCaptured: true, mate: true, castles: 1, promotions: 0, checks: 3 } },
  { id: "queen-trade", name: "Queen exchange", description: "Both queens leave the board: thunder, twice.", moves: ["e4", "d5", "exd5", "Qxd5", "Nc3", "Qxd2+", "Bxd2"],
    expect: { plies: 7, captures: 4, queenCaptured: true, mate: false, castles: 0, promotions: 0, checks: 1 } },
  { id: "castle-both", name: "Castling both sides", description: "Quiet Italian with short castles for both.", moves: ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "O-O", "Nf6", "d3", "O-O"],
    expect: { plies: 10, captures: 0, queenCaptured: false, mate: false, castles: 2, promotions: 0, checks: 0 } },
  { id: "en-passant", name: "En passant", description: "The rare capture, two squares apart from the victim.", moves: ["e4", "a6", "e5", "d5", "exd6"],
    expect: { plies: 5, captures: 1, queenCaptured: false, mate: false, castles: 0, promotions: 0, checks: 0 } },
  { id: "promotion", name: "Pawn promotion", description: "A rook-file pawn marches in and queens with capture.", moves: ["h4", "g5", "hxg5", "h6", "gxh6", "Nf6", "h7", "Ng8", "hxg8=Q"],
    expect: { plies: 9, captures: 3, queenCaptured: false, mate: false, castles: 0, promotions: 1, checks: 0 } },
];

export const scenarioById = (id: string) => SCENARIOS.find((s) => s.id === id);

/**
 * Plays a scenario one physical move at a time, with a pause between moves. It does not touch the table itself:
 * it asks for actions (handshake, moves, fist) and the AI players at the table carry them out.
 */
export class ScenarioRunner {
  index = 0;
  private nextAt = 0;
  private nextId = 1;
  private phase: "start" | "moves" | "shake-end" | "fist" | "settle" | "done" = "start";
  private primed = false;
  /** the position the script has reached, to check the script itself (the table only catches up once the players have moved) */
  private board = new Chess();
  constructor(public table: VirtualTable, public scenario: Scenario, public pauseMs = 2500) {}

  get done() { return this.phase === "done"; }
  /** The side that gets checkmated and loses, when the game ends in mate; null otherwise. */
  get loser(): "w" | "b" | null { return this.scenario.expect.mate ? (this.scenario.moves.length % 2 === 1 ? "b" : "w") : null; }
  private heldAt: number | null = null;

  get held() { return this.heldAt !== null; }

  /** Pause or resume. While held no new move starts; resuming gives back the time spent held. */
  setHeld(on: boolean, now: number) {
    if (on && this.heldAt === null) this.heldAt = now;
    else if (!on && this.heldAt !== null) { if (this.nextAt) this.nextAt += now - this.heldAt; this.heldAt = null; }
  }

  /** Call every tick; starts the next move once the previous one has finished and the pause elapsed. */
  step(now: number): TableAction[] {
    this.table.tick(now);
    if (this.done || this.table.busy || this.held) return [];
    const ask = (a: TableAsk) => [{ ...a, id: this.nextId++ } as TableAction];
    if (this.phase === "start") {
      if (!this.primed) { this.primed = true; return []; } // the first tick may also reset the table (scenario-start), so the handshake waits one tick
      this.phase = "moves";
      return ask({ kind: "handshake" });
    }
    if (this.phase === "moves") {
      if (this.index < this.scenario.moves.length) {
        if (this.nextAt === 0) this.nextAt = now + this.pauseMs;
        if (now < this.nextAt) return [];
        const san = this.scenario.moves[this.index], color = this.index % 2 === 0 ? "w" : "b";
        let legal = false;
        try { legal = !!this.board.move(san); } catch { legal = false; } // chess.js throws on a move it cannot read
        if (!legal) throw new Error(`scenario ${this.scenario.id}: illegal move ${san}`);
        this.index++;
        this.nextAt = 0;
        return ask({ kind: "move", color, san });
      }
      this.phase = "shake-end";
    }
    if (this.phase === "shake-end") {
      this.phase = this.loser ? "fist" : "settle";
      return ask({ kind: "handshake" });
    }
    if (this.phase === "fist") {
      this.phase = "settle";
      return ask({ kind: "fist", color: this.loser! });
    }
    if (this.phase === "settle") { this.phase = "done"; } // the last action is only finished once the table has been left idle
    return [];
  }
}
