import type { Square } from "chess.js";
import { Chess } from "chess.js";
import { bus, pushLog } from "../core/bus";
import type { ExperienceEvent } from "../core/events";
import type { NodeSpec, Plugin } from "../core/types";
import type { TrackResult } from "../chess/tracker";
import type { DirectorOut } from "../experience/director";
import { virtualTable } from "../sim/virtualTable";
import { sqIndex } from "../vision/types";

type Step = "idle" | "mistake" | "noticed";
interface FumbleState {
  seed: number; step: Step; at: number; fen: string;
  /** the position already answered: the tracker takes a moment to see the move, and nobody plays it twice */
  acted: string;
  /** after being told off, the next attempt is careful */
  careful: boolean;
  /** the move the online bot asked for, and where the piece really went */
  ask: { from: string; to: string; san: string } | null; wrong: string;
  mistakes: number;
}

const placement = (fen: string) => fen.split(" ")[0];
const rnd = (s: FumbleState) => { s.seed = (s.seed * 1103515245 + 12345) & 0x7fffffff; return s.seed / 0x80000000; };

/** A square next to `to` that is empty and is not the right one: where a distracted hand puts the piece down. */
export function wrongSquare(game: Chess, from: string, to: string, pick: number): string | null {
  const f = to.charCodeAt(0) - 97, r = Number(to[1]) - 1, out: string[] = [];
  for (const [df, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const nf = f + df, nr = r + dr;
    if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
    const sq = String.fromCharCode(97 + nf) + (nr + 1);
    if (sq !== from && !game.get(sq as Square)) out.push(sq);
  }
  return out.length ? out[Math.floor(pick * out.length) % out.length] : null;
}

/**
 * The "human" in a human-versus-online-bot game, played by a stand-in. The bot lives online, so the human has to move its pieces for it:
 * when the bot's move shows up as a hint, the human carries that piece. Sometimes they put it down on the wrong square; the tracker
 * flags the board, the human is asked to reconcile, puts the piece back and plays the bot's move properly. The human's own pieces
 * are moved without fuss, by a plain legal-move picker.
 */
const fumbler: NodeSpec<FumbleState> = {
  type: "sim.fumbler", title: "Fake Human (moves the bot's pieces)", category: "Tracking",
  desc: "Stands in for a person playing against an online bot. They play their own moves, and carry out the bot's moves on the board when asked, but sometimes put the piece down on the wrong square. They are then told to put it right.",
  inputs: [{ id: "game", type: "game" }, { id: "director", type: "any" }],
  outputs: [{ id: "events", type: "event" }],
  params: [
    { id: "errorRate", kind: "number", label: "Chance of a wrong square", min: 0, max: 1, step: 0.05, value: 0.4 },
    { id: "thinkMs", kind: "number", label: "Reaction time (ms)", min: 200, max: 6000, step: 100, value: 1500 },
    { id: "seed", kind: "number", label: "Random seed", min: 1, max: 99999, step: 1, value: 7 },
  ],
  init: (): FumbleState => ({ seed: 7, step: "idle", at: 0, fen: "", acted: "", careful: false, ask: null, wrong: "", mistakes: 0 }),
  process({ game, director }, { params, state, now, setFidelity }) {
    const g = game as TrackResult | undefined, d = director as DirectorOut | undefined, events: ExperienceEvent[] = [];
    const t = virtualTable;
    t.seated = true; bus.outline = true;
    if (state.fen === "" && state.step === "idle") state.seed = Number(params.seed);
    // before the game starts, the table must hold the start position the tracker expects (a table left over from an earlier game would read as illegal)
    if (g && d && d.phase !== "game" && g.ply === 0 && !t.busy && placement(t.game.fen()) !== placement(g.fen)) t.reset();
    if (!g || !d || d.phase !== "game" || g.over) { bus.reconcile = null; state.step = "idle"; state.ask = null; setFidelity(null); return { events }; }
    if (t.busy) return { events };
    const think = Number(params.thinkMs), bot = bus.botColor;
    if (state.step === "idle") {
      if (g.status !== "synced" && g.status !== "moved") return { events };
      if (g.fen === state.acted) return { events };
      if (state.fen !== g.fen) { state.fen = g.fen; state.at = now; } // a new position: start thinking about it
      if (now - state.at < think) return { events };
      if (g.turn === bot) {
        const h = bus.engineHint;
        if (!h) return { events };
        const c = t.game, m = c.moves({ verbose: true }).find((x) => x.from === h.from && x.to === h.to);
        if (!m) return { events };
        state.ask = { from: h.from, to: h.to, san: m.san };
        const bad = !state.careful && rnd(state) < Number(params.errorRate) ? wrongSquare(c, h.from, h.to, rnd(state)) : null;
        if (bad && t.relocate(sqIndex(h.from), sqIndex(bad), now)) {
          state.step = "mistake"; state.wrong = bad; state.at = now + 1900; state.mistakes++;
          events.push({ type: "fumble", t: now, data: { ...state.ask, wrong: bad } });
        } else { t.play(m.san, now); state.acted = g.fen; state.ask = null; state.careful = false; }
      } else if (bot) { // the human's own move: any legal one, captures first
        const moves = t.game.moves({ verbose: true });
        if (moves.length) { const caps = moves.filter((x) => x.captured), pool = caps.length && rnd(state) < 0.5 ? caps : moves; t.play(pool[Math.floor(rnd(state) * pool.length) % pool.length].san, now); state.acted = g.fen; }
      }
    } else if (state.step === "mistake") {
      if (now >= state.at) { // the board has settled on the wrong arrangement: the cameras will have flagged it by now
        bus.reconcile = { from: state.ask!.from, to: state.ask!.to, wrong: state.wrong };
        state.step = "noticed"; state.at = now + think;
        events.push({ type: "reconcile", t: now, data: bus.reconcile });
      }
    } else if (state.step === "noticed") {
      if (now >= state.at && state.ask) { // put it back where it was, then play the bot's move for real
        const a = state.ask;
        if (t.relocate(sqIndex(state.wrong), sqIndex(a.from), now)) {
          state.step = "idle"; state.fen = ""; state.acted = ""; state.careful = true; state.at = now + 1900; state.wrong = "";
          bus.reconcile = null;
          // the correct move follows once the piece is home: the idle step picks the hint up again
          state.ask = null;
        }
      }
    }
    pushLog(bus.events, events);
    setFidelity(null);
    return { events };
  },
  preview(ctx, w, h, s) {
    ctx.fillStyle = "#04101c"; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = s.step === "idle" ? "#b9c6e4" : "#ffd36b"; ctx.font = `500 12px "Chakra Petch",system-ui,sans-serif`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.fillText(s.step === "idle" ? `human ready · ${s.mistakes} slips` : s.step === "mistake" ? `oops, ${s.wrong}…` : `fixing ${s.wrong}`, 6, h / 2 + 4);
  },
  dispose() { bus.reconcile = null; bus.outline = false; },
};

export const fumblerPlugin: Plugin = { id: "fumbler", name: "Fake human", register: (r) => { r.register(fumbler); } };
