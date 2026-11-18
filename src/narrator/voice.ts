/** Speech output for narration lines: browser speechSynthesis or ElevenLabs text-to-speech. */

export interface VoiceSettings {
  provider: "browser" | "elevenlabs";
  /** Language of the narration text; picks the browser voice locale (default French). */
  lang?: "fr" | "en";
  volume: number;
  /** Browser voice name (substring match, case-insensitive) per speaker; empty = automatic French voice. */
  browserA: string;
  browserB: string;
  /** ElevenLabs */
  apiKey: string;
  voiceIdA: string;
  voiceIdB: string;
  model: string;
}

export const ELEVENLABS_DEFAULTS = { voiceIdA: "pNInz6obpgDQGcFmaJgB", voiceIdB: "21m00Tcm4TlvDq8ikWAM", model: "eleven_multilingual_v2" };

let current: HTMLAudioElement | null = null;
let chain: Promise<void> = Promise.resolve();
let epoch = 0;

export function stopSpeaking() {
  epoch++;
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  if (current) { current.pause(); current = null; }
  chain = Promise.resolve();
}

function speakBrowser(text: string, who: "A" | "B", s: VoiceSettings) {
  if (typeof speechSynthesis === "undefined") return;
  const u = new SpeechSynthesisUtterance(text);
  const code = s.lang === "en" ? "en" : "fr";
  u.lang = code === "en" ? "en-US" : "fr-FR"; u.volume = s.volume;
  u.pitch = who === "A" ? 0.85 : 1.25; u.rate = who === "A" ? 1.05 : 0.98;
  const all = speechSynthesis.getVoices();
  const want = (who === "A" ? s.browserA : s.browserB).trim().toLowerCase();
  const local = all.filter((v) => v.lang.startsWith(code));
  const named = want ? all.find((v) => v.name.toLowerCase().includes(want)) : undefined;
  if (named) { u.voice = named; u.lang = named.lang; }
  else if (local.length) u.voice = local[who === "A" ? 0 : Math.min(1, local.length - 1)];
  speechSynthesis.speak(u);
}

async function fetchEleven(text: string, voiceId: string, s: VoiceSettings): Promise<Blob> {
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: "POST",
    headers: { "xi-api-key": s.apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: s.model || ELEVENLABS_DEFAULTS.model }),
  });
  if (!r.ok) throw new Error(`ElevenLabs ${r.status}`);
  return r.blob();
}

/** Plays one line through ElevenLabs and resolves when it ends; rejects on any failure (no browser fallback), so a setup test can report it. */
export async function previewEleven(text: string, who: "A" | "B", s: VoiceSettings): Promise<void> {
  const id = (who === "A" ? s.voiceIdA : s.voiceIdB).trim() || (who === "A" ? ELEVENLABS_DEFAULTS.voiceIdA : ELEVENLABS_DEFAULTS.voiceIdB);
  const blob = await fetchEleven(text, id, s);
  stopSpeaking();
  const url = URL.createObjectURL(blob), a = new Audio(url); a.volume = s.volume; current = a;
  try { await new Promise<void>((res, rej) => { a.onended = () => res(); a.onerror = () => rej(new Error("playback failed")); a.play().catch(rej); }); } finally { URL.revokeObjectURL(url); }
}

function speakEleven(text: string, who: "A" | "B", s: VoiceSettings) {
  const id = (who === "A" ? s.voiceIdA : s.voiceIdB).trim() || (who === "A" ? ELEVENLABS_DEFAULTS.voiceIdA : ELEVENLABS_DEFAULTS.voiceIdB);
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
  speak(text: string, who: "A" | "B", s: VoiceSettings): void;
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
    if (s.apiKey.trim()) speakEleven(text, who, s);
    else speakBrowser(text, who, s);
  },
};

export const TTS_PROVIDERS: TtsProvider[] = [BROWSER_PROVIDER, ELEVENLABS_PROVIDER];

export function speak(text: string, who: "A" | "B", s: VoiceSettings, interrupt = false) {
  if (interrupt) stopSpeaking();
  const p = TTS_PROVIDERS.find((x) => x.id === s.provider) ?? BROWSER_PROVIDER;
  p.speak(text, who, s);
}
