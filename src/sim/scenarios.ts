import { VirtualTable } from "./virtualTable";

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

/** Plays a scenario on a VirtualTable, one physical move at a time, with a pause between moves. */
export class ScenarioRunner {
  index = 0;
  private nextAt = 0;
  constructor(public table: VirtualTable, public scenario: Scenario, public pauseMs = 2500) {}

  get done() { return this.index >= this.scenario.moves.length; }

  /** Call every tick; starts the next move once the previous one has finished and the pause elapsed. */
  step(now: number): boolean {
    this.table.tick(now);
    if (this.done || this.table.busy) return false;
    if (this.nextAt === 0) this.nextAt = now + this.pauseMs;
    if (now < this.nextAt) return false;
    const ok = this.table.play(this.scenario.moves[this.index], now);
    if (!ok) throw new Error(`scenario ${this.scenario.id}: illegal move ${this.scenario.moves[this.index]}`);
    this.index++;
    this.nextAt = 0;
    return true;
  }
}
