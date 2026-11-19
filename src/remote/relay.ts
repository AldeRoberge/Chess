/**
 * The middle man between the computer running the table and phones on the same network. It runs inside the Vite dev/preview
 * server, so `npm run dev` is all it takes; there is no extra process and no dependency.
 *
 *   host (the app on this computer, reached as localhost)      client (a phone)
 *     POST host/state   push the game, collect phone moves        GET  api/state   poll the game
 *     POST host/frame   push a camera picture (JPEG)              GET  api/frame/<camera>.jpg
 *     GET  host/info    join code, addresses, phones online       POST api/cmd      send a move
 *
 * Host routes only answer requests that come from this computer. Client routes need the join code (shown on the host),
 * so another device on the same Wi-Fi cannot watch or move without it.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import { randomInt } from "node:crypto";
import { parseCommand, joinUrl, type RemoteCommand, type RemoteState } from "./protocol.ts";

export interface RelayOptions {
  /** Join code; a random four-digit one when omitted. */
  code?: string;
  /** Clock in ms, replaceable in tests. */
  now?: () => number;
  /** The machine's IPv4 addresses on its networks, replaceable in tests. */
  addresses?: () => string[];
}

const JSON_LIMIT = 64 * 1024, FRAME_LIMIT = 512 * 1024, QUEUE_LIMIT = 20, SEEN_MS = 6000;
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export const lanAddresses = (): string[] =>
  Object.values(networkInterfaces()).flatMap((list) => list ?? []).filter((n) => n.family === "IPv4" && !n.internal).map((n) => n.address);

function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const parts: Buffer[] = []; let size = 0, over = false;
    req.on("data", (c: Buffer) => { size += c.length; if (size > limit) over = true; else parts.push(c); });
    req.on("end", () => resolve(over ? null : Buffer.concat(parts)));
    req.on("error", () => resolve(null));
  });
}

function send(res: ServerResponse, status: number, body: unknown, type = "application/json") {
  const data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(data);
}

export function createRelay(opts: RelayOptions = {}) {
  const now = opts.now ?? Date.now;
  const code = opts.code ?? String(randomInt(1000, 10000));
  const addresses = opts.addresses ?? lanAddresses;
  let rev = 0, state: RemoteState | null = null;
  const frames = new Map<string, { jpeg: Buffer; rev: number }>();
  let queue: RemoteCommand[] = [];
  const seen = new Map<string, number>();

  const clients = () => { const t = now(); for (const [id, at] of seen) if (t - at > SEEN_MS) seen.delete(id); return seen.size; };

  /** Handles one request under `prefix` (for example "/remote/"). Returns false when the URL is not ours, so the server can carry on. */
  async function handle(req: IncomingMessage, res: ServerResponse, prefix: string): Promise<boolean> {
    const url = new URL(req.url ?? "/", "http://relay");
    if (!url.pathname.startsWith(prefix)) return false;
    const route = url.pathname.slice(prefix.length), method = req.method ?? "GET";

    if (route.startsWith("host/")) {
      if (!LOOPBACK.has(req.socket.remoteAddress ?? "")) { send(res, 403, { error: "Open the app on this computer as localhost to host a game." }); return true; }
      if (route === "host/info" && method === "GET") {
        const port = req.socket.localPort ?? 5173;
        send(res, 200, { code, clients: clients(), urls: addresses().map((a) => joinUrl(`http://${a}:${port}`, code, prefix.replace(/remote\/$/, ""))) });
      } else if (route === "host/state" && method === "POST") {
        const body = await readBody(req, JSON_LIMIT); let parsed: RemoteState | null = null;
        try { parsed = body ? JSON.parse(body.toString("utf8")) as RemoteState : null; } catch { parsed = null; }
        if (!parsed || parsed.v !== 1) { send(res, 400, { error: "Send the game as a version 1 state." }); return true; }
        state = parsed; rev++;
        const commands = queue; queue = [];
        send(res, 200, { ok: true, commands, clients: clients(), code });
      } else if (route === "host/frame" && method === "POST") {
        const cam = url.searchParams.get("cam") ?? "";
        const body = await readBody(req, FRAME_LIMIT);
        if (!/^[\w-]{1,24}$/.test(cam) || !body || !body.length) { send(res, 400, { error: "Send a camera id and a JPEG under 512 KB." }); return true; }
        frames.set(cam, { jpeg: body, rev: (frames.get(cam)?.rev ?? 0) + 1 });
        send(res, 200, { ok: true });
      } else send(res, 404, { error: "No such host route." });
      return true;
    }

    if (route.startsWith("api/")) {
      if (url.searchParams.get("code") !== code) { send(res, 401, { error: "Wrong or missing join code. Check the code on the computer." }); return true; }
      const cid = (url.searchParams.get("cid") ?? "").slice(0, 40);
      if (cid) seen.set(cid, now());
      if (route === "api/state" && method === "GET") {
        const known = Number(url.searchParams.get("rev") ?? -1);
        if (!state) send(res, 200, { rev, waiting: true, clients: clients() });
        else if (known === rev) send(res, 200, { rev, clients: clients() });
        else send(res, 200, { rev, clients: clients(), state, frames: Object.fromEntries([...frames].map(([k, f]) => [k, f.rev])) });
      } else if (route.startsWith("api/frame/") && method === "GET") {
        const f = frames.get(route.slice("api/frame/".length).replace(/\.jpg$/, ""));
        if (f) send(res, 200, f.jpeg, "image/jpeg"); else send(res, 404, { error: "No picture from that camera yet." });
      } else if (route === "api/cmd" && method === "POST") {
        const body = await readBody(req, JSON_LIMIT); let raw: unknown = null;
        try { raw = body ? JSON.parse(body.toString("utf8")) : null; } catch { raw = null; }
        const cmd = parseCommand(raw);
        if (!cmd) send(res, 400, { error: "That is not a move. Send from and to squares such as e2 and e4." });
        else if (!state || now() - state.t > 10_000) send(res, 503, { error: "The computer is not sharing a game right now." });
        else if (queue.length >= QUEUE_LIMIT) send(res, 429, { error: "Too many moves waiting. Try again in a moment." });
        else { queue.push(cmd); send(res, 200, { ok: true }); }
      } else send(res, 404, { error: "No such route." });
      return true;
    }
    send(res, 404, { error: "No such route." });
    return true;
  }

  return { code, handle, clients, get rev() { return rev; } };
}

export type Relay = ReturnType<typeof createRelay>;

/** The Vite plugin: mounts one relay on the dev server and on `vite preview`, under `<base>remote/`. */
export function remotePlugin(opts: RelayOptions = {}) {
  const relay = createRelay(opts);
  let prefix = "/remote/";
  const mount = (server: { middlewares: { use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void } }) =>
    server.middlewares.use((req, res, next) => { void relay.handle(req, res, prefix).then((done) => { if (!done) next(); }); });
  const announce = (port?: number) => {
    const p = port ?? 5173;
    const urls = (opts.addresses ?? lanAddresses)().map((a) => joinUrl(`http://${a}:${p}`, relay.code, prefix.replace(/remote\/$/, "")));
    console.log(`\n  Phone remote: join code ${relay.code}${urls.length ? `\n  Open on a phone on the same Wi-Fi: ${urls[0]}` : "\n  No network address found: connect this computer to Wi-Fi first."}\n`);
  };
  return {
    name: "chess-remote",
    configResolved(c: { base: string }) { prefix = `${c.base.endsWith("/") ? c.base : `${c.base}/`}remote/`; },
    configureServer(server: Parameters<typeof mount>[0] & { httpServer?: { once: (e: string, f: () => void) => void; address: () => unknown } | null }) {
      mount(server);
      server.httpServer?.once("listening", () => { const a = server.httpServer!.address(); announce(a && typeof a === "object" ? (a as { port: number }).port : undefined); });
    },
    configurePreviewServer(server: Parameters<typeof mount>[0]) { mount(server); },
  };
}
