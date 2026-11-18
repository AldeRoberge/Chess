import { Chess } from "chess.js";
import type { Engine } from "../chess/engine";
import type { TableAction, TableAsk, VirtualTable } from "./virtualTable";

/** The Game choice that plays a live Stockfish game instead of a scripted one. */
export const LIVE_ID = "live-stockfish";
/** Safety net: a live game that has not ended by this many plies is called a draw. */
export const LIVE_MAX_PLIES = 400;

/**
 * Plays a live game between the two AI players: an engine picks each move (one engine, one Elo per side),
 * and the moves go to the table as the same actions a scripted game produces. Same contract as ScenarioRunner.
 */
export class LiveGame {
  index = 0;
  readonly id = "live";
  error: string | null = null;
  private nextAt = 0;
  private nextId = 1;
  private phase: "start" | "moves" | "shake-end" | "fist" | "done" = "start";
  private primed = false;
  private board = new Chess();
  private pending: Promise<void> | null = null;
  private pendingUci: string | null = null;
  private loser: "w" | "b" | null = null;
  private heldAt: number | null = null;

  constructor(public table: VirtualTable, private engine: Engine, public elo: { w: number; b: number }, public pauseMs = 2500) {}

  get done() { return this.phase === "done"; }
  get held() { return this.heldAt !== null; }
  /** The side that was checkmated, or null for a draw or an unfinished game. */
  get loserColor() { return this.loser; }

  setHeld(on: boolean, now: number) {
    if (on && this.heldAt === null) this.heldAt = now;
    else if (!on && this.heldAt !== null) { if (this.nextAt) this.nextAt += now - this.heldAt; this.heldAt = null; }
  }

  /** Call every tick, like ScenarioRunner.step: returns the actions the AI players should carry out now. */
  step(now: number): TableAction[] {
    this.table.tick(now);
    if (this.done || this.table.busy || this.held) return [];
    const ask = (a: TableAsk) => [{ ...a, id: this.nextId++ } as TableAction];
    if (this.phase === "start") {
      if (!this.primed) { this.primed = true; return []; } // the first tick may reset the table, so the handshake waits one tick
      this.phase = "moves";
      return ask({ kind: "handshake" });
    }
    if (this.phase === "moves") {
      if (this.board.isGameOver() || this.index >= LIVE_MAX_PLIES) {
        this.loser = this.board.isCheckmate() ? this.board.turn() : null;
        this.phase = "shake-end";
      }
    }
    if (this.phase === "moves") {
      if (this.nextAt === 0) this.nextAt = now + this.pauseMs;
      if (now < this.nextAt) return [];
      if (this.pendingUci === null) { if (!this.pending) this.requestMove(); return []; }
      const uci = this.pendingUci;
      this.pendingUci = null; this.pending = null;
      const color = this.board.turn();
      const m = this.board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      if (!m) { this.error = `engine returned an illegal move ${uci}`; this.phase = "done"; return []; }
      this.index++;
      this.nextAt = 0;
      return ask({ kind: "move", color, san: m.san });
    }
    if (this.phase === "shake-end") {
      this.phase = this.loser ? "fist" : "done";
      return ask({ kind: "handshake" });
    }
    if (this.phase === "fist") {
      this.phase = "done";
      return ask({ kind: "fist", color: this.loser! });
    }
    return [];
  }

  private requestMove() {
    const turn = this.board.turn();
    this.engine.setElo(turn === "w" ? this.elo.w : this.elo.b);
    this.pending = this.engine.bestMove(this.board.fen()).then(
      (uci) => { this.pendingUci = uci; },
      (e) => { this.error = String(e); this.phase = "done"; },
    );
  }
}
