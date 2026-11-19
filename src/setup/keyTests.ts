import { fetchOpenAiModelIds } from "../narrator/openaiModels";
import { previewEleven, type VoiceSettings } from "../narrator/voice";
import { effectiveKey, vendorFetch } from "../net/vendorFetch";

/** Outcome of a "Test" button in setup: shown as a coloured line under the key. */
export interface TestResult { tone: "ok" | "warn" | "fail"; text: string }

const httpReason = (status: number, service: string): string => {
  if (status === 401) return `${service} rejected the key (401). Copy it again, with no spaces.`;
  if (status === 403) return `${service} accepted the key but it lacks a permission (403). Allow the permission it names, or create a new key.`;
  if (status === 429) return `${service} says the account is out of credit or rate limited (429). Check billing or quota.`;
  return `${service} answered with an error (${status}).`;
};

const failure = (e: unknown, service: string): TestResult => {
  const m = /(?:OpenAI|ElevenLabs) (\d{3})/.exec(e instanceof Error ? e.message : "");
  return { tone: "fail", text: m ? httpReason(Number(m[1]), service) : `Could not reach ${service}. Check the internet connection.` };
};

/** Lists the account's models: proves the key works without spending anything. */
export async function testOpenAiKey(key: string, doFetch: typeof fetch = vendorFetch): Promise<TestResult> {
  if (!effectiveKey(key, "openai")) return { tone: "warn", text: "Paste your API key first." };
  try {
    const ids = await fetchOpenAiModelIds(key, doFetch);
    return { tone: "ok", text: `Key works: ${ids.length} models available.` };
  } catch (e) { return failure(e, "OpenAI"); }
}

/** Speaks a short line for real, so a bad key, voice id or empty quota shows up here and not mid-game. */
export async function testElevenLabs(text: string, who: "A" | "B", s: VoiceSettings): Promise<TestResult> {
  if (!effectiveKey(s.apiKey, "elevenlabs")) return { tone: "warn", text: "Paste your API key first." };
  try { await previewEleven(text, who, s); return { tone: "ok", text: "Key works: the line played with ElevenLabs." }; } catch (e) { return failure(e, "ElevenLabs"); }
}
