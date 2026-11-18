import { Chess, type Move } from "chess.js";
import type { ExperienceEvent } from "../core/events";
import { sqName, type BoardBelief } from "../vision/types";

export type TrackStatus = "pending" | "synced" | "lifted" | "illegal" | "moved";

export interface MoveInfo {
  san: string;
  from: string;
  to: string;
  piece: string;
  color: "w" | "b";
  captured?: string;
  flags: string;
  promotion?: string;
  check: boolean;
  mate: boolean;
  ply: number;
  fidelity: number;
}

export interface TrackResult {
  status: TrackStatus;
  fen: string;
  turn: "w" | "b";
  ply: number;
  over: boolean;
  last: MoveInfo | null;
  history: string[];
  diff: number[]; // squares where observation != expectation
  lifted?: string; // square of a piece currently in hand
  fidelity: number; // overall confidence in the tracked state (0..1)
  moveFidelity: number; // fidelity of the last accepted move
  events: ExperienceEvent[];
}

export interface TrackerConfig {
  maxCost: number; // accept candidate if confidence-weighted mismatch <= this
  margin: number; // best must beat the runner-up by this much
  confirm: number; // consecutive settled observations before committing
  /** a move may only be committed when every square it changes is read at least this confidently (0..1) */
  minConf: number;
  promotion: "q" | "r" | "b" | "n";
}
export const defaultTrackerConfig = (): TrackerConfig => ({ maxCost: 0.8, margin: 0.5, confirm: 2, minConf: 0.5, promotion: "q" });

const gridOf = (game: Chess): string[] =>
  game.board().flat().map((p) => (p ? p.color : ""));

/**
 * Turns noisy settled occupancy into a *legal* game. Piece identity is never read from pixels:
 * the tracker keeps a chess.js position and only accepts a change if some legal move (or, for
 * dropped frames, a legal pair of moves) explains the observed occupancy + colour grid.
 */
export class PositionTracker {
  game = new Chess();
  cfg: TrackerConfig;
  private cand = "";
  private candN = 0;
  private lastMove: MoveInfo | null = null;
  private moveFid = 1;

  constructor(cfg: Partial<TrackerConfig> = {}) {
    this.cfg = { ...defaultTrackerConfig(), ...cfg };
  }

  reset(fen?: string) {
    this.game = fen ? new Chess(fen) : new Chess();
    this.cand = "";
    this.candN = 0;
    this.lastMove = null;
    this.moveFid = 1;
  }

  private cost(grid: string[], obsGrid: string[], conf: Float32Array) {
    let c = 0;
    for (let i = 0; i < 64; i++) if (grid[i] !== obsGrid[i]) c += 0.25 + 0.75 * conf[i];
    return c;
  }

  private base(status: TrackStatus, diff: number[], events: ExperienceEvent[], fid: number, lifted?: string): TrackResult {
    return {
      status, fen: this.game.fen(), turn: this.game.turn(), ply: this.game.history().length,
      over: this.game.isGameOver(), last: this.lastMove, history: this.game.history(),
      diff, lifted, fidelity: fid, moveFidelity: this.moveFid, events,
    };
  }

  observe(b: BoardBelief): TrackResult {
    const events: ExperienceEvent[] = [];
    if (!b.settled) return this.base("pending", [], events, b.fidelity);

    const obsGrid = Array.from({ length: 64 }, (_, i) => (b.occ[i] > 0.5 ? (b.white[i] > 0.5 ? "w" : "b") : ""));
    const exp = gridOf(this.game);
    const diff: number[] = [];
    for (let i = 0; i < 64; i++) if (exp[i] !== obsGrid[i]) diff.push(i);
    if (!diff.length) {
      this.cand = ""; this.candN = 0;
      return this.base("synced", diff, events, b.fidelity);
    }

    // No legal move ever adds a piece to the board. More occupied squares than expected means something that is not a
    // piece (a forearm, a hand, a shadow) is covering the table: wait for it to clear instead of explaining it as a move.
    if (obsGrid.filter(Boolean).length > exp.filter(Boolean).length) {
      this.cand = ""; this.candN = 0;
      return this.base("pending", diff, events, b.fidelity);
    }

    // score every legal move, then (only if needed) every legal pair
    type Cand = { moves: Move[]; cost: number; key: string; grid: string[]; unsure: number };
    // squares a candidate changes that the cameras are still unsure about: committing now would be a guess
    const unsureOf = (grid: string[]) => { let n = 0; for (let i = 0; i < 64; i++) if (grid[i] !== exp[i] && b.conf[i] < this.cfg.minConf) n++; return n; };
    const cands: Cand[] = [];
    const try1 = (g: Chess, prefix: Move[]) => {
      for (const m of g.moves({ verbose: true })) {
        if (m.promotion && m.promotion !== this.cfg.promotion) continue;
        g.move(m);
        const grid = gridOf(g);
        cands.push({ moves: [...prefix, m], cost: this.cost(grid, obsGrid, b.conf), key: g.fen(), grid, unsure: unsureOf(grid) });
        g.undo();
      }
    };
    try1(this.game, []);
    cands.sort((a, c) => a.cost - c.cost);
    if (!cands.length || cands[0].cost > this.cfg.maxCost) {
      const seed = [...cands].slice(0, 12);
      for (const s of seed) {
        const g = new Chess(this.game.fen());
        g.move(s.moves[0]);
        try1(g, [s.moves[0]]);
        // drop depth-1 duplicates of seeds when pairs are appended
      }
      cands.sort((a, c) => a.cost - c.cost);
    }

    const best = cands[0];
    // runner-up must lead to a *different* occupancy grid, otherwise it is an equivalent explanation
    const rival = cands.find((c) => c.key !== best?.key && c.grid.join(",") !== best?.grid.join(","));
    const ok = best && best.cost <= this.cfg.maxCost && (!rival || rival.cost - best.cost >= this.cfg.margin);

    if (ok && best.unsure > 0) { // e.g. a king move that is really half a castle: wait for the rook's square to be read
      this.cand = ""; this.candN = 0;
      return this.base("pending", diff, events, b.fidelity);
    }
    if (ok) {
      const key = best.key;
      this.candN = this.cand === key ? this.candN + 1 : 1;
      this.cand = key;
      if (this.candN >= this.cfg.confirm) {
        const fid = Math.exp(-best.cost);
        for (const m of best.moves) {
          const done = this.game.move(m);
          const info: MoveInfo = {
            san: done.san, from: done.from, to: done.to, piece: done.piece, color: done.color,
            captured: done.captured, flags: done.flags, promotion: done.promotion,
            check: this.game.inCheck(), mate: this.game.isCheckmate(), ply: this.game.history().length, fidelity: fid,
          };
          this.lastMove = info;
          events.push({ type: "move", t: b.t, data: info });
          if (info.captured) events.push({ type: "capture", t: b.t, data: info });
          if (info.flags.includes("k") || info.flags.includes("q")) events.push({ type: "castle", t: b.t, data: info });
          if (info.promotion) events.push({ type: "promotion", t: b.t, data: info });
          if (info.check && !info.mate) events.push({ type: "check", t: b.t, data: info });
          if (info.mate) events.push({ type: "mate", t: b.t, data: info });
        }
        if (this.game.isDraw()) events.push({ type: "draw", t: b.t });
        this.moveFid = fid;
        this.cand = ""; this.candN = 0;
        return this.base("moved", [], events, b.fidelity);
      }
      return this.base("pending", diff, events, b.fidelity);
    }

    this.cand = ""; this.candN = 0;
    // exactly one of our pieces vanished: a piece is in hand, waiting for the destination
    const gone = diff.filter((i) => exp[i] && !obsGrid[i]);
    if (gone.length === 1 && diff.length === 1) {
      const lifted = sqName(gone[0]);
      events.push({ type: "lifted", t: b.t, data: { square: lifted } });
      return this.base("lifted", diff, events, b.fidelity, lifted);
    }
    events.push({ type: "illegal", t: b.t, data: { squares: diff.map(sqName) } });
    return this.base("illegal", diff, events, b.fidelity);
  }
}
