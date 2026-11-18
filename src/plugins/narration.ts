import { bus, pushLog } from "../core/bus";
import type { ExperienceEvent } from "../core/events";
import type { NodeSpec, Plugin } from "../core/types";
import { Narrator, type NarrationLine } from "../narrator/narrator";
import { commentate, LLM_DEFAULT_MODEL } from "../narrator/llm";
import { ELEVENLABS_DEFAULTS, speak as speak_, type VoiceSettings } from "../narrator/voice";

interface NarState { n: Narrator; lines: NarrationLine[] }
/** Newest lines at the bottom, wrapped to the width; as many as fit, so an expanded node shows more history. */
const showLines = (ctx: CanvasRenderingContext2D, w: number, h: number, ls: NarrationLine[]) => {
  ctx.fillStyle = "#07090d"; ctx.fillRect(0, 0, w, h);
  const fs = Math.max(10.5, Math.min(16, h / 12)), lh = fs + 4.5; ctx.font = `${fs}px system-ui`;
  const rows: { c: string; t: string }[] = [];
  for (const l of ls) {
    const c = l.speaker === "A" ? "#7fd4ff" : "#ffb86b"; let cur = "";
    for (const word of `${l.name}: ${l.text}`.split(" ")) {
      const next = cur ? `${cur} ${word}` : word;
      if (cur && ctx.measureText(next).width > w - 10) { rows.push({ c, t: cur }); cur = word; } else cur = next;
    }
    if (cur) rows.push({ c, t: cur });
  }
  const fit = Math.max(1, Math.floor((h - 6) / lh));
  rows.slice(-fit).forEach((r, k) => { ctx.fillStyle = r.c; ctx.fillText(r.t, 5, 4 + fs + k * lh); });
};
const narrator: NodeSpec<NarState> = {
  type: "narration.narrator", title: "Narrator", category: "Narration",
  inputs: [{ id: "events", type: "event" }, { id: "events2", type: "event" }, { id: "events3", type: "event" }, { id: "events4", type: "event" }],
  outputs: [{ id: "lines", type: "text" }],
  params: [
    { id: "voices", kind: "select", label: "Commentators", options: ["1", "2"], value: "2" },
    { id: "nameA", kind: "text", label: "Voice A", value: "Jean" },
    { id: "nameB", kind: "text", label: "Voice B", value: "Margot" },
  ],
  previewSize: [200, 70],
  init: () => ({ n: new Narrator(), lines: [] }),
  process(i, { params, state, span }) {
    state.n.cfg.voices = params.voices === "1" ? 1 : 2;
    state.n.cfg.names = [String(params.nameA), String(params.nameB)];
    const evs = [...(i.events ?? []), ...(i.events2 ?? []), ...(i.events3 ?? []), ...(i.events4 ?? [])] as ExperienceEvent[];
    const lines = evs.length ? span("narrate events", () => state.n.handle(evs)) : [];
    if (lines.length) { state.lines.push(...lines); state.lines = state.lines.slice(-30); pushLog(bus.lines, lines); }
    return { lines };
  },
  preview: (ctx, w, h, s) => showLines(ctx, w, h, s.lines),
};

interface AiState { lines: NarrationLine[]; ready: NarrationLine[]; history: string[]; inflight: number }
/** Optional AI commentator: rewrites the Narrator's lines with OpenAI. Without a key (or when off) it passes them through, and they also play if a request fails or is too slow. */
const aiNarrator: NodeSpec<AiState> = {
  type: "narration.ai", title: "AI commentary (OpenAI)", category: "Narration",
  inputs: [{ id: "lines", type: "text" }, { id: "events", type: "event" }, { id: "events2", type: "event" }, { id: "events3", type: "event" }, { id: "events4", type: "event" }],
  outputs: [{ id: "lines", type: "text" }],
  params: [
    { id: "provider", kind: "select", label: "Commentary engine", options: ["builtin", "openai"], value: "openai" },
    { id: "aiKey", kind: "text", label: "OpenAI API key", value: "" },
    { id: "aiModel", kind: "text", label: "OpenAI model", value: LLM_DEFAULT_MODEL },
    { id: "voices", kind: "select", label: "Commentators", options: ["1", "2"], value: "2" },
    { id: "nameA", kind: "text", label: "Voice A", value: "Jean" },
    { id: "nameB", kind: "text", label: "Voice B", value: "Margot" },
  ],
  previewSize: [200, 70],
  init: () => ({ lines: [], ready: [], history: [], inflight: 0 }),
  process(i, { params, state }) {
    const base = (i.lines ?? []) as NarrationLine[];
    const evs = [...(i.events ?? []), ...(i.events2 ?? []), ...(i.events3 ?? []), ...(i.events4 ?? [])] as ExperienceEvent[];
    for (const e of evs) { const san = (e.data as any)?.san; if (san && (e.type === "move" || e.type === "capture" || e.type === "castle" || e.type === "promotion")) state.history.push(san); }
    state.history = state.history.slice(-40);
    const key = String(params.aiKey ?? "").trim();
    const lines = state.ready.splice(0);
    if (params.provider !== "builtin" && key) {
      if (base.length) {
        if (state.inflight >= 2) lines.push(...base);
        else {
          state.inflight++;
          const prio = Math.max(...base.map((l) => l.priority));
          commentate(evs, state.history, { apiKey: key, model: String(params.aiModel || LLM_DEFAULT_MODEL), names: [String(params.nameA), String(params.nameB)], voices: params.voices === "1" ? 1 : 2 }, prio)
            .catch(() => base).then((ls) => { state.ready.push(...ls); }).finally(() => { state.inflight--; });
        }
      }
    } else lines.push(...base);
    if (lines.length) { state.lines.push(...lines); state.lines = state.lines.slice(-30); }
    return { lines };
  },
  preview: (ctx, w, h, s) => showLines(ctx, w, h, s.lines),
};

interface SpeakState { enabled: boolean }
const speak: NodeSpec<SpeakState> = {
  type: "narration.speech", title: "Speech (TTS)", category: "Narration",
  inputs: [{ id: "lines", type: "text" }], outputs: [],
  params: [
    { id: "enabled", kind: "bool", label: "Speak aloud", value: true },
    { id: "volume", kind: "number", label: "Volume", min: 0, max: 1, step: 0.05, value: 0.9 },
    { id: "provider", kind: "select", label: "Voice engine", options: ["browser", "elevenlabs"], value: "browser" },
    { id: "browserA", kind: "text", label: "Browser voice A", value: "" },
    { id: "browserB", kind: "text", label: "Browser voice B", value: "" },
    { id: "apiKey", kind: "text", label: "ElevenLabs API key", value: "" },
    { id: "voiceIdA", kind: "text", label: "ElevenLabs voice ID A", value: ELEVENLABS_DEFAULTS.voiceIdA },
    { id: "voiceIdB", kind: "text", label: "ElevenLabs voice ID B", value: ELEVENLABS_DEFAULTS.voiceIdB },
    { id: "model", kind: "text", label: "ElevenLabs model", value: ELEVENLABS_DEFAULTS.model },
  ],
  init: () => ({ enabled: true }),
  process({ lines }, { params }) {
    if (!params.enabled) return;
    const s: VoiceSettings = {
      provider: params.provider === "elevenlabs" ? "elevenlabs" : "browser", volume: Number(params.volume),
      browserA: String(params.browserA ?? ""), browserB: String(params.browserB ?? ""),
      apiKey: String(params.apiKey ?? ""), voiceIdA: String(params.voiceIdA ?? ""), voiceIdB: String(params.voiceIdB ?? ""), model: String(params.model ?? ""),
    };
    for (const l of (lines as NarrationLine[]) ?? []) speak_(l.text, l.speaker, s, l.priority >= 3);
  },
};

/** TTS with two distinct voices (browser or ElevenLabs); critical lines cut the current utterance. */
export const speakLine = (text: string, voice: "A" | "B", volume: number, interrupt = false) =>
  speak_(text, voice, { provider: "browser", volume, browserA: "", browserB: "", apiKey: "", voiceIdA: "", voiceIdB: "", model: "" }, interrupt);

export const narrationPlugin: Plugin = { id: "narration", name: "Narration", register: (r) => { r.register(narrator); r.register(aiNarrator); r.register(speak); } };
