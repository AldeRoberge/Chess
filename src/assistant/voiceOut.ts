import { ELEVENLABS_DEFAULTS, speak, type VoiceSettings } from "../narrator/voice";
import { loadSetup } from "../setup/config";
import { plainSpeech } from "./guide";

/** Speaks one assistant line with the voice chosen in Setup (ElevenLabs when that engine is on). */
export function speakAssistant(text: string) {
  const said = plainSpeech(text);
  if (!said) return;
  const s = loadSetup();
  const v = s?.voice;
  const settings: VoiceSettings = {
    provider: v?.engine === "elevenlabs" ? "elevenlabs" : "browser",
    lang: "en",
    volume: s?.narrator.volume ?? 0.9,
    browserA: "", browserB: "",
    apiKey: v?.apiKey ?? "",
    voiceIdA: v?.voiceIdA || ELEVENLABS_DEFAULTS.voiceIdA,
    voiceIdB: v?.voiceIdB || ELEVENLABS_DEFAULTS.voiceIdB,
    model: ELEVENLABS_DEFAULTS.model,
  };
  speak(said, "A", settings, true);
}
