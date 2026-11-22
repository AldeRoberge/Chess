import { bus, pushLog } from "../core/bus";
import type { ExperienceEvent } from "../core/events";
import type { HoverInfo, ModelInfo, NodeSpec, Plugin } from "../core/types";
import { LANGS, Narrator, type Lang, type NarrationLine } from "../narrator/narrator";
import { effectiveKey } from "../net/vendorFetch";
import { coachSettings } from "../narrator/coachSettings";
import type { Speaker } from "../narrator/coach";

/** Line colours: commentator A, commentator B, the AI opponent. */
export const SPEAKER_COLOR: Record<Speaker, string> = { A: "#7fd4ff", B: "#ffb86b", C: "#b6f37a" };
/** How long the squares of a "this is known as …" line stay lit. */
const INSIGHT_MS = 9000;

/** Language param shared by every narration node; unknown or missing values fall back to French. */
const langParam = { id: "language", kind: "select" as const, label: "Language", options: LANGS, value: "fr" as Lang };
const langOf = (v: unknown): Lang => (v === "en" ? "en" : "fr");
import { commentate, LLM_DEFAULT_MODEL } from "../narrator/llm";
import { chatModelsFrom, fetchOpenAiModelIds, OPENAI_PRICES } from "../narrator/openaiModels";
import { BROWSER_PROVIDER, ELEVENLABS_DEFAULTS, ELEVENLABS_PROVIDER, elevenVoiceLabel, fetchElevenVoices, speak as speak_, TTS_PROVIDERS, type ElevenVoice, type VoiceSettings } from "../narrator/voice";

interface NarState { n: Narrator; lines: NarrationLine[]; started: boolean }
/** Newest lines at the bottom, wrapped to the width; as many as fit, so an expanded node shows more history. */
function layoutLines(measure: (t: string) => number, w: number, h: number, ls: NarrationLine[]) {
  const fs = Math.max(10.5, Math.min(16, h / 12)), lh = fs + 4.5;
  const rows: { c: string; t: string; li: number }[] = [];
  ls.forEach((l, li) => {
    const c = SPEAKER_COLOR[l.speaker] ?? SPEAKER_COLOR.A; let cur = "";
    for (const word of `${l.name}: ${l.text}`.split(" ")) {
      const next = cur ? `${cur} ${word}` : word;
      if (cur && measure(next) > w - 10) { rows.push({ c, t: cur, li }); cur = word; } else cur = next;
    }
    if (cur) rows.push({ c, t: cur, li });
  });
  const fit = Math.max(1, Math.floor((h - 6) / lh));
  return { fs, lh, shown: rows.slice(-fit) };
}
const showLines = (ctx: CanvasRenderingContext2D, w: number, h: number, ls: NarrationLine[]) => {
  ctx.fillStyle = "#07090d"; ctx.fillRect(0, 0, w, h);
  const fs0 = Math.max(10.5, Math.min(16, h / 12)); ctx.font = `${fs0}px system-ui`;
  const { fs, lh, shown } = layoutLines((t) => ctx.measureText(t).width, w, h, ls);
  shown.forEach((r, k) => { ctx.fillStyle = r.c; ctx.fillText(r.t, 5, 4 + fs + k * lh); });
};
let scratch: CanvasRenderingContext2D | null = null;
/** Card for the spoken line under the pointer: who says it, how important it is, and the full text. */
const lineHover = (title: string) => (p: { x: number; y: number }, w: number, h: number, s: { lines: NarrationLine[] }): HoverInfo | null => {
  scratch ??= document.createElement("canvas").getContext("2d");
  if (!scratch || !s.lines.length) return { title, tag: "no lines yet", body: "Nothing has been said yet." };
  scratch.font = `${Math.max(10.5, Math.min(16, h / 12))}px system-ui`;
  const { lh, shown } = layoutLines((t) => scratch!.measureText(t).width, w, h, s.lines);
  const k = Math.floor((p.y - 4) / lh), row = shown[Math.max(0, Math.min(shown.length - 1, k))];
  if (!row) return null;
  const l = s.lines[row.li], first = shown.findIndex((r) => r.li === row.li), last = shown.length - 1 - [...shown].reverse().findIndex((r) => r.li === row.li);
  const PRIO = ["chatter", "normal", "important", "critical"];
  return {
    title: l.name, tag: `${title} · ${l.speaker === "C" ? "opponent" : `voice ${l.speaker}`}`, color: SPEAKER_COLOR[l.speaker], body: l.text,
    rows: [
      { label: "Priority", value: `${PRIO[l.priority] ?? l.priority} (${l.priority}/3)`, bar: l.priority / 3, tone: l.priority >= 3 ? "bad" : l.priority === 2 ? "warn" : undefined },
      { label: "Said at", value: `${Math.round(l.t / 1000)} s` },
      { label: "Line", value: `${row.li + 1} of ${s.lines.length}` },
      { label: "Length", value: `${l.text.length} characters · ${l.text.split(/\s+/).length} words` },
    ],
    mark: (ctx) => {
      ctx.save(); ctx.fillStyle = "rgba(255,228,92,.14)"; ctx.fillRect(1, 4 + first * lh - 1, w - 2, (last - first + 1) * lh); ctx.strokeStyle = "#ffe45c"; ctx.lineWidth = 1; ctx.strokeRect(1.5, 4 + first * lh - 0.5, w - 3, (last - first + 1) * lh); ctx.restore();
    },
  };
};
const narrator: NodeSpec<NarState> = {
  type: "narration.narrator", title: "Narrator", category: "Narration",
  inputs: [{ id: "events", type: "event" }, { id: "events2", type: "event" }, { id: "events3", type: "event" }, { id: "events4", type: "event" }],
  outputs: [{ id: "lines", type: "text" }],
  params: [
    { id: "voices", kind: "select", label: "Commentators", options: ["1", "2"], value: "2" },
    { id: "nameA", kind: "text", label: "Voice A", value: "Jean" },
    { id: "nameB", kind: "text", label: "Voice B", value: "Margot" },
    langParam,
    { id: "setupChatter", kind: "bool", label: "Narrate the set-up (seat, opponent, intro)", value: true },
    { id: "opponentName", kind: "text", label: "AI opponent's name", value: "Vega" },
  ],
  previewSize: [200, 70],
  init: () => ({ n: new Narrator(), lines: [], started: false }),
  process(i, { params, state, span, now }) {
    state.n.cfg.voices = params.voices === "1" ? 1 : 2;
    // Commentary level and the opponent's voice come from the app-wide setting (View menu → Commentary).
    const coach = coachSettings();
    state.n.cfg.level = coach.level; state.n.cfg.opponentTalks = coach.opponentTalks; state.n.cfg.opponent = bus.botColor;
    state.n.cfg.opponentName = String(params.opponentName ?? "").trim() || "Vega";
    if (bus.insight && now > bus.insight.until) bus.insight = null;
    state.n.cfg.lang = langOf(params.language);
    state.n.cfg.names = [String(params.nameA), String(params.nameB)];
    let evs = [...(i.events ?? []), ...(i.events2 ?? []), ...(i.events3 ?? []), ...(i.events4 ?? [])] as ExperienceEvent[];
    // quick-play games start over and over: "a player sits down, against the machine, the lights dim" gets old fast
    // Nothing is said at start-up (the camera isn't even calibrated yet): set-up lines wait until a game has really begun with a first move.
    const setup = (e: ExperienceEvent) => e.type === "seat" || e.type === "leave" || e.type === "mode" || (e.type === "phase" && e.data?.phase === "intro");
    evs = evs.filter((e) => {
      if (e.type === "move" || e.type === "capture" || e.type === "castle" || e.type === "promotion" || e.type === "engine-move") state.started = true;
      return state.started || !setup(e);
    });
    if (params.setupChatter === false) evs = evs.filter((e) => !(e.type === "seat" || e.type === "leave" || e.type === "mode" || (e.type === "phase" && e.data?.phase === "intro")));
    const lines = evs.length ? span("narrate events", () => state.n.handle(evs)) : [];
    if (lines.length) { state.lines.push(...lines); state.lines = state.lines.slice(-30); pushLog(bus.lines, lines); }
    const lit = [...lines].reverse().find((l) => l.squares?.length);
    if (lit) bus.insight = { squares: lit.squares!, label: lit.label ?? "", until: now + INSIGHT_MS };
    return { lines };
  },
  hover: lineHover("Narrator"),
  preview: (ctx, w, h, s) => showLines(ctx, w, h, s.lines),
};

/** Models for the OpenAI dropdown: the priced fallback until a key fetches the account's live list. */
let liveModels: ModelInfo[] | null = null;
const modelInfos = (): ModelInfo[] => liveModels ?? chatModelsFrom(Object.keys(OPENAI_PRICES));
const priceLabel = (m: ModelInfo) => (m.input === undefined || m.output === undefined ? m.id : `${m.id}  ($${m.input} in · $${m.output} out /1M)`);
const aiModelParam = {
  id: "aiModel", kind: "select" as const, label: "OpenAI model", value: LLM_DEFAULT_MODEL,
  options: modelInfos().map((m) => m.id), labels: modelInfos().map(priceLabel),
  pick: { title: "OpenAI models: cost per token", models: modelInfos },
};
/** Replaces the dropdown with the models this key can use (called once per key). */
function adoptLiveModels(ids: string[]) {
  const ms = chatModelsFrom(ids);
  if (!ms.length) return;
  liveModels = ms; aiModelParam.options = ms.map((m) => m.id); aiModelParam.labels = ms.map(priceLabel);
}

interface AiState { lines: NarrationLine[]; ready: NarrationLine[]; history: string[]; inflight: number; keyFetched: string }
/** Optional AI commentator: rewrites the Narrator's lines with OpenAI. Without a key (or when off) it passes them through, and they also play if a request fails or is too slow. */
const aiNarrator: NodeSpec<AiState> = {
  type: "narration.ai", title: "AI commentary (OpenAI)", category: "Narration",
  inputs: [{ id: "lines", type: "text" }, { id: "events", type: "event" }, { id: "events2", type: "event" }, { id: "events3", type: "event" }, { id: "events4", type: "event" }],
  outputs: [{ id: "lines", type: "text" }],
  params: [
    { id: "provider", kind: "select", label: "Commentary engine", options: ["builtin", "openai"], value: "openai" },
    { id: "aiKey", kind: "text", label: "OpenAI API key", value: "", secret: true },
    aiModelParam,
    { id: "voices", kind: "select", label: "Commentators", options: ["1", "2"], value: "2" },
    { id: "nameA", kind: "text", label: "Voice A", value: "Jean" },
    { id: "nameB", kind: "text", label: "Voice B", value: "Margot" },
    langParam,
  ],
  previewSize: [200, 70],
  init: () => ({ lines: [], ready: [], history: [], inflight: 0, keyFetched: "" }),
  process(i, { params, state }) {
    const all = (i.lines ?? []) as NarrationLine[];
    // Lessons and the opponent's own words are kept as written; only the play-by-play is rewritten.
    const kept = all.filter((l) => l.tag), base = all.filter((l) => !l.tag);
    const evs = [...(i.events ?? []), ...(i.events2 ?? []), ...(i.events3 ?? []), ...(i.events4 ?? [])] as ExperienceEvent[];
    for (const e of evs) { const san = (e.data as any)?.san; if (san && (e.type === "move" || e.type === "capture" || e.type === "castle" || e.type === "promotion")) state.history.push(san); }
    state.history = state.history.slice(-40);
    const key = effectiveKey(String(params.aiKey ?? ""), "openai").trim();
    // One model-list request per key; a failed request keeps the priced fallback list.
    if (key && key !== state.keyFetched) { state.keyFetched = key; fetchOpenAiModelIds(key).then(adoptLiveModels).catch(() => {}); }
    const lines = state.ready.splice(0);
    if (params.provider !== "builtin" && key) {
      if (!base.length || state.inflight >= 2) lines.push(...base, ...kept);
      else {
        state.inflight++;
        // the kept lines wait for the rewrite so the lesson still follows the move it explains
        const prio = Math.max(...base.map((l) => l.priority));
        commentate(evs, state.history, { apiKey: key, model: String(params.aiModel || LLM_DEFAULT_MODEL), names: [String(params.nameA), String(params.nameB)], voices: params.voices === "1" ? 1 : 2, lang: langOf(params.language), recentLines: [...state.lines, ...state.ready].slice(-16).map((l) => l.text) }, prio)
          .catch(() => base).then((ls) => { state.ready.push(...ls, ...kept); }).finally(() => { state.inflight--; });
      }
    } else lines.push(...base, ...kept);
    if (lines.length) { state.lines.push(...lines); state.lines = state.lines.slice(-30); }
    return { lines };
  },
  hover: lineHover("AI commentary"),
  preview: (ctx, w, h, s) => showLines(ctx, w, h, s.lines),
};

/** ElevenLabs voice dropdowns: the two default voices until a key fetches the account's list. */
const voiceParam = (id: "voiceIdA" | "voiceIdB" | "voiceIdC", label: string) => ({
  id, kind: "select" as const, label, value: ELEVENLABS_DEFAULTS[id],
  options: [ELEVENLABS_DEFAULTS.voiceIdA, ELEVENLABS_DEFAULTS.voiceIdB, ELEVENLABS_DEFAULTS.voiceIdC], labels: ["Adam", "Rachel", "Antoni"],
});
const voiceParamA = voiceParam("voiceIdA", "Voice A");
const voiceParamB = voiceParam("voiceIdB", "Voice B");
const voiceParamC = voiceParam("voiceIdC", "AI opponent");
/** The browser's installed voices for the Voice A/B dropdowns, edited in place (the editor re-reads them each time a list opens). The browser loads its voices late, so this also refreshes when they arrive. */
const browserVoiceOptions: string[] = [""], browserVoiceLabels: string[] = ["Automatic"];
function refreshBrowserVoices() {
  if (typeof speechSynthesis === "undefined") return;
  const vs = speechSynthesis.getVoices(); if (!vs.length) return;
  browserVoiceOptions.length = 0; browserVoiceLabels.length = 0;
  browserVoiceOptions.push(""); browserVoiceLabels.push("Automatic");
  for (const v of vs) { browserVoiceOptions.push(v.name); browserVoiceLabels.push(`${v.name} (${v.lang})`); }
}
if (typeof speechSynthesis !== "undefined") {
  refreshBrowserVoices();
  speechSynthesis.addEventListener?.("voiceschanged", refreshBrowserVoices);
}
function adoptElevenVoices(vs: ElevenVoice[]) {
  if (!vs.length) return;
  for (const p of [voiceParamA, voiceParamB, voiceParamC]) { p.options = vs.map((v) => v.id); p.labels = vs.map(elevenVoiceLabel); }
}

interface SpeakState { enabled: boolean; keyFetched: string }
const speak: NodeSpec<SpeakState> = {
  type: "narration.speech", title: "Speech (TTS)", category: "Narration",
  inputs: [{ id: "lines", type: "text" }], outputs: [],
  params: [
    { id: "enabled", kind: "bool", label: "Speak aloud", value: true },
    { id: "volume", kind: "number", label: "Volume", min: 0, max: 1, step: 0.05, value: 0.9 },
    { id: "provider", kind: "select", label: "Voice engine", options: TTS_PROVIDERS.map((p) => p.id), labels: TTS_PROVIDERS.map((p) => p.label), value: "browser" },
    { id: "sepBrowser", kind: "separator", label: BROWSER_PROVIDER.label, value: "" },
    { id: "browserA", kind: "select", label: "Voice A", options: browserVoiceOptions, labels: browserVoiceLabels, value: "" },
    { id: "browserB", kind: "select", label: "Voice B", options: browserVoiceOptions, labels: browserVoiceLabels, value: "" },
    { id: "browserC", kind: "select", label: "AI opponent", options: browserVoiceOptions, labels: browserVoiceLabels, value: "" },
    { id: "sepElevenlabs", kind: "separator", label: ELEVENLABS_PROVIDER.label, value: "" },
    { id: "apiKey", kind: "text", label: "API key", value: "", secret: true },
    voiceParamA,
    voiceParamB,
    voiceParamC,
    { id: "model", kind: "select", label: "Model", options: ["eleven_multilingual_v2", "eleven_turbo_v2_5", "eleven_flash_v2_5"], labels: ["Multilingual v2 (best quality)", "Turbo v2.5 (faster)", "Flash v2.5 (fastest)"], value: ELEVENLABS_DEFAULTS.model },
    langParam,
  ],
  init: () => ({ enabled: true, keyFetched: "" }),
  process({ lines }, { params, state }) {
    const key = effectiveKey(String(params.apiKey ?? ""), "elevenlabs").trim();
    // One voice-list request per key; a failed request keeps the default voices.
    if (key && key !== state.keyFetched) { state.keyFetched = key; fetchElevenVoices(key).then(adoptElevenVoices).catch(() => {}); }
    if (!params.enabled) return;
    const s: VoiceSettings = {
      provider: params.provider === ELEVENLABS_PROVIDER.id ? ELEVENLABS_PROVIDER.id : BROWSER_PROVIDER.id, lang: langOf(params.language), volume: Number(params.volume),
      browserA: String(params.browserA ?? ""), browserB: String(params.browserB ?? ""), browserC: String(params.browserC ?? ""),
      apiKey: String(params.apiKey ?? ""), voiceIdA: String(params.voiceIdA ?? ""), voiceIdB: String(params.voiceIdB ?? ""), voiceIdC: String(params.voiceIdC ?? ""), model: String(params.model ?? ""),
    };
    for (const l of (lines as NarrationLine[]) ?? []) speak_(l.text, l.speaker, s, l.priority >= 3);
  },
};

/** TTS with two distinct voices (browser or ElevenLabs); critical lines cut the current utterance. */
export const speakLine = (text: string, voice: "A" | "B", volume: number, interrupt = false) =>
  speak_(text, voice, { provider: "browser", lang: "fr", volume, browserA: "", browserB: "", apiKey: "", voiceIdA: "", voiceIdB: "", model: "" }, interrupt);

export const narrationPlugin: Plugin = { id: "narration", name: "Narration", register: (r) => { r.register(narrator); r.register(aiNarrator); r.register(speak); } };
