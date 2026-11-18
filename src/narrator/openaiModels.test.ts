import { describe, expect, it } from "vitest";
import { chatModelsFrom, fetchOpenAiModelIds } from "./openaiModels";

describe("OpenAI model list", () => {
  it("keeps chat models only and sorts by input price, unpriced last", () => {
    const ids = ["whisper-1", "gpt-4.1", "gpt-4.1-nano", "text-embedding-3-small", "gpt-4o-realtime-preview", "o3-mini", "gpt-mystery", "dall-e-3"];
    expect(chatModelsFrom(ids).map((m) => m.id)).toEqual(["gpt-4.1-nano", "gpt-4.1", "gpt-mystery", "o3-mini"].sort((a, b) => {
      const pa = a === "gpt-4.1-nano" ? 0.1 : a === "gpt-4.1" ? 2 : Infinity, pb = b === "gpt-4.1-nano" ? 0.1 : b === "gpt-4.1" ? 2 : Infinity;
      return pa - pb || a.localeCompare(b);
    }));
    expect(chatModelsFrom(ids)[0]).toMatchObject({ id: "gpt-4.1-nano", input: 0.1, output: 0.4 });
    expect(chatModelsFrom(ids).at(-1)!.input).toBeUndefined();
  });

  it("fetches the ids with the key and rejects on HTTP errors", async () => {
    const ok = async (url: any, init: any) => { expect(String(url)).toBe("https://api.openai.com/v1/models"); expect(init.headers.Authorization).toBe("Bearer sk-x"); return new Response(JSON.stringify({ data: [{ id: "gpt-4.1" }] })); };
    expect(await fetchOpenAiModelIds(" sk-x ", ok as typeof fetch)).toEqual(["gpt-4.1"]);
    await expect(fetchOpenAiModelIds("bad", (async () => new Response("", { status: 401 })) as typeof fetch)).rejects.toThrow("OpenAI 401");
  });
});
