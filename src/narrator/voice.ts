/** Speech output for narration lines: browser speechSynthesis or ElevenLabs text-to-speech. */
import { mixer } from "../scene/mixer";
import { effectiveKey, vendorFetch } from "../net/vendorFetch";
import type { Speaker } from "./coach";

export interface VoiceSettings {
  provider: "browser" | "elevenlabs";
  /** Language of the narration text; picks the browser voice locale (default French). */
  lang?: "fr" | "en";
  volume: number;
  /** Browser voice name (substring match, case-insensitive) per speaker; empty = automatic French voice. */
  browserA: string;
  browserB: string;
  /** The AI opponent's browser voice; empty = automatic (a third, lower voice). */
  browserC?: string;
  /** ElevenLabs */
  apiKey: string;
  voiceIdA: string;
  voiceIdB: string;
  /** The AI opponent's ElevenLabs voice. */
  voiceIdC?: string;
  model: string;
}

export const ELEVENLABS_DEFAULTS = { voiceIdA: "pNInz6obpgDQGcFmaJgB", voiceIdB: "21m00Tcm4TlvDq8ikWAM", voiceIdC: "ErXwobaYiN019PkySvjV", model: "eleven_multilingual_v2" };

/** The ElevenLabs voice for a speaker, with its default when the setting is empty. */
const elevenId = (who: Speaker, s: VoiceSettings) =>
  (who === "A" ? s.voiceIdA : who === "B" ? s.voiceIdB : s.voiceIdC ?? "").trim() || (who === "A" ? ELEVENLABS_DEFAULTS.voiceIdA : who === "B" ? ELEVENLABS_DEFAULTS.voiceIdB : ELEVENLABS_DEFAULTS.voiceIdC);

let current: HTMLAudioElement | null = null;
let chain: Promise<void> = Promise.resolve();
let epoch = 0;

export function stopSpeaking() {
  epoch++;
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  if (current) { current.pause(); current = null; }
  chain = Promise.resolve();
}

function speakBrowser(text: string, who: Speaker, s: VoiceSettings) {
  if (typeof speechSynthesis === "undefined") return;
  const u = new SpeechSynthesisUtterance(text);
  const code = s.lang === "en" ? "en" : "fr";
  u.lang = code === "en" ? "en-US" : "fr-FR"; u.volume = s.volume;
  u.pitch = who === "A" ? 0.85 : who === "B" ? 1.25 : 0.7; u.rate = who === "A" ? 1.05 : who === "B" ? 0.98 : 0.95;
  const all = speechSynthesis.getVoices();
  const want = (who === "A" ? s.browserA : who === "B" ? s.browserB : s.browserC ?? "").trim().toLowerCase();
  const local = all.filter((v) => v.lang.startsWith(code));
  const named = want ? all.find((v) => v.name.toLowerCase().includes(want)) : undefined;
  if (named) { u.voice = named; u.lang = named.lang; }
  else if (local.length) u.voice = local[Math.min(who === "A" ? 0 : who === "B" ? 1 : 2, local.length - 1)];
  speechSynthesis.speak(u);
}

async function fetchEleven(text: string, voiceId: string, s: VoiceSettings): Promise<Blob> {
  const r = await vendorFetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: "POST",
    headers: { "xi-api-key": s.apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: s.model || ELEVENLABS_DEFAULTS.model }),
  });
  if (!r.ok) throw new Error(`ElevenLabs ${r.status}`);
  return r.blob();
}

export interface ElevenVoice { id: string; name: string; category: string }

/** Voices available to this key (premade, cloned, library): proves the key works too. */
export async function fetchElevenVoices(apiKey: string, doFetch: typeof fetch = vendorFetch): Promise<ElevenVoice[]> {
  const r = await doFetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": apiKey.trim() } });
  if (!r.ok) throw new Error(`ElevenLabs ${r.status}`);
  const j = (await r.json()) as { voices?: { voice_id: string; name?: string; category?: string }[] };
  return (j.voices ?? []).map((v) => ({ id: v.voice_id, name: v.name || v.voice_id, category: v.category ?? "" }));
}

export const elevenVoiceLabel = (v: ElevenVoice) => (v.category ? `${v.name} · ${v.category}` : v.name);

/** Plays one line through ElevenLabs and resolves when it ends; rejects on any failure (no browser fallback), so a setup test can report it. */
export async function previewEleven(text: string, who: Speaker, s: VoiceSettings): Promise<void> {
  const id = elevenId(who, s);
  const blob = await fetchEleven(text, id, s);
  stopSpeaking();
  const url = URL.createObjectURL(blob), a = new Audio(url); a.volume = s.volume; current = a;
  try { await new Promise<void>((res, rej) => { a.onended = () => res(); a.onerror = () => rej(new Error("playback failed")); a.play().catch(rej); }); } finally { URL.revokeObjectURL(url); }
}

function speakEleven(text: string, who: Speaker, s: VoiceSettings) {
  const id = elevenId(who, s);
  const my = epoch;
  const pending = fetchEleven(text, id, s); // fetch now so queued lines are ready when their turn comes
  pending.catch(() => {});
  chain = chain.then(async () => {
    try {
      const blob = await pending;
      if (my !== epoch) return;
      const url = URL.createObjectURL(blob);
      const a = new Audio(url); a.volume = s.volume; current = a;
      await new Promise<void>((res) => { a.onended = a.onerror = () => res(); a.play().catch(() => res()); });
      URL.revokeObjectURL(url);
    } catch {
      if (my === epoch) speakBrowser(text, who, s); // network/key failure: fall back to the browser voice
    }
  });
}

/** A text-to-speech provider: each one plays a line for speaker A or B with its own settings. */
export interface TtsProvider {
  id: VoiceSettings["provider"];
  /** Label shown in the "Voice engine" dropdown. */
  label: string;
  speak(text: string, who: Speaker, s: VoiceSettings): void;
}

export const BROWSER_PROVIDER: TtsProvider = {
  id: "browser",
  label: "Browser voices",
  speak: speakBrowser,
};

/** ElevenLabs needs a key; without one (or on a failed request) the browser voice takes over. */
export const ELEVENLABS_PROVIDER: TtsProvider = {
  id: "elevenlabs",
  label: "ElevenLabs",
  speak: (text, who, s) => {
    if (effectiveKey(s.apiKey, "elevenlabs")) speakEleven(text, who, s);
    else speakBrowser(text, who, s);
  },
};

export const TTS_PROVIDERS: TtsProvider[] = [BROWSER_PROVIDER, ELEVENLABS_PROVIDER];

export function speak(text: string, who: Speaker, s: VoiceSettings, interrupt = false) {
  if (interrupt) stopSpeaking();
  const p = TTS_PROVIDERS.find((x) => x.id === s.provider) ?? BROWSER_PROVIDER;
  // the mixer's narration bus (and master, and mute) scales the voice level
  p.speak(text, who, { ...s, volume: s.volume * narrationLevel() });
}

/** Narration bus gain from the global mixer: 0 when muted. */
function narrationLevel(): number {
  return mixer.gain("narration");
}
