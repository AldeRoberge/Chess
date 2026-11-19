import { bus } from "../../core/bus";
import { obj, str, type ToolGroup } from "./shared";

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((r) => { const t = setTimeout(r, ms); signal.addEventListener("abort", () => { clearTimeout(t); r(); }, { once: true }); });

/** Things that take time or involve the person: following the game, asking a question. */
export const liveTools: ToolGroup = () => [
  { name: "wait_for_event", risk: "read", label: { doing: "Waiting for the game", done: "Got an event" }, description: "Wait (async) until the next matching game event happens, e.g. the next move, a capture, or mate, then return it. Gives up after timeout_s (max 45). Use it to follow the game live or to confirm a change worked.",
    parameters: obj({ types: { type: "array", items: str("event type, e.g. move, capture, mate, illegal"), description: "empty = any event" }, timeout_s: { type: "number", description: "default 20" } }),
    run: async (a, ctx) => {
      const want: string[] = Array.isArray(a.types) ? a.types : [], limit = Math.min(45, Math.max(0.1, Number(a.timeout_s) || 20)) * 1000;
      const from = bus.events.reduce((m, e) => Math.max(m, e.t), -Infinity), t0 = Date.now();
      while (Date.now() - t0 < limit) {
        if (ctx.signal.aborted) throw new DOMException("Stopped", "AbortError");
        const hit = bus.events.find((e) => e.t > from && (!want.length || want.includes(e.type)));
        if (hit) return { event: { type: hit.type, data: hit.data }, waited_s: Math.round((Date.now() - t0) / 100) / 10, game: bus.game ? { fen: bus.game.fen, turn: bus.game.turn, ply: bus.game.ply } : null };
        await sleep(150, ctx.signal); // wakes at once on Stop
      }
      return { timed_out: true, waited_s: limit / 1000, game: bus.game ? { fen: bus.game.fen, ply: bus.game.ply } : null };
    } },

  { name: "ask_user", risk: "read", label: { doing: "Asking you", done: "You answered" }, description: "Ask the person to choose between 2 to 4 short options (they may also type their own answer). Use only for a genuine fork you cannot resolve from the state.",
    parameters: obj({ question: str("one short question"), options: { type: "array", items: str("a short option"), minItems: 2, maxItems: 4 } }, ["question", "options"]),
    run: async (a, ctx) => ({ answer: await ctx.choose(String(a.question), (Array.isArray(a.options) ? a.options : []).slice(0, 4).map(String)) }) },
];
