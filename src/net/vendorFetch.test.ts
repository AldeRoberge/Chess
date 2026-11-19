import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SERVER_KEY, effectiveKey, loadServerKeys, saveServerKeys, serverHas, vendorFetch } from "./vendorFetch";

const jsonRes = (o: unknown, ok = true) => new Response(JSON.stringify(o), { status: ok ? 200 : 401, headers: { "content-type": "application/json" } });

describe("vendorFetch", () => {
  beforeEach(async () => { vi.stubGlobal("fetch", async () => new Response("<html>", { headers: { "content-type": "text/html" } })); await loadServerKeys(true); });
  afterEach(() => vi.unstubAllGlobals());

  it("treats a failed or non-JSON status as no server keys", async () => {
    expect(serverHas("openai")).toBe(false);
    expect(effectiveKey("", "openai")).toBe("");
    expect(effectiveKey(" sk-local ", "openai")).toBe(" sk-local ");
  });

  it("calls the vendor directly with the local key when the server has none", async () => {
    const f = vi.fn(async () => new Response("{}")); vi.stubGlobal("fetch", f);
    await vendorFetch("https://api.openai.com/v1/models", { headers: { Authorization: "Bearer sk-local" } });
    expect(f).toHaveBeenCalledWith("https://api.openai.com/v1/models", { headers: { Authorization: "Bearer sk-local" } });
  });

  it("rewrites to the worker and strips key headers when the server holds the key", async () => {
    vi.stubGlobal("fetch", async () => jsonRes({ openai: true, elevenlabs: false }));
    await loadServerKeys(true);
    expect(effectiveKey("", "openai")).toBe(SERVER_KEY);
    const f = vi.fn(async () => new Response("{}")); vi.stubGlobal("fetch", f);
    await vendorFetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { Authorization: "Bearer x", "Content-Type": "application/json" }, body: "{}" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/openai\/chat\/completions$/);
    const h = new Headers(init.headers);
    expect(h.get("authorization")).toBeNull();
    expect(h.get("content-type")).toBe("application/json");
    // a vendor the server does not hold still goes direct
    await vendorFetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": "k" } });
    expect(f.mock.calls[1][0]).toBe("https://api.elevenlabs.io/v1/voices");
  });

  it("saves keys with the passphrase and reports server errors", async () => {
    const f = vi.fn(async () => jsonRes({ openai: true, elevenlabs: true }));
    expect(await saveServerKeys("pw", { openai: "sk" }, f as unknown as typeof fetch)).toEqual({ openai: true, elevenlabs: true });
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ Authorization: "Bearer pw" });
    await expect(saveServerKeys("bad", {}, (async () => jsonRes({ error: "wrong passphrase" }, false)) as unknown as typeof fetch)).rejects.toThrow("wrong passphrase");
  });
});
