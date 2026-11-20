import { Chess } from "chess.js";
import { sqName, type BoardBelief } from "../vision/types";

const NAME: Record<string, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
const colourName = (c: "w" | "b") => (c === "w" ? "white" : "black");
const pct = (v: number) => `${Math.round(Math.min(1, Math.max(0, v)) * 100)}%`;

/** One square where the detector and the game disagree. */
export interface MismatchItem {
  square: string;
  kind: "extra" | "missing" | "colour";
  /** How sure the detector is of what it sees on that square (0..1). */
  conf: number;
  /** A full sentence: "The detector thinks there is an extra white piece on e4, but the game says it is empty (87% sure)." */
  sentence: string;
  /** The same in a few words, for a small label: "e4: extra white piece (87%)". */
  short: string;
}

export interface Mismatch {
  /** Counts as words: "1 extra piece, 1 missing piece". Empty when nothing disagrees. */
  summary: string;
  /** One sentence on what is probably going on. */
  hint: string;
  items: MismatchItem[];
}

/**
 * Says in plain English how the detector's picture of the board differs from the position the game expects: an extra piece,
 * a missing one, or a piece of the wrong colour, square by square, each with how sure the detector is of what it sees.
 * `diff` is the list of disagreeing squares (0 = a8 .. 63 = h1); pieces the game expects come from `fen`.
 */
export function explainMismatch(fen: string, diff: number[], b: BoardBelief | null): Mismatch {
  let game: Chess;
  try { game = new Chess(fen); } catch { return { summary: "", hint: "", items: [] }; }
  const board = game.board(), items: MismatchItem[] = [];
  for (const i of diff) {
    const want = board[Math.floor(i / 8)]?.[i % 8] ?? null, sq = sqName(i);
    const sees = b && b.occ[i] > 0.5 ? (b.white[i] > 0.5 ? "w" : "b") as "w" | "b" : null;
    // confidence in what is seen: for a piece, how sure it is there; for an empty square, how sure the square is clear
    const conf = b ? b.conf[i] ?? 0 : 0;
    if (!want && sees) {
      items.push({ square: sq, kind: "extra", conf, sentence: `The detector thinks there is an extra ${colourName(sees)} piece on ${sq}, but the game says that square is empty (${pct(conf)} sure).`, short: `${sq}: extra ${colourName(sees)} piece (${pct(conf)})` });
    } else if (want && !sees) {
      const what = `${colourName(want.color)} ${NAME[want.type]}`;
      items.push({ square: sq, kind: "missing", conf, sentence: `The detector thinks ${sq} is empty, but the game has a ${what} there, so a piece looks missing (${pct(conf)} sure).`, short: `${sq}: missing ${what} (${pct(conf)})` });
    } else if (want && sees && want.color !== sees) {
      items.push({ square: sq, kind: "colour", conf, sentence: `The detector thinks the piece on ${sq} is ${colourName(sees)}, but the game has a ${colourName(want.color)} ${NAME[want.type]} there (${pct(conf)} sure).`, short: `${sq}: looks ${colourName(sees)}, not ${colourName(want.color)} (${pct(conf)})` });
    }
  }
  const n = (k: MismatchItem["kind"]) => items.filter((x) => x.kind === k).length;
  const part = (k: MismatchItem["kind"], one: string, many: string) => (n(k) ? `${n(k)} ${n(k) === 1 ? one : many}` : "");
  const summary = [part("extra", "extra piece", "extra pieces"), part("missing", "missing piece", "missing pieces"), part("colour", "wrong colour", "wrong colours")].filter(Boolean).join(", ");
  let hint = "";
  if (items.length >= 12) hint = "That many differences usually means the camera grid is off the board, or the board is turned, rather than pieces actually moved.";
  else if (n("colour") >= 6) hint = "Most colours are reversed: the corners may be turned half way (white and black swapped).";
  else if (n("extra") && !n("missing") && !n("colour")) hint = "Something extra is on the board: a hand, a captured piece left on a square, or a shadow.";
  else if (n("missing") && !n("extra") && !n("colour")) hint = "A piece is missing from its square: it may be in a hand, off the board, or hidden from the camera.";
  else if (items.length) hint = "Put the board back to match the game, or press Reset to start position if the game was set up again.";
  return { summary, hint, items };
}
