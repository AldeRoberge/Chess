/** Atomic counters in one small SQLite object; KV is only for administrator key edits. */
export class ProxyLimits {
  constructor(private ctx: { storage: { sql: { exec(query: string, ...args: unknown[]): { toArray(): { n: number }[] } } } }) {
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, n INTEGER NOT NULL, expires INTEGER NOT NULL)");
    ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS counters_expiry ON counters(expires)");
  }
  async fetch(req: Request) {
    const { ip, vendor, rate, daily } = await req.json() as { ip: string; vendor: string; rate: number; daily: number };
    const now = Date.now(), minute = Math.floor(now / 60_000), day = Math.floor(now / 86_400_000);
    const sql = this.ctx.storage.sql;
    sql.exec("DELETE FROM counters WHERE expires <= ?", now);
    const keys = [`ip:${ip}:${minute}`, `day:${vendor}:${day}`];
    const limits = [rate, daily];
    for (let i = 0; i < keys.length; i++) {
      const n = sql.exec("SELECT n FROM counters WHERE key = ?", keys[i]).toArray()[0]?.n ?? 0;
      if (n >= limits[i]) return new Response(i === 0 ? "rate limit: slow down" : "daily limit reached", { status: 429 });
    }
    for (let i = 0; i < keys.length; i++) sql.exec("INSERT INTO counters (key, n, expires) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET n = n + 1", keys[i], i === 0 ? (minute + 1) * 60_000 : (day + 1) * 86_400_000);
    return new Response(null, { status: 204 });
  }
}
