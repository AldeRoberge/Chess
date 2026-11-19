// Routes OpenAI / ElevenLabs calls through the site's Cloudflare Worker (worker/index.ts) when it holds the key,
// so the key never reaches the browser. Without a server key (dev server, offline) it calls the vendor directly with the local key.

export type Vendor = "openai" | "elevenlabs";
export type ServerKeys = Record<Vendor, boolean>;
/** Stand-in for a key the server holds: non-empty so "is a key set?" checks pass; stripped before the request leaves. */
export const SERVER_KEY = "server-managed";

const HOSTS: Record<Vendor, string> = { openai: "https://api.openai.com/v1/", elevenlabs: "https://api.elevenlabs.io/v1/" };
const NONE: ServerKeys = { openai: false, elevenlabs: false };
let status: ServerKeys = NONE;
let loading: Promise<ServerKeys> | null = null;

const apiBase = (): string => `${(import.meta.env?.BASE_URL ?? "/").replace(/\/?$/, "/")}api/`;

/** Ask the worker which keys it holds (cached; any failure means "none"). */
export function loadServerKeys(force = false, doFetch: typeof fetch = fetch): Promise<ServerKeys> {
  if (force) loading = null;
  loading ??= (async () => {
    try {
      const r = await doFetch(`${apiBase()}status`);
      const j = r.ok && (r.headers.get("content-type") ?? "").includes("json") ? await r.json() : null;
      status = { openai: !!j?.openai, elevenlabs: !!j?.elevenlabs };
    } catch { status = NONE; }
    return status;
  })();
  return loading;
}
export const serverHas = (v: Vendor): boolean => status[v];
/** The local key, or the placeholder when the server holds one. */
export const effectiveKey = (local: string, v: Vendor): string => (local.trim() ? local : serverHas(v) ? SERVER_KEY : "");

/** Drop-in for fetch: rewrites vendor URLs to the worker and removes any key header. */
export const vendorFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const v = (Object.keys(HOSTS) as Vendor[]).find((k) => url.startsWith(HOSTS[k]));
  if (!v) return fetch(input, init);
  await loadServerKeys();
  if (!serverHas(v)) return fetch(input, init);
  const h = new Headers(init?.headers);
  h.delete("Authorization"); h.delete("xi-api-key");
  return fetch(`${apiBase()}${v}/${url.slice(HOSTS[v].length)}`, { ...init, headers: h });
};

/** Save keys on the server (admin passphrase required). Empty string removes a key. */
export async function saveServerKeys(passphrase: string, keys: Partial<Record<Vendor, string>>, doFetch: typeof fetch = fetch): Promise<ServerKeys> {
  const r = await doFetch(`${apiBase()}keys`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${passphrase}` }, body: JSON.stringify(keys) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
  status = { openai: !!j.openai, elevenlabs: !!j.elevenlabs };
  loading = Promise.resolve(status);
  return status;
}
