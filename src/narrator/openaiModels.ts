import type { ModelInfo } from "../core/types";
import { vendorFetch } from "../net/vendorFetch";

/** Text-token prices in USD per 1M tokens, copied from OpenAI's model pages (checked 2026-11-18). Models not listed here show no price. */
export const OPENAI_PRICES: Record<string, { input: number; output: number }> = {
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1": { input: 2, output: 8 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-5-nano": { input: 0.05, output: 0.4 },
  "gpt-5-mini": { input: 0.25, output: 2 },
};

/** Ids that are chat-capable text models; everything else in /v1/models (audio, image, embeddings, tts, ...) is skipped. */
const CHAT_ID = /^(gpt-|o\d|chatgpt-)/;
const NOT_CHAT = /realtime|audio|image|tts|transcribe|embedding|moderation|search|whisper|dall-e|davinci|babbage|instruct|codex|sora|computer-use/;

/** Chat models from the account's live model list, cheapest first (unpriced ones last, by name). */
export function chatModelsFrom(ids: string[]): ModelInfo[] {
  return ids.filter((id) => CHAT_ID.test(id) && !NOT_CHAT.test(id)).map((id) => ({ id, ...OPENAI_PRICES[id] }))
    .sort((a, b) => (a.input ?? Infinity) - (b.input ?? Infinity) || (a.output ?? Infinity) - (b.output ?? Infinity) || a.id.localeCompare(b.id));
}

/** Fetches the account's model ids; rejects on HTTP errors so the caller keeps its current list. */
export async function fetchOpenAiModelIds(apiKey: string, doFetch: typeof fetch = vendorFetch): Promise<string[]> {
  const r = await doFetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${apiKey.trim()}` } });
  if (!r.ok) throw new Error(`OpenAI ${r.status}`);
  const j = await r.json();
  return (Array.isArray(j?.data) ? j.data : []).map((m: { id?: unknown }) => String(m?.id ?? "")).filter(Boolean);
}
