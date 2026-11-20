import type { Square } from "chess.js";
import { Chess } from "chess.js";
import type { ExperienceEvent } from "../core/events";
import { sqIndex, sqName } from "../vision/types";
import type { PointerSample } from "./director";

/** A piece the user is holding right now, in board coordinates (board = 0..8, a8 at 0,0). */
export interface DragState {
  from: string;
  /** chess.js piece letter, lower case */
  piece: string;
  color: "w" | "b";
  /** where the fingertip is */
  x: number; y: number;
  /** squares it may legally be dropped on */
  legal: string[];
  /** the square under the fingertip, null when off the board */
  hover: string | null;
}

export interface DragConfig {
  /** how close to the middle of a square (in squares) the fingertip must be to pick its piece up */
  grabRadius: number;
  /** how long a fingertip may lose contact before the piece is dropped (ms): jitter in the height reading must not drop it */
  graceMs: number;
  promotion: "q" | "r" | "b" | "n";
}
export const defaultDragConfig = (): DragConfig => ({ grabRadius: 0.6, graceMs: 250, promotion: "q" });

/** Square name under a board coordinate, or null off the board. */
export function squareAt(x: number, y: number): string | null {
  const c = Math.floor(x), r = Math.floor(y);
  return c >= 0 && c < 8 && r >= 0 && r < 8 ? sqName(r * 8 + c) : null;
}

/**
 * Picks pieces up and drops them: a fingertip that touches a piece of the side to move takes it, the piece follows the
 * fingertip, and lifting the finger over a legal square plays the move. Anything else puts the piece back.
 * Knows nothing about cameras: it only sees the position and the touching fingertips.
 */
export class DragDrop {
  drag: DragState | null = null;
  private pid = "";
  private fen = "";
  private lostAt: number | null = null;
  constructor(public cfg: DragConfig = defaultDragConfig()) {}

  reset() { this.drag = null; this.pid = ""; this.lostAt = null; }

  step(now: number, fen: string | null, pointers: PointerSample[]): { drag: DragState | null; events: ExperienceEvent[] } {
    const events: ExperienceEvent[] = [];
    const cancel = (reason: string) => { if (this.drag) events.push({ type: "piece-cancel", t: now, data: { from: this.drag.from, reason } }); this.reset(); };
    if (!fen) { if (this.drag) cancel("no game"); return { drag: null, events }; }
    if (this.drag && fen !== this.fen) cancel("position changed"); // the engine moved, or the game restarted, under the finger
    const touching = pointers.filter((p) => p.down);

    if (!this.drag) {
      this.fen = fen;
      let game: Chess;
      try { game = new Chess(fen); } catch { return { drag: null, events }; }
      if (game.isGameOver()) return { drag: null, events };
      for (const p of touching) {
        const sq = squareAt(p.x, p.y);
        if (!sq) continue;
        const idx = sqIndex(sq), cx = (idx % 8) + 0.5, cy = Math.floor(idx / 8) + 0.5;
        if (Math.hypot(p.x - cx, p.y - cy) > this.cfg.grabRadius) continue;
        const piece = game.get(sq as Square);
        if (!piece || piece.color !== game.turn()) continue; // only the side to move can be picked up
        const legal = [...new Set((game.moves({ square: sq as Square, verbose: true }) as { to: string }[]).map((m) => m.to))];
        if (!legal.length) continue; // nothing to do with this piece: do not pick it up
        this.pid = p.id; this.lostAt = null;
        this.drag = { from: sq, piece: piece.type, color: piece.color, x: p.x, y: p.y, legal, hover: sq };
        events.push({ type: "piece-grab", t: now, data: { from: sq, piece: piece.type, legal } });
        break;
      }
      return { drag: this.drag, events };
    }

    // holding: follow the same fingertip, or any touching one when it vanished
    const mine = touching.find((p) => p.id === this.pid) ?? (this.lostAt !== null ? touching[0] : undefined);
    if (mine) {
      this.pid = mine.id; this.lostAt = null;
      this.drag.x = mine.x; this.drag.y = mine.y; this.drag.hover = squareAt(mine.x, mine.y);
      return { drag: this.drag, events };
    }
    this.lostAt ??= now;
    if (now - this.lostAt < this.cfg.graceMs) return { drag: this.drag, events };

    // the finger came off the table: drop where it last was
    const d = this.drag, to = d.hover;
    if (to && to !== d.from && d.legal.includes(to)) {
      const lastRank = to[1] === "8" || to[1] === "1";
      const promotion = d.piece === "p" && lastRank ? this.cfg.promotion : undefined;
      let san = "";
      try { san = new Chess(fen).move({ from: d.from, to, promotion }).san; } catch { /* the position moved on */ }
      this.reset();
      events.push({ type: "piece-drop", t: now, data: { from: d.from, to, promotion, san, uci: d.from + to + (promotion ?? "") } });
      return { drag: null, events };
    }
    cancel(to ? (to === d.from ? "put back" : "illegal square") : "off the board");
    return { drag: null, events };
  }
}
