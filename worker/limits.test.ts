// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { ProxyLimits } from "./limits";

afterEach(() => vi.useRealTimers());

it("enforces shared per-IP and daily quotas atomically and expires each window", async () => {
  const db = new DatabaseSync(":memory:");
  const limiter = new ProxyLimits({ storage: { sql: { exec(query, ...args) {
    const statement = db.prepare(query);
    const rows = statement.all(...args as (string | number)[]) as { n: number }[];
    return { toArray: () => rows };
  } } } });
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-19T12:00:00Z"));
  const call = (ip = "a") => limiter.fetch(new Request("https://limits/", {
    method: "POST", body: JSON.stringify({ ip, vendor: "openai", rate: 2, daily: 3 }),
  }));
  try {
    expect((await call()).status).toBe(204);
    expect((await call()).status).toBe(204);
    expect(await (await call()).text()).toBe("rate limit: slow down");
    vi.advanceTimersByTime(60_000);
    expect((await call()).status).toBe(204);
    expect(await (await call("b")).text()).toBe("daily limit reached");
    vi.advanceTimersByTime(86_400_000);
    expect((await call()).status).toBe(204);
    expect(db.prepare("SELECT count(*) AS n FROM counters").get()?.n).toBe(2);
  } finally { db.close(); }
});
