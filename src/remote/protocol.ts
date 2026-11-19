/**
 * What the computer running the table (the host) and a phone (a client) say to each other, through the relay in relay.ts.
 * The host pushes a RemoteState a few times a second and answers commands; clients poll it. Nothing here touches the DOM or Node.
 */
import { Chess } from "chess.js";

/** What a move sent from the phone does on the host. */
export type PlayMode =
  /** The virtual table is the board: the virtual hand plays the move and the tracker follows it. */
  | "virtual"
  /** A real board: the move is shown on the host screen and projector as an arrow, and a person plays it on the board. */
  | "hint"
  /** Nobody can play right now (game over, or it is the bot's turn). */
  | "off";

export interface RemoteCamera { id: string; online: boolean; quality: number; hasFrame: boolean }

export interface RemoteState {
  setupMoves?: { from: string; to: string; code: string }[];
  calibration?: import("../vision/calibration").CalibrationView | null;
  v: 1;
  /** Host clock (ms since epoch) when this was built. */
  t: number;
  phase: string;
  /** Tracker status: pending, synced, lifted, illegal, moved. */
  status: string;
  fen: string;
  turn: "w" | "b";
  ply: number;
  over: boolean;
  /** How the game ended in words, such as "Checkmate. White wins."; null while it is going on. */
  result?: string | null;
  /** Every move so far in standard notation, from the first. */
  moves: string[];
  last: { from: string; to: string; san: string } | null;
  hint: { from: string; to: string } | null;
  /** How sure the tracker is of the position, 0 to 1. */
  fidelity: number;
  cameras: RemoteCamera[];
  /** The latest narration lines, oldest first. */
  lines: { name: string; text: string }[];
  play: PlayMode;
  /** The outcome of the last move sent from a phone, so every phone can show it. */
  notice: { text: string; ok: boolean; at: number } | null;
  /** Formatted clock times when the host is publishing a clock; null if there is none. */
  clocks: { white: string; black: string; running: "w" | "b" | null } | null;
}

export interface RemoteMove { type: "move"; from: string; to: string; promotion?: "q" | "r" | "b" | "n" }
export type CalibrationCommand = { type: "calibrate"; action: "start" | "capture" | "apply" | "stop" | "retry"; session?: string; step?: number };
export type RemoteCommand = CalibrationCommand | RemoteMove | { type: "resign" } | { type: "draw" } | { type: "takeback" };

const SQUARE = /^[a-h][1-8]$/;
const ENDING = new Set(["resign", "draw", "takeback"]);

/** Reads an untrusted command body. Returns null for anything that is not a well-formed move, resignation, draw, or takeback. */
export function parseCommand(raw: unknown): RemoteCommand | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (c.type === "calibrate") {
    if (!["start", "capture", "apply", "stop", "retry"].includes(String(c.action))) return null;
    if (c.action !== "start" && (typeof c.session !== "string" || c.session.length > 64 || !Number.isInteger(c.step) || Number(c.step) < 0 || Number(c.step) > 32)) return null;
    return { type: "calibrate", action: c.action as CalibrationCommand["action"], ...(c.action === "start" ? {} : { session: c.session as string, step: c.step as number }) };
  }
  if (typeof c.type === "string" && ENDING.has(c.type)) return { type: c.type as "resign" | "draw" | "takeback" };
  if (c.type !== "move" || typeof c.from !== "string" || typeof c.to !== "string") return null;
  if (!SQUARE.test(c.from) || !SQUARE.test(c.to)) return null;
  const promotion = c.promotion;
  if (promotion !== undefined && !(typeof promotion === "string" && "qrbn".includes(promotion) && promotion.length === 1)) return null;
  return { type: "move", from: c.from, to: c.to, ...(promotion ? { promotion: promotion as RemoteMove["promotion"] } : {}) };
}

/** One row of the score sheet: a move number and what each side played (null while it has not happened). */
export interface SheetRow { n: number; white: string | null; black: string | null }

/** The moves laid out as a paper score sheet: one row per full move. */
export function scoreSheet(moves: readonly string[]): SheetRow[] {
  const rows: SheetRow[] = [];
  for (let i = 0; i < moves.length; i += 2) rows.push({ n: i / 2 + 1, white: moves[i], black: moves[i + 1] ?? null });
  return rows;
}

/** The position after `ply` half-moves of `moves`. Stops early at the first move that does not apply, so a bad list never throws. */
export function positionAt(moves: readonly string[], ply: number): { fen: string; applied: number; last: { from: string; to: string } | null } {
  const g = new Chess();
  let last: { from: string; to: string } | null = null, applied = 0;
  for (const san of moves.slice(0, Math.max(0, ply))) {
    try { const m = g.move(san); last = { from: m.from, to: m.to }; applied++; } catch { break; }
  }
  return { fen: g.fen(), applied, last };
}

/** Legal destination squares for the piece on `from` in `fen`. */
export function targetsFrom(fen: string, from: string): string[] {
  try { return new Chess(fen).moves({ square: from as never, verbose: true }).map((m) => m.to); } catch { return []; }
}

/** Does moving `from`→`to` in `fen` need a promotion piece? */
export function needsPromotion(fen: string, from: string, to: string): boolean {
  try { return new Chess(fen).moves({ square: from as never, verbose: true }).some((m) => m.to === to && !!m.promotion); } catch { return false; }
}

/** How a finished game ended, read from its final position; null while it is still going. Resignations and agreed draws are not in the position, so the host words those itself. */
export function resultText(fen: string): string | null {
  try {
    const g = new Chess(fen);
    if (g.isCheckmate()) return `Checkmate. ${g.turn() === "w" ? "Black" : "White"} wins.`;
    if (g.isStalemate()) return "Stalemate. It is a draw.";
    if (g.isInsufficientMaterial()) return "Draw: not enough pieces to mate.";
    if (g.isThreefoldRepetition()) return "Draw by repetition.";
    if (g.isDraw()) return "Draw.";
    return null;
  } catch { return null; }
}

/** Display name of a side. */
export const sideName = (c: "w" | "b") => (c === "w" ? "White" : "Black");

/** The address of the phone page on a host reachable at `origin`, with the join code filled in. */
export const joinUrl = (origin: string, code: string, base = "/") => `${origin}${base}#/remote?code=${encodeURIComponent(code)}`;

/** Reads the join code out of a hash such as `#/remote?code=1234`. */
export function codeFromHash(hash: string): string {
  const q = hash.split("?")[1] ?? "";
  return new URLSearchParams(q).get("code")?.trim() ?? "";
}

/** The phone page is shown for `#/remote` (with or without a code). */
export const isRemoteHash = (hash: string) => /^#\/remote(\?|\/|$)/.test(hash);
