// The public half of the phone remote. The game stays on the computer running `npm run dev`; that computer
// pushes the position here, and a phone on alderoberge.com reads it with the same join code.
// One Durable Object holds the live room. A wrong code learns nothing, and only the computer that opened the room can publish.

const JSON_LIMIT = 64 * 1024, FRAME_LIMIT = 512 * 1024, QUEUE_LIMIT = 20, SEEN_MS = 6000, HOST_STALE_MS = 20_000, STATE_STALE_MS = 10_000;
const SQUARE = /^[a-h][1-8]$/;
const ENDING = new Set(["resign", "draw", "takeback"]);

export interface BridgeNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(req: Request): Promise<Response> };
}

interface SqlCursor<T> { toArray(): T[] }
interface Sql { exec<T = Record<string, unknown>>(query: string, ...bindings: unknown[]): SqlCursor<T> }
export interface BridgeState {
  storage: { sql: Sql };
  blockConcurrencyWhile(fn: () => Promise<void>): Promise<void>;
}

interface RoomRow { token: string; code: string; rev: number; state: string | null; queue: string; touched: number }
interface Command { type: string; from?: string; to?: string; promotion?: string }

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

function command(raw: unknown): Command | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.type === "string" && ENDING.has(c.type)) return { type: c.type };
  if (c.type !== "move" || typeof c.from !== "string" || typeof c.to !== "string" || !SQUARE.test(c.from) || !SQUARE.test(c.to)) return null;
  if (c.promotion !== undefined && !(typeof c.promotion === "string" && "qrbn".includes(c.promotion) && c.promotion.length === 1)) return null;
  return { type: "move", from: c.from, to: c.to, ...(c.promotion ? { promotion: c.promotion as string } : {}) };
}

/** One live game. The computer publishes; phones with the join code read and send moves. */
export class GameBridge {
  private token = "";
  private code = "";
  private rev = 0;
  private state: string | null = null;
  private queue: Command[] = [];
  private touched = 0;
  private frames = new Map<string, { jpeg: Uint8Array; rev: number }>();
  private seen = new Map<string, number>();
  private ready: Promise<void>;

  constructor(private ctx: BridgeState, _env: unknown) {
    this.ready = ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS room (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        token TEXT NOT NULL,
        code TEXT NOT NULL,
        rev INTEGER NOT NULL,
        state TEXT,
        queue TEXT NOT NULL,
        touched INTEGER NOT NULL
      )`);
      const row = ctx.storage.sql.exec<RoomRow>("SELECT token, code, rev, state, queue, touched FROM room WHERE id = 1").toArray()[0];
      if (!row) return;
      this.token = row.token; this.code = row.code; this.rev = row.rev; this.state = row.state; this.touched = row.touched;
      try { this.queue = JSON.parse(row.queue) as Command[]; } catch { this.queue = []; }
    });
  }

  private save() {
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO room (id, token, code, rev, state, queue, touched) VALUES (1, ?, ?, ?, ?, ?, ?)",
      this.token, this.code, this.rev, this.state, JSON.stringify(this.queue), this.touched,
    );
  }

  private clients(now: number) {
    for (const [id, at] of this.seen) if (now - at > SEEN_MS) this.seen.delete(id);
    return this.seen.size;
  }

  private fresh(now: number) { return !!this.state && now - this.touched < STATE_STALE_MS; }

  async fetch(req: Request): Promise<Response> {
    await this.ready;
    const url = new URL(req.url);
    const route = url.pathname.replace(/^.*\/remote\//, "");
    const code = url.searchParams.get("code") ?? "";
    const now = Date.now();

    if (route.startsWith("host/")) {
      const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      if (token.length < 16) return json({ error: "missing host token" }, 401);
      const mine = !!this.token && token === this.token;
      if (this.token && !mine && now - this.touched < HOST_STALE_MS) return json({ error: "another computer is hosting this game" }, 409);
      if (route === "host/state" && req.method === "POST") {
        const raw = await req.text();
        if (raw.length > JSON_LIMIT) return json({ error: "request too large" }, 413);
        let parsed: { v?: number } | null = null;
        try { parsed = JSON.parse(raw); } catch { parsed = null; }
        if (!parsed || parsed.v !== 1) return json({ error: "Send the game as a version 1 state." }, 400);
        if (!mine) { this.rev = 0; this.queue = []; this.frames.clear(); }
        this.token = token; this.code = code; this.state = raw; this.rev++; this.touched = now;
        const commands = this.queue; this.queue = []; this.save();
        return json({ ok: true, commands, clients: this.clients(now), code });
      }
      if (route === "host/frame" && req.method === "POST") {
        const cam = url.searchParams.get("cam") ?? "";
        const buf = new Uint8Array(await req.arrayBuffer());
        if (!/^[\w-]{1,24}$/.test(cam) || !buf.length || buf.length > FRAME_LIMIT) return json({ error: "Send a camera id and a JPEG under 512 KB." }, 400);
        if (!this.fresh(now)) return json({ error: "The computer is not sharing a game right now." }, 503);
        this.frames.set(cam, { jpeg: buf, rev: (this.frames.get(cam)?.rev ?? 0) + 1 });
        this.touched = now;
        return json({ ok: true });
      }
      return json({ error: "No such host route." }, 404);
    }

    if (route.startsWith("api/")) {
      if (!this.token || this.code !== code || !/^\d{4,8}$/.test(code)) return json({ error: "Wrong or missing join code. Check the code on the computer." }, 401);
      const cid = (url.searchParams.get("cid") ?? "").slice(0, 40);
      if (cid) this.seen.set(cid, now);
      if (route === "api/state" && req.method === "GET") {
        const known = Number(url.searchParams.get("rev") ?? -1);
        if (!this.fresh(now)) return json({ rev: this.rev, waiting: true, clients: this.clients(now) });
        if (known === this.rev) return json({ rev: this.rev, clients: this.clients(now) });
        const frames = Object.fromEntries([...this.frames].map(([k, f]) => [k, f.rev]));
        return json({ rev: this.rev, clients: this.clients(now), state: JSON.parse(this.state!), frames });
      }
      if (route.startsWith("api/frame/") && req.method === "GET") {
        const f = this.frames.get(route.slice("api/frame/".length).replace(/\.jpg$/, ""));
        if (!f || !this.fresh(now)) return json({ error: "No picture from that camera yet." }, 404);
        return new Response(f.jpeg, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" } });
      }
      if (route === "api/cmd" && req.method === "POST") {
        const raw = await req.text();
        let body: unknown = null;
        try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
        const cmd = command(body);
        if (!cmd) return json({ error: "That is not a command. Send a move such as e2 to e4, or resign, draw, or takeback." }, 400);
        if (!this.fresh(now)) return json({ error: "The computer is not sharing a game right now." }, 503);
        if (this.queue.length >= QUEUE_LIMIT) return json({ error: "Too many moves waiting. Try again in a moment." }, 429);
        this.queue.push(cmd); this.save();
        return json({ ok: true });
      }
      return json({ error: "No such route." }, 404);
    }
    return json({ error: "No such route." }, 404);
  }
}

interface BridgeEnv { BRIDGE?: BridgeNamespace; KEYS?: { get(k: string): Promise<string | null>; put(k: string, v: string, o?: { expirationTtl?: number }): Promise<void> } }

/** Sends /chess/remote/* to the live room. Returns null when the URL is not a remote route. */
export async function handleRemote(req: Request, env: BridgeEnv, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith("/chess/remote/")) return null;
  if (!env.BRIDGE) return json({ error: "Phone bridge is not configured on this worker." }, 503);
  const code = url.searchParams.get("code") ?? "";
  if (!/^\d{4,8}$/.test(code)) return json({ error: "Wrong or missing join code. Check the code on the computer." }, 401);
  const ip = req.headers.get("CF-Connecting-IP") || "unknown";
  if (env.KEYS) {
    const minute = Math.floor(Date.now() / 60000);
    const key = `bridge:${ip}:${minute}`;
    const n = Number((await env.KEYS.get(key)) || 0) + 1;
    if (n > 1200) return json({ error: "rate limit: slow down" }, 429);
    await env.KEYS.put(key, String(n), { expirationTtl: 120 });
  }
  return env.BRIDGE.get(env.BRIDGE.idFromName("live")).fetch(req);
}
