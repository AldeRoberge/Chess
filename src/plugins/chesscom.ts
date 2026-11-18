import { bus, pushLog } from "../core/bus";
import type { ExperienceEvent } from "../core/events";
import type { NodeSpec } from "../core/types";
import type { TrackResult } from "../chess/tracker";
import type { DirectorOut } from "../experience/director";
import { API, nextRemoteMove, pickGame, type RemoteGame } from "../chess/chesscom";
import { sqIndex, sqName } from "../vision/types";
import { drawBoard, withDetail } from "./shared";
import { boardHover, visualSize } from "./hover";

type Tone = "idle" | "wait" | "move" | "ok" | "warn" | "err";
interface ComState { game: RemoteGame | null; info: string; tone: Tone; lastPoll: number; busy: boolean; hintFen: string; announced: string; fen: string; hint: { from: string; to: string } | null; san: string; lastPgn: string }

const TONES: Record<Tone, string> = { idle: "#8fa3c8", wait: "#8fa3c8", move: "#3cffa0", ok: "#35e0b4", warn: "#ffb347", err: "#ff5a6e" };

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

/**
 * Follows a chess.com game and projects the next move onto the physical board.
 * chess.com's public API is read-only and lists daily games only, so a pasted PGN (`pgn` param) is accepted too:
 * it is the way to follow a live game, and the fallback when the API cannot be reached from the browser.
 */
export const chesscomNode: NodeSpec<ComState> = {
  type: "game.chesscom", title: "Chess.com Opponent", category: "Game",
  inputs: [{ id: "game", type: "game" }, { id: "director", type: "any" }],
  outputs: [{ id: "events", type: "event" }],
  params: [
    { id: "username", kind: "text", label: "chess.com username", value: "" },
    { id: "gameUrl", kind: "text", label: "Game URL", value: "" },
    { id: "pgn", kind: "text", label: "Paste PGN", value: "" },
    { id: "color", kind: "select", label: "You play", options: ["w", "b"], value: "w" },
    { id: "poll", kind: "number", label: "Check every (s)", min: 3, max: 60, step: 1, value: 8 },
  ],
  previewSize: [220, 250],
  init: () => ({ game: null, info: "Enter your chess.com username", tone: "idle", lastPoll: 0, busy: false, hintFen: "", announced: "", fen: "", hint: null, san: "", lastPgn: "" }),
  process({ game, director }, { params, state, now }) {
    const user = String(params.username).trim(), pasted = String(params.pgn).trim();
    if (pasted) {
      if (pasted !== state.lastPgn) {
        state.lastPgn = pasted;
        const g = pickGame({ games: [{ url: "pgn", pgn: pasted, white: params.color === "w" ? "me" : "opponent", black: params.color === "w" ? "opponent" : "me" }] }, "me");
        state.game = g; state.info = g ? "Following the pasted game" : "Could not read that PGN"; state.tone = g ? "ok" : "err";
      }
    } else if (user && !state.busy && now - state.lastPoll >= Number(params.poll) * 1000) {
      state.busy = true; state.lastPoll = now; state.lastPgn = "";
      void fetch(`${API}${encodeURIComponent(user)}/games`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`chess.com answered ${r.status}`))))
        .then((j) => {
          state.game = pickGame(j, user, String(params.gameUrl));
          if (state.game) { state.info = `Playing ${state.game.opponent}`; state.tone = "ok"; } else { state.info = "No daily game in progress. Live games aren't in the chess.com API: paste the PGN instead"; state.tone = "warn"; }
        })
        .catch((e) => { state.game = null; state.info = `Can't reach chess.com (${String(e?.message ?? e)}). Paste the PGN instead`; state.tone = "err"; })
        .finally(() => { state.busy = false; });
    }
    const g = game as TrackResult | undefined, d = director as DirectorOut | undefined, out: ExperienceEvent[] = [];
    state.fen = g?.fen ?? "";
    if (state.hintFen && state.hintFen !== g?.fen) { if (state.hint) bus.engineHint = null; state.hintFen = ""; state.hint = null; state.san = ""; }
    if (state.game && g && d?.phase === "game" && d.mode !== "engine" && g.status === "synced" && !g.over) {
      const step = nextRemoteMove(g.fen, state.game);
      if (step.kind === "move") {
        const m = step.move; state.hintFen = g.fen; state.hint = { from: m.from, to: m.to }; state.san = m.san; bus.engineHint = state.hint;
        if (state.announced !== g.fen) { state.announced = g.fen; out.push({ type: "engine-move", t: now, data: { uci: m.uci, san: m.san, from: m.from, to: m.to, by: m.by, source: "chess.com" } }); }
        state.info = m.by === "opponent" ? `${state.game.opponent} played ${m.san}. Move it on the board` : `Play ${m.san} on the board`; state.tone = "move";
      } else if (step.kind === "synced") {
        const mine = state.game.turn === (state.game.color === "w" ? "white" : "black");
        state.info = mine ? "Your turn: play it here, then on chess.com" : `Waiting for ${state.game.opponent}`; state.tone = mine ? "ok" : "wait";
      } else { state.info = "The board differs from the chess.com game"; state.tone = "warn"; }
    }
    pushLog(bus.events, out);
    return { events: out };
  },
  hover(p, W, H, s) {
    const v = visualSize(W, H, [220, 250]), bh = Math.min(v.w, v.h - 52);
    if (p.x > v.w || p.y > v.h) return null;
    if (p.y > bh) return {
      title: s.info, tag: "chess.com status", color: TONES[s.tone],
      rows: [{ label: "Opponent", value: s.game?.opponent ?? "—" }, { label: "You play", value: s.game ? (s.game.color === "w" ? "white" : "black") : "—" }, { label: "Turn", value: s.game?.turn ?? "—" },
        { label: "Next move", value: s.hint ? `${s.hint.from} → ${s.hint.to}${s.san ? ` (${s.san})` : ""}` : "—" }, { label: "Request", value: s.busy ? "in flight" : "idle" }],
    };
    return boardHover(p, v.w, bh, null, {
      title: "chess.com", fen: s.fen || undefined,
      extra: (sq) => (s.hint && (sqName(sq) === s.hint.from || sqName(sq) === s.hint.to) ? [{ label: "Suggested move", value: sqName(sq) === s.hint.from ? `move from here to ${s.hint.to}` : `move ${s.hint.from} here`, tone: "ok" as const }] : []),
      also: (sq) => (s.hint && sqName(sq) === s.hint.from ? [sqIndex(s.hint.to)] : s.hint && sqName(sq) === s.hint.to ? [sqIndex(s.hint.from)] : []),
      body: () => "The position is the tracked game on your board; the green arrow is the next chess.com move for you to play.",
    });
  },
  preview(ctx, W, H, s) {
    withDetail(ctx, W, H, [220, 250], (w, h) => {
    const bh = Math.min(w, h - 52);
    drawBoard(ctx, w, bh, null, { fen: s.fen || undefined });
    if (s.hint) { // arrow for the move to play
      const sq = bh / 8, ox = (w - sq * 8) / 2, p = (n: string) => { const i = sqIndex(n); return [ox + (i % 8) * sq + sq / 2, Math.floor(i / 8) * sq + sq / 2]; };
      const [ax, ay] = p(s.hint.from), [bx, by] = p(s.hint.to), a = Math.atan2(by - ay, bx - ax), hl = sq * 0.38;
      ctx.fillStyle = "rgba(60,255,160,.3)"; ctx.fillRect(ax - sq / 2, ay - sq / 2, sq, sq); ctx.fillRect(bx - sq / 2, by - sq / 2, sq, sq);
      ctx.strokeStyle = ctx.fillStyle = "rgba(60,255,160,.9)"; ctx.lineWidth = sq * 0.16; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx - Math.cos(a) * hl * 0.6, by - Math.sin(a) * hl * 0.6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx - Math.cos(a - 0.5) * hl, by - Math.sin(a - 0.5) * hl); ctx.lineTo(bx - Math.cos(a + 0.5) * hl, by - Math.sin(a + 0.5) * hl); ctx.closePath(); ctx.fill();
    }
    const y = bh + 6, col = TONES[s.tone];
    ctx.fillStyle = "rgba(255,255,255,.06)"; roundRect(ctx, 4, y, w - 8, h - y - 4, 8); ctx.fill();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(16, y + 15, 4.5, 0, 7); ctx.fill();
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.font = "600 11px system-ui, sans-serif"; ctx.fillStyle = "#e8eefc";
    let line = "", ly = y + 19, n = 0; const room = w - 40;
    for (const wd of s.info.split(" ")) { if (ctx.measureText(line + wd).width > room && n < 2) { ctx.fillText(line, 28, ly); ly += 13; line = ""; n++; } line += wd + " "; }
    ctx.fillText(line, 28, ly);
    }, () => [["status", s.info, TONES[s.tone]], ["opponent", s.game?.opponent ?? "—"], ["you play", s.game ? (s.game.color === "w" ? "white" : "black") : "—"], ["turn", s.game?.turn ?? "—"],
      ["next move", s.hint ? `${s.hint.from} → ${s.hint.to}` : "—"], ["last san", s.san || "—"], ["fen", s.fen || "—"], ["polling", s.busy ? "request in flight" : "idle"]]);
  },
};
