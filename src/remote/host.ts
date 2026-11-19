/**
 * The computer's side of the phone remote: publishes the game to the relay, sends camera pictures while a phone is watching,
 * and turns a move sent from a phone into something that happens at the table.
 */
import { Chess } from "chess.js";
import type { GrayFrame } from "../vision/types";
import type { PlayMode, RemoteCommand, RemoteMove, RemoteState } from "./protocol";

/** The parts of the shared bus the snapshot reads. */
export interface BusView {
  game: { fen: string; turn: "w" | "b"; ply: number; over: boolean; status: string; history: string[]; fidelity: number; last: { from: string; to: string; san: string } | null } | null;
  director: { phase: string } | null;
  engineHint: { from: string; to: string } | null;
  botColor: "w" | "b" | null;
  cameras: { id: string; online: boolean; quality: number }[];
  lines: { name: string; text: string }[];
}

/** What a move from a phone can do right now: play it on the virtual table, show it as an arrow for a real board, or nothing. */
export function playMode(b: BusView, virtualBoard: boolean): PlayMode {
  if (!b.game || b.game.over) return "off";
  if (b.botColor && b.botColor === b.game.turn) return "off";
  return virtualBoard ? "virtual" : "hint";
}

/** The arrow a phone's move left on a real board, and the position it was made in; it goes once the position changes. */
let own: { hint: { from: string; to: string }; fen: string } | null = null;
/** Takes a phone's arrow off once a person has played something. Another source's hint (the engine's) is never touched. */
export function dropStaleHint(b: Pick<BusView, "game" | "engineHint">) {
  if (own && b.engineHint !== own.hint) own = null;
  else if (own && b.game && b.game.fen !== own.fen) { b.engineHint = null; own = null; }
}

export function snapshot(b: BusView, opts: { now: number; virtualBoard: boolean; framed: ReadonlySet<string>; notice: RemoteState["notice"] }): RemoteState {
  dropStaleHint(b);
  const g = b.game;
  return {
    v: 1, t: opts.now, phase: b.director?.phase ?? "idle", status: g?.status ?? "pending",
    fen: g?.fen ?? new Chess().fen(), turn: g?.turn ?? "w", ply: g?.ply ?? 0, over: g?.over ?? false,
    moves: g ? [...g.history] : [], last: g?.last ? { from: g.last.from, to: g.last.to, san: g.last.san } : null,
    hint: b.engineHint, fidelity: g?.fidelity ?? 0,
    cameras: b.cameras.map((c) => ({ id: c.id, online: c.online, quality: c.quality, hasFrame: opts.framed.has(c.id) })),
    lines: b.lines.slice(-5).map((l) => ({ name: l.name, text: l.text })),
    play: playMode(b, opts.virtualBoard), notice: opts.notice,
  };
}

/** The virtual table, as far as a remote move needs it. */
export interface TableLike { busy: boolean; play(move: string, now: number): boolean }

/**
 * Carries out one move from a phone. On the virtual table the virtual hand plays it; on a real board it becomes the green arrow
 * (and a line for the narrator's log) and a person plays it. Always answers with a sentence the phone can show.
 */
export function applyRemoteMove(cmd: RemoteMove, ctx: { mode: PlayMode; fen: string; bus: { engineHint: { from: string; to: string } | null }; table: TableLike; now: number; botTurn: boolean }): { ok: boolean; text: string } {
  if (ctx.mode === "off") return { ok: false, text: ctx.botTurn ? "It is the bot's turn. Wait for its move." : "No game is being played right now." };
  let move; try { move = new Chess(ctx.fen).move({ from: cmd.from, to: cmd.to, promotion: cmd.promotion ?? "q" }); } catch { move = null; }
  if (!move) return { ok: false, text: `${cmd.from}${cmd.to} is not a legal move here. Pick another.` };
  if (ctx.mode === "virtual") {
    if (ctx.table.busy) return { ok: false, text: "A move is still being played. Try again in a second." };
    if (!ctx.table.play(move.from + move.to + (move.promotion ?? ""), ctx.now)) return { ok: false, text: `The table could not play ${move.san}.` };
    return { ok: true, text: `Playing ${move.san}.` };
  }
  const hint = { from: move.from, to: move.to };
  ctx.bus.engineHint = hint; own = { hint, fen: ctx.fen };
  return { ok: true, text: `${move.san} sent. Play ${move.from} to ${move.to} on the board.` };
}

/** Turns a grayscale camera frame into a small JPEG. Null when the browser cannot draw it. */
export async function encodeFrame(frame: GrayFrame, quality = 0.6): Promise<Blob | null> {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas"); c.width = frame.width; c.height = frame.height;
  const g = c.getContext("2d"); if (!g) return null;
  const img = g.createImageData(frame.width, frame.height);
  for (let i = 0, n = frame.width * frame.height; i < n; i++) { const v = frame.data[i]; img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
  return new Promise((resolve) => c.toBlob((b) => resolve(b), "image/jpeg", quality));
}

export interface HostDeps {
  /** URL prefix of the relay, for example "/remote/". */
  base: string;
  build(framed: ReadonlySet<string>, notice: RemoteState["notice"], now: number): RemoteState;
  frames(): { id: string; frame: GrayFrame }[];
  /** Carries out a phone's command and says what happened. */
  command(c: RemoteCommand, now: number): { ok: boolean; text: string };
  fetchFn?: typeof fetch;
  encode?: (f: GrayFrame) => Promise<Blob | null>;
}

const STATE_MS = 400, FRAME_MS = 1000;

export class RemoteHost {
  /** null until the first probe answers; false when this server has no relay (a static build). */
  available: boolean | null = null;
  code = ""; urls: string[] = []; clients = 0;
  private notice: RemoteState["notice"] = null;
  private framed = new Set<string>();
  private lastState = -Infinity; private lastFrame = -Infinity;
  private busy = { probe: false, state: false, frame: false };
  private fetchFn: typeof fetch;
  constructor(private d: HostDeps) { this.fetchFn = d.fetchFn ?? ((...a) => fetch(...a)); }

  private async probe() {
    if (this.busy.probe) return; this.busy.probe = true;
    try {
      const r = await this.fetchFn(`${this.d.base}host/info`);
      if (r.ok) { const j = await r.json(); this.code = String(j.code ?? ""); this.urls = j.urls ?? []; this.clients = j.clients ?? 0; this.available = true; } else this.available = false;
    } catch { this.available = false; }
    this.busy.probe = false;
  }

  /** Call every animation frame; it paces itself. */
  tick(now: number) {
    if (this.available === null) { void this.probe(); return; }
    if (!this.available) return;
    if (now - this.lastState >= STATE_MS && !this.busy.state) { this.lastState = now; void this.pushState(now); }
    if (this.clients > 0 && now - this.lastFrame >= FRAME_MS && !this.busy.frame) { this.lastFrame = now; void this.pushFrames(); }
  }

  private async pushState(now: number) {
    this.busy.state = true;
    try {
      const body = JSON.stringify(this.d.build(this.framed, this.notice, Date.now()));
      const r = await this.fetchFn(`${this.d.base}host/state`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      if (r.ok) {
        const j = await r.json(); this.clients = j.clients ?? 0; this.code = String(j.code ?? this.code);
        for (const c of (j.commands ?? []) as RemoteCommand[]) { const out = this.d.command(c, now); this.notice = { ...out, at: Date.now() }; }
      }
    } catch { /* the server went away: try again next tick */ }
    this.busy.state = false;
  }

  private async pushFrames() {
    this.busy.frame = true;
    try {
      const enc = this.d.encode ?? encodeFrame;
      for (const { id, frame } of this.d.frames()) {
        const blob = await enc(frame); if (!blob) continue;
        const r = await this.fetchFn(`${this.d.base}host/frame?cam=${encodeURIComponent(id)}`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob });
        if (r.ok) this.framed.add(id);
      }
    } catch { /* ignore: the next second tries again */ }
    this.busy.frame = false;
  }
}
