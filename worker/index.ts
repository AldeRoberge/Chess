// Cloudflare Worker for alderoberge.com/chess: a keyed proxy to OpenAI and ElevenLabs.
// The API keys live in Worker secrets (OPENAI_API_KEY, ELEVENLABS_API_KEY) or KV, and never reach the browser.
// Everything outside /chess/api/ and /chess/remote/ falls through to the static assets.

import { handleRemote, type BridgeNamespace } from "./bridge";

interface KV { get(k: string): Promise<string | null>; put(k: string, v: string, o?: { expirationTtl?: number }): Promise<void>; delete(k: string): Promise<void> }
export interface Env {
  KEYS: KV;
  ASSETS: { fetch(r: Request): Promise<Response> };
  /** Live phone room. Absent until the worker is deployed with the GameBridge migration. */
  BRIDGE?: BridgeNamespace;
  LIMITS?: BridgeNamespace;
  ADMIN_PASSPHRASE?: string;
  /** Dashboard secrets (`wrangler secret put`). Used when KV has no key for that vendor. */
  OPENAI_API_KEY?: string;
  ELEVENLABS_API_KEY?: string;
  ALLOWED_ORIGINS?: string; // comma separated hosts, default "alderoberge.com"
  RATE_PER_MIN?: string; // per IP, default 30
  DAILY_LIMIT?: string; // all callers together, default 3000
}

type Vendor = "openai" | "elevenlabs";
const VENDORS: Record<Vendor, { base: string; header: (k: string) => Record<string, string>; allow: RegExp[] }> = {
  openai: {
    base: "https://api.openai.com/v1/",
    header: (k) => ({ Authorization: `Bearer ${k}` }),
    allow: [/^chat\/completions$/, /^models$/],
  },
  elevenlabs: {
    base: "https://api.elevenlabs.io/v1/",
    header: (k) => ({ "xi-api-key": k }),
    allow: [/^text-to-speech\/[\w-]+$/, /^voices$/],
  },
};
const MAX_BODY = 4_000_000; // base64 board photos are a few hundred KB
const MAX_TOKENS = 4000;
const MAX_TTS_CHARS = 1500;
const PREFIX = "/chess/api/";

const json = (o: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra } });

function safeEqual(a: string, b: string): boolean {
  const n = Math.max(a.length, b.length);
  let d = a.length ^ b.length;
  for (let i = 0; i < n; i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}

function allowedHost(env: Env): string[] { return (env.ALLOWED_ORIGINS || "alderoberge.com").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean); }
function originOk(req: Request, env: Env): boolean {
  const src = req.headers.get("Origin") || req.headers.get("Referer");
  if (!src) return false;
  try { return allowedHost(env).includes(new URL(src).hostname.toLowerCase()); } catch { return false; }
}
const cors = (req: Request): Record<string, string> => {
  const o = req.headers.get("Origin");
  return o ? { "Access-Control-Allow-Origin": o, Vary: "Origin", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS" } : {};
};

// Local fallback is for tests/development; production uses the atomic LIMITS object.
const localCounts = new WeakMap<KV, Map<string, { n: number; until: number }>>();
async function hit(env: Env, key: string, limit: number, ttl: number): Promise<boolean> {
  let counts = localCounts.get(env.KEYS);
  if (!counts) { counts = new Map(); localCounts.set(env.KEYS, counts); }
  const now = Date.now();
  for (const [k, v] of counts) if (v.until <= now) counts.delete(k);
  const previous = counts.get(key);
  if (!previous && counts.size >= 10000) return false;
  const n = (previous?.n ?? 0) + 1;
  counts.set(key, { n, until: previous?.until ?? now + ttl * 1000 });
  return n <= limit;
}

const keyCache = new WeakMap<KV, Map<Vendor, { value: string | null; until: number }>>();
/** KV key if one was saved from the setup page, otherwise the Worker secret. */
async function vendorKey(env: Env, vendor: Vendor): Promise<string | null> {
  let cache = keyCache.get(env.KEYS);
  if (!cache) { cache = new Map(); keyCache.set(env.KEYS, cache); }
  let entry = cache.get(vendor);
  if (!entry || entry.until <= Date.now()) {
    let value: string | null;
    try { value = await env.KEYS.get(`key:${vendor}`); }
    catch (error) {
      if (!(vendor === "openai" ? env.OPENAI_API_KEY : env.ELEVENLABS_API_KEY)?.trim()) throw error;
      value = null; // Dashboard secrets still work if the KV daily quota was already exhausted.
    }
    entry = { value, until: Date.now() + 60_000 }; cache.set(vendor, entry);
  }
  const fromKv = entry.value?.trim();
  if (fromKv) return fromKv;
  const fromEnv = (vendor === "openai" ? env.OPENAI_API_KEY : env.ELEVENLABS_API_KEY)?.trim();
  return fromEnv || null;
}

/** Tighten the request body: cap output size and refuse oversized TTS text. */
function clampBody(vendor: Vendor, path: string, raw: string): string | null {
  let b: Record<string, unknown>;
  try { b = JSON.parse(raw); } catch { return null; }
  if (vendor === "openai") {
    for (const k of ["max_tokens", "max_completion_tokens"]) if (typeof b[k] === "number") b[k] = Math.min(b[k] as number, MAX_TOKENS);
    if (b.max_tokens == null && b.max_completion_tokens == null) b.max_completion_tokens = MAX_TOKENS;
    if (typeof b.n === "number" && b.n > 1) b.n = 1;
  } else if (path.startsWith("text-to-speech/") && typeof b.text === "string" && b.text.length > MAX_TTS_CHARS) return null;
  return JSON.stringify(b);
}

async function proxy(req: Request, env: Env, vendor: Vendor, path: string): Promise<Response> {
  const c = cors(req);
  const v = VENDORS[vendor];
  if (!v.allow.some((r) => r.test(path))) return json({ error: "path not allowed" }, 404, c);
  if (!originOk(req, env)) return json({ error: "origin not allowed" }, 403);
  const key = await vendorKey(env, vendor);
  if (!key) return json({ error: `no ${vendor} key stored on the server` }, 503, c);

  const ip = req.headers.get("CF-Connecting-IP") || "unknown";
  const minute = Math.floor(Date.now() / 60000);
  const day = new Date().toISOString().slice(0, 10);
  if (env.LIMITS) {
    const r = await env.LIMITS.get(env.LIMITS.idFromName("proxy")).fetch(new Request("https://limits.internal/", {
      method: "POST", body: JSON.stringify({ ip, vendor, rate: Number(env.RATE_PER_MIN) || 30, daily: Number(env.DAILY_LIMIT) || 3000 }),
    }));
    if (!r.ok) return json({ error: await r.text() }, r.status, { ...c, "Retry-After": "60" });
  } else {
    if (!(await hit(env, `rl:${ip}:${minute}`, Number(env.RATE_PER_MIN) || 30, 120))) return json({ error: "rate limit: slow down" }, 429, { ...c, "Retry-After": "30" });
    if (!(await hit(env, `daily:${vendor}:${day}`, Number(env.DAILY_LIMIT) || 3000, 90000))) return json({ error: "daily limit reached" }, 429, c);
  }

  let body: string | undefined;
  if (req.method === "POST") {
    const raw = await req.text();
    if (raw.length > MAX_BODY) return json({ error: "request too large" }, 413, c);
    body = clampBody(vendor, path, raw) ?? undefined;
    if (body === undefined) return json({ error: "invalid or too long request" }, 400, c);
  } else if (req.method !== "GET") return json({ error: "method not allowed" }, 405, c);

  const url = new URL(req.url);
  const up = await fetch(v.base + path + url.search, {
    method: req.method,
    headers: { "Content-Type": "application/json", Accept: req.headers.get("Accept") || "*/*", ...v.header(key) },
    body,
  });
  const h = new Headers(up.headers);
  for (const k of ["set-cookie", "openai-organization", "openai-project"]) h.delete(k);
  for (const [k, val] of Object.entries(c)) h.set(k, val);
  return new Response(up.body, { status: up.status, headers: h });
}

export { GameBridge } from "./bridge";
export { ProxyLimits } from "./limits";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const remote = await handleRemote(req, env, url);
    if (remote) return remote;
    if (!url.pathname.startsWith(PREFIX)) return env.ASSETS.fetch(req);
    const route = url.pathname.slice(PREFIX.length);
    const c = cors(req);
    if (req.method === "OPTIONS") return new Response(null, { status: originOk(req, env) ? 204 : 403, headers: c });

    if (route === "status" && req.method === "GET") {
      return json({ openai: !!(await vendorKey(env, "openai")), elevenlabs: !!(await vendorKey(env, "elevenlabs")) }, 200, c);
    }
    if (route === "keys" && req.method === "PUT") {
      const pass = env.ADMIN_PASSPHRASE;
      const given = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      if (!pass || !safeEqual(given, pass)) return json({ error: "wrong passphrase" }, 401, c);
      let b: Partial<Record<Vendor, unknown>>;
      try { b = await req.json(); } catch { return json({ error: "bad json" }, 400, c); }
      for (const vendor of ["openai", "elevenlabs"] as Vendor[]) {
        const val = b[vendor];
        if (typeof val !== "string") continue;
        if (val.trim()) await env.KEYS.put(`key:${vendor}`, val.trim()); else await env.KEYS.delete(`key:${vendor}`);
        keyCache.get(env.KEYS)?.delete(vendor);
      }
      return json({ openai: !!(await vendorKey(env, "openai")), elevenlabs: !!(await vendorKey(env, "elevenlabs")) }, 200, c);
    }
    const m = /^(openai|elevenlabs)\/(.+)$/.exec(route);
    if (m) return proxy(req, env, m[1] as Vendor, m[2]);
    return json({ error: "not found" }, 404, c);
  },
};
