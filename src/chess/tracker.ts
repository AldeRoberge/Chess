import { Chess, type Move } from "chess.js";
import type { ExperienceEvent } from "../core/events";
import { sqName, type BoardBelief } from "../vision/types";

/** "unclear": the cameras disagree with the game in more places than any move could explain, so the reading is at fault, not the player. */
export type TrackStatus = "pending" | "synced" | "lifted" | "illegal" | "moved" | "unclear";
/** A move changes at most four squares (castling). More confident disagreements than this are a misread board. */
const MAX_MOVE_SQUARES = 6;
/** Settled readings in a row that must disagree before a position is called illegal: one noisy frame is not a mistake. */
const ILLEGAL_AFTER = 3;
const MAX_UNCERTAIN_SQUARES = 2, UNCERTAIN_CONFIDENCE = 0.75;

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
  uncertain?: number[]; // tolerated camera disagreement; the tracked position is retained
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
const START_GRID = gridOf(new Chess()).join(",");

/**
 * Turns noisy settled occupancy into a *legal* game. Piece identity is never read from pixels:
 * the tracker keeps a chess.js position and only accepts a change if some legal move (or, for
 * dropped frames, a legal pair of moves) explains the observed occupancy + colour grid.
 */
export class PositionTracker {
  game = new Chess();
  cfg: TrackerConfig;
  private urgencyAt: number | null = null;
  private provisional: { fen: string; ply: number; san: string; cost: number } | null = null;
  private correctionKey = "";
  private correctionN = 0;
  private cand = "";
  private candN = 0;
  private lastMove: MoveInfo | null = null;
  private moveFid = 1;
  private badN = 0;
  private keepBad = false;
  /** Extra blobs already present when a legal move was confirmed (e.g. a knight's shadow). */
  private acceptedExtras = new Map<number, string>();

  constructor(cfg: Partial<TrackerConfig> = {}) {
    this.cfg = { ...defaultTrackerConfig(), ...cfg };
  }

  reset(fen?: string) {
    this.game = fen ? new Chess(fen) : new Chess();
    this.urgencyAt = null; this.provisional = null;
    this.correctionKey = ""; this.correctionN = 0;
    this.cand = "";
    this.candN = 0;
    this.lastMove = null;
    this.moveFid = 1;
    this.badN = 0;
    this.acceptedExtras.clear();
  }

  /** Picks up a stored game: replays its moves from the start so the history is kept. False (and a fresh game) if one is illegal. */
  resume(moves: readonly string[]): boolean {
    this.reset();
    for (const m of moves) { try { this.game.move(m); } catch { this.reset(); return false; } }
    return true;
  }

  private cost(grid: string[], obsGrid: string[], conf: Float32Array) {
    let c = 0;
    for (let i = 0; i < 64; i++) if (grid[i] !== obsGrid[i]) c += 0.25 + 0.75 * conf[i];
    return c;
  }

  /** Bumped whenever this class changes the game, so the position summary below is only rebuilt after a move. */
  private ver = 0;
  private memo: { game: Chess; ver: number; fen: string; turn: "w" | "b"; over: boolean; history: string[] } | null = null;

  private base(status: TrackStatus, diff: number[], events: ExperienceEvent[], fid: number, lifted?: string): TrackResult {
    if (!this.keepBad) this.badN = 0;
    this.keepBad = false;
    // chess.js rebuilds the SAN history by undoing and replaying every move, and this runs on every tick:
    // keep the summary until the game actually changes.
    let m = this.memo;
    if (!m || m.game !== this.game || m.ver !== this.ver) {
      m = this.memo = { game: this.game, ver: this.ver, fen: this.game.fen(), turn: this.game.turn(), over: this.game.isGameOver(), history: this.game.history() };
    }
    return {
      status, fen: m.fen, turn: m.turn, ply: m.history.length,
      over: m.over, last: this.lastMove, history: m.history.slice(),
      diff, uncertain: status === "synced" ? diff.slice() : [], lifted, fidelity: fid, moveFidelity: this.moveFid, events,
    };
  }

  /** Plays one move on the tracked game and appends the events it causes (move, capture, castle, promotion, check, mate). */
  private commit(m: Move | { from: string; to: string; promotion?: string }, t: number, fid: number, events: ExperienceEvent[]) {
    const done = this.game.move(m);
    this.ver++;
    const info: MoveInfo = {
      san: done.san, from: done.from, to: done.to, piece: done.piece, color: done.color,
      captured: done.captured, flags: done.flags, promotion: done.promotion,
      check: this.game.inCheck(), mate: this.game.isCheckmate(), ply: this.game.history().length, fidelity: fid,
    };
    this.lastMove = info;
    events.push({ type: "move", t, data: info });
    if (info.captured) events.push({ type: "capture", t, data: info });
    if (info.flags.includes("k") || info.flags.includes("q")) events.push({ type: "castle", t, data: info });
    if (info.promotion) events.push({ type: "promotion", t, data: info });
    if (info.check && !info.mate) events.push({ type: "check", t, data: info });
    if (info.mate) events.push({ type: "mate", t, data: info });
  }

  /**
   * Applies a move that is already known (a finger drag, the engine) instead of reading it from the cameras.
   * Returns null, and leaves the game untouched, when the move is not legal.
   */
  play(from: string, to: string, promotion: string | undefined, t: number): TrackResult | null {
    const events: ExperienceEvent[] = [];
    try { this.commit({ from, to, promotion }, t, 1, events); } catch { return null; }
    if (this.game.isDraw()) events.push({ type: "draw", t });
    this.moveFid = 1; this.cand = ""; this.candN = 0;
    return this.base("moved", [], events, 1);
  }

  /** The current position as a result with no change in it (what a node publishes between moves). */
  snapshot(): TrackResult { return this.base("synced", [], [], 1); }

  observe(b: BoardBelief): TrackResult {
    const events: ExperienceEvent[] = [];
    const obsGrid = Array.from({ length: 64 }, (_, i) => (b.occ[i] > 0.5 ? (b.white[i] > 0.5 ? "w" : "b") : ""));
    // A provisional guess can be replaced by a repeatedly observed exact legal alternative,
    // only until another move has been played.
    const pending = this.provisional;
    if (pending && this.game.history().length !== pending.ply) this.provisional = null;
    if (pending && this.provisional && b.settled && !b.handOver && b.cams > 0) {
      const before = new Chess(pending.fen);
      let replacement: Move | null = null;
      for (const m of before.moves({ verbose: true })) {
        before.move(m);
        if (m.san !== pending.san && gridOf(before).every((v, i) => v === obsGrid[i]) && b.conf.every((v) => v >= this.cfg.minConf)) replacement = m;
        before.undo();
      }
      this.correctionN = replacement && replacement.san === this.correctionKey ? this.correctionN + 1 : replacement ? 1 : 0;
      this.correctionKey = replacement?.san ?? "";
      if (replacement && this.correctionN >= this.cfg.confirm) {
        this.game.undo(); this.ver++;
        this.commit(replacement, b.t, b.fidelity, events);
        events.push({ type: "detection-correction", t: b.t, data: { previous: pending.san, corrected: replacement.san, beforeFen: pending.fen, previousCost: pending.cost, occupancy: Array.from(b.occ), white: Array.from(b.white), confidence: Array.from(b.conf), cameras: b.cams, fidelity: b.fidelity } });
        this.provisional = null; this.urgencyAt = null; this.acceptedExtras.clear();
        this.moveFid = b.fidelity;
        return this.base("moved", [], events, b.fidelity);
      }
    }
    const exp = gridOf(this.game);
    // Retain only unchanged extra blobs on empty squares. Never learn a newly appearing
    // hand here, or hide a missing piece, a colour change, or a real occupied square.
    for (const [i, color] of this.acceptedExtras) {
      if (exp[i] || obsGrid[i] !== color) this.acceptedExtras.delete(i);
    }
    const diff: number[] = [];
    for (let i = 0; i < 64; i++) if (exp[i] !== obsGrid[i]) diff.push(i);
    const extraOnly = diff.every((i) => !exp[i] && !!obsGrid[i]);
    if (!b.handOver && b.cams > 0 && (this.lastMove !== null || this.game.history().length > 0)
      && diff.length > 0 && diff.length <= MAX_UNCERTAIN_SQUARES && extraOnly) {
      this.cand = ""; this.candN = 0;
      return this.base("synced", diff, events, b.fidelity);
    }
    if (!b.handOver && diff.length && diff.every((i) => this.acceptedExtras.get(i) === obsGrid[i])) {
      this.cand = ""; this.candN = 0;
      return this.base("synced", diff, events, b.fidelity);
    }
    if (!diff.length) this.urgencyAt = null;
    else if (b.cams > 0 && !b.handOver && this.urgencyAt === null) this.urgencyAt = b.t;
    const firm = diff.some((i) => b.conf[i] >= this.cfg.minConf);
    const minorUncertainty = diff.length <= MAX_UNCERTAIN_SQUARES && diff.every((i) => b.conf[i] < Math.max(this.cfg.minConf, UNCERTAIN_CONFIDENCE));
    // The settle timer only gates a new move. A picture that already matches the game, or disagrees
    // only where the cameras are unsure, is the position we have: the opponent can play.
    if (!b.settled) {
      if (!b.handOver && b.cams > 0 && minorUncertainty) { this.cand = ""; this.candN = 0; return this.base("synced", diff, events, b.fidelity); }
      if (!firm) { this.cand = ""; this.candN = 0; return this.base("synced", [], events, b.fidelity); }
      return this.base("pending", [], events, b.fidelity);
    }
    if (!diff.length) {
      this.cand = ""; this.candN = 0;
      return this.base("synced", diff, events, b.fidelity);
    }

    const surplus = obsGrid.filter(Boolean).length > exp.filter(Boolean).length;

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

    // A castle that is only half-seen (the king has stepped, the rook's square is still unread) must wait.
    // A single move the picture matches exactly — a knight hop, a king step — is the move itself.
    // cost 0 means the squares agree; they are only soft, not contradictory. A half-castle still disagrees and waits.
    // Squares the move does not touch, where the cameras only half-see an extra piece, do not count against it: a tall
    // knight on f3 leans into e3 in a low camera's picture, and without this the first move was never accepted.
    const contradicts = (grid: string[]) => { for (let i = 0; i < 64; i++) if (grid[i] !== obsGrid[i] && (grid[i] !== exp[i] || b.conf[i] >= this.cfg.minConf)) return true; return false; };
    const exactStep = best?.moves.length === 1 && (best.cost === 0 || !contradicts(best.grid));
    // What moved: the squares that changed, explained by a legal move. When exactly one legal move makes every square it
    // touches match the picture, that is the move, even if a square or two it does not touch is misread (a tall piece
    // leaning over its neighbour, a reflection). A piece of the mover's that confidently vanished elsewhere rules it out.
    const touched = (c: Cand) => { const t: number[] = []; for (let i = 0; i < 64; i++) if (c.grid[i] !== exp[i]) t.push(i); return t; };
    const fits = cands.filter((c) => c.moves.length === 1 && touched(c).every((i) => c.grid[i] === obsGrid[i]));
    let sole: Cand | null = null;
    if (fits.length && new Set(fits.map((c) => c.grid.join(","))).size === 1) {
      const own = new Set(touched(fits[0])), stray = diff.filter((i) => !own.has(i)), mover = this.game.turn();
      if (stray.length <= 2 && !stray.some((i) => exp[i] === mover && !obsGrid[i] && b.conf[i] >= this.cfg.minConf)) sole = fits[0];
    }
    const urgent = this.urgencyAt !== null && b.t - this.urgencyAt >= 5000 && !b.handOver && b.cams > 0;
    // Require evidence of a destination and an improvement over doing nothing.
    // A lifted piece alone must never turn into an arbitrary legal move.
    const guess = urgent ? cands.find((c) => c.moves.length === 1 && c.cost < this.cost(exp, obsGrid, b.conf)
      && touched(c).some((i) => c.grid[i] && c.grid[i] !== exp[i] && obsGrid[i] === c.grid[i])) : undefined;
    const normal = ok && (best.unsure === 0 || exactStep) ? best : sole;
    const chosen = normal ?? guess;
    if (!chosen) {
      if (ok) { this.cand = ""; this.candN = 0; return this.base("pending", diff, events, b.fidelity); }
    } else {
      const key = chosen.key;
      this.candN = this.cand === key ? this.candN + 1 : 1;
      this.cand = key;
      if (this.candN >= this.cfg.confirm || (!normal && guess)) {
        const beforeFen = this.game.fen();
        const fid = Math.exp(-chosen.cost);
        for (const m of chosen.moves) this.commit(m, b.t, fid, events);
        if (!normal) {
          this.provisional = { fen: beforeFen, ply: this.game.history().length, san: chosen.moves[0].san, cost: chosen.cost };
          events.push({ type: "detection-guess", t: b.t, data: { reason: "five-second deadline", beforeFen, selected: chosen.moves.map((m) => m.san), cost: chosen.cost, alternatives: cands.slice(0, 5).map((c) => ({ moves: c.moves.map((m) => m.san), cost: c.cost })), occupancy: Array.from(b.occ), white: Array.from(b.white), confidence: Array.from(b.conf), cameras: b.cams, fidelity: b.fidelity } });
        } else this.provisional = null;
        this.urgencyAt = null;
        this.acceptedExtras.clear();
        for (let i = 0; i < 64; i++) {
          if (!chosen.grid[i] && obsGrid[i]) this.acceptedExtras.set(i, obsGrid[i]);
        }
        if (this.game.isDraw()) events.push({ type: "draw", t: b.t });
        this.moveFid = fid;
        this.cand = ""; this.candN = 0;
        return this.base("moved", [], events, b.fidelity);
      }
      return this.base("pending", diff, events, b.fidelity);
    }

    // The pieces are all back on their starting squares in the middle of a game: the players set up a new one.
    if (this.game.history().length && obsGrid.join(",") === START_GRID && diff.every((i) => b.conf[i] >= this.cfg.minConf)) {
      this.candN = this.cand === START_GRID ? this.candN + 1 : 1;
      this.cand = START_GRID;
      if (this.candN < this.cfg.confirm) return this.base("pending", diff, events, b.fidelity);
      this.reset();
      events.push({ type: "new-game", t: b.t });
      return this.base("synced", [], events, b.fidelity);
    }
    this.cand = ""; this.candN = 0;
    // Keep the accepted position through a small amount of noise. Do not erase the
    // disagreement: re-evaluate it on every reading so a clear legal move still wins.
    // Extra blobs alone cannot be a move, even if the camera is confident about them.
    if (!b.handOver && b.cams > 0 && diff.length <= MAX_UNCERTAIN_SQUARES
      && (minorUncertainty || ((this.lastMove !== null || this.game.history().length > 0) && extraOnly))) {
      return this.base("synced", diff, events, b.fidelity);
    }
    // No legal move explained the picture. Extra squares the cameras are unsure about are a lamp or a shadow:
    // they are not a move, and they must not keep a move that already counted from standing.
    if (surplus && diff.every((i) => b.conf[i] < this.cfg.minConf)) return this.base("synced", diff, events, b.fidelity);
    // A confident extra piece is a hand still over the board, not a move.
    if (surplus) return this.base("pending", diff, events, b.fidelity);
    // exactly one of our pieces vanished: a piece is in hand, waiting for the destination
    const gone = diff.filter((i) => exp[i] && !obsGrid[i]);
    if (gone.length === 1 && diff.length === 1) {
      const lifted = sqName(gone[0]);
      events.push({ type: "lifted", t: b.t, data: { square: lifted } });
      return this.base("lifted", diff, events, b.fidelity, lifted);
    }
    // Only squares the cameras are sure of can make a position wrong. Unsure ones leave the game as it stands.
    const sure = diff.filter((i) => b.conf[i] >= this.cfg.minConf);
    if (!sure.length) return this.base("synced", diff, events, b.fidelity);
    // Far more disagreement than a move can make: the picture is misread (light, corners, calibration), the player did nothing wrong.
    if (sure.length > MAX_MOVE_SQUARES) return this.base("unclear", diff, events, b.fidelity);
    // A wrong position must hold for a few settled readings before the player is told to fix it.
    this.badN++;
    this.keepBad = true;
    if (this.badN < ILLEGAL_AFTER) return this.base("pending", diff, events, b.fidelity);
    this.keepBad = true; // stays illegal until the board is put right
    events.push({ type: "illegal", t: b.t, data: { squares: diff.map(sqName) } });
    return this.base("illegal", diff, events, b.fidelity);
  }
}
