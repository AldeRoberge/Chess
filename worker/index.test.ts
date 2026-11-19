// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "./index";

const kv = () => {
  const m = new Map<string, string>();
  return { m, get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => void m.set(k, v), delete: async (k: string) => void m.delete(k) };
};
const mk = (over: Partial<Env> = {}) => {
  const KEYS = kv();
  const env: Env = { KEYS, ASSETS: { fetch: async () => new Response("asset") }, ADMIN_PASSPHRASE: "pw", ...over };
  return { env, KEYS };
};
const call = (env: Env, path: string, init: RequestInit = {}, origin: string | null = "https://alderoberge.com") =>
  worker.fetch(new Request(`https://alderoberge.com/chess/api/${path}`, { ...init, headers: { ...(origin ? { Origin: origin } : {}), ...(init.headers as Record<string, string>) } }), env);

afterEach(() => vi.unstubAllGlobals());

describe("worker", () => {
  it("serves assets outside /chess/api/", async () => {
    const { env } = mk();
    expect(await (await worker.fetch(new Request("https://alderoberge.com/chess/"), env)).text()).toBe("asset");
  });

  it("status reports presence only, never the key", async () => {
    const { env, KEYS } = mk(); KEYS.m.set("key:openai", "sk-secret");
    const r = await call(env, "status");
    expect(await r.json()).toEqual({ openai: true, elevenlabs: false });
  });

  it("saving keys needs the passphrase", async () => {
    const { env, KEYS } = mk();
    const body = JSON.stringify({ openai: " sk-x ", elevenlabs: "el" });
    expect((await call(env, "keys", { method: "PUT", body, headers: { Authorization: "Bearer nope" } })).status).toBe(401);
    expect(KEYS.m.size).toBe(0);
    const ok = await call(env, "keys", { method: "PUT", body, headers: { Authorization: "Bearer pw" } });
    expect(await ok.json()).toEqual({ openai: true, elevenlabs: true });
    expect(KEYS.m.get("key:openai")).toBe("sk-x");
    await call(env, "keys", { method: "PUT", body: JSON.stringify({ openai: "" }), headers: { Authorization: "Bearer pw" } });
    expect(KEYS.m.has("key:openai")).toBe(false);
  });

  it("refuses saving when no passphrase is configured", async () => {
    const { env } = mk({ ADMIN_PASSPHRASE: undefined });
    expect((await call(env, "keys", { method: "PUT", body: "{}", headers: { Authorization: "Bearer " } })).status).toBe(401);
  });

  it("proxies with the stored key and clamps the output size", async () => {
    const { env, KEYS } = mk(); KEYS.m.set("key:openai", "sk-secret");
    const up = vi.fn(async (_u: string, _i: RequestInit) => new Response('{"ok":1}', { status: 200 }));
    vi.stubGlobal("fetch", up);
    const r = await call(env, "openai/chat/completions", { method: "POST", body: JSON.stringify({ model: "m", max_tokens: 999999 }), headers: { Authorization: "Bearer client-sent" } });
    expect(r.status).toBe(200);
    const [url, init] = up.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-secret");
    expect(JSON.parse(String(init.body)).max_tokens).toBe(4000);
    expect(r.headers.get("access-control-allow-origin")).toBe("https://alderoberge.com");
  });

  it("injects the ElevenLabs header and limits the text length", async () => {
    const { env, KEYS } = mk(); KEYS.m.set("key:elevenlabs", "el-secret");
    const up = vi.fn(async () => new Response("audio"));
    vi.stubGlobal("fetch", up);
    expect((await call(env, "elevenlabs/text-to-speech/abc", { method: "POST", body: JSON.stringify({ text: "x".repeat(2000) }) })).status).toBe(400);
    expect(up).not.toHaveBeenCalled();
    await call(env, "elevenlabs/text-to-speech/abc", { method: "POST", body: JSON.stringify({ text: "hello" }) });
    expect(((up.mock.calls[0] as unknown[])[1] as RequestInit & { headers: Record<string, string> }).headers["xi-api-key"]).toBe("el-secret");
  });

  it("blocks foreign origins, missing origin, unlisted paths and a missing key", async () => {
    const { env, KEYS } = mk();
    expect((await call(env, "openai/models", {}, "https://evil.example")).status).toBe(403);
    expect((await call(env, "openai/models", {}, null)).status).toBe(403);
    expect((await call(env, "openai/files")).status).toBe(404);
    expect((await call(env, "openai/models")).status).toBe(503);
    KEYS.m.set("key:openai", "k");
  });

  it("rate limits per IP and per day", async () => {
    const { env, KEYS } = mk({ RATE_PER_MIN: "2", DAILY_LIMIT: "3" }); KEYS.m.set("key:openai", "k");
    vi.stubGlobal("fetch", async () => new Response("{}"));
    const hit = () => call(env, "openai/models", { headers: { "CF-Connecting-IP": "1.1.1.1" } }).then((r) => r.status);
    expect([await hit(), await hit(), await hit()]).toEqual([200, 200, 429]);
    const other = await call(env, "openai/models", { headers: { "CF-Connecting-IP": "2.2.2.2" } });
    expect(other.status).toBe(200); // different IP, but now the daily total (3) is spent
    expect((await call(env, "openai/models", { headers: { "CF-Connecting-IP": "3.3.3.3" } })).status).toBe(429);
  });

  it("uses a worker secret when nothing is saved in KV, and a saved key overrides it", async () => {
    const { env, KEYS } = mk({ OPENAI_API_KEY: " sk-env ", ELEVENLABS_API_KEY: " el-env " });
    expect(await (await call(env, "status")).json()).toEqual({ openai: true, elevenlabs: true });
    const up = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", up);
    await call(env, "openai/models");
    expect((up.mock.calls[0][1] as RequestInit & { headers: Record<string, string> }).headers.Authorization).toBe("Bearer sk-env");
    KEYS.m.set("key:openai", "sk-kv");
    await call(env, "openai/models");
    expect((up.mock.calls[1][1] as RequestInit & { headers: Record<string, string> }).headers.Authorization).toBe("Bearer sk-kv");
  });
});
