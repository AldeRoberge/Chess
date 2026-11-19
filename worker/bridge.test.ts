// @vitest-environment node
import { describe, expect, it } from "vitest";
import worker, { type Env } from "./index";
import { GameBridge, type BridgeState } from "./bridge";

const state = JSON.stringify({ v: 1, fen: "start" });
const token = "h".repeat(20);

function memory(): BridgeState {
  let row: { token: string; code: string; rev: number; state: string | null; queue: string; touched: number } | null = null;
  return {
    blockConcurrencyWhile: async (fn) => { await fn(); },
    storage: { sql: { exec(query: string, ...binds: unknown[]) {
      if (query.includes("INSERT")) row = { token: String(binds[0]), code: String(binds[1]), rev: Number(binds[2]), state: binds[3] as string | null, queue: String(binds[4]), touched: Number(binds[5]) };
      return { toArray: () => query.includes("SELECT") && row ? [row] : [] };
    } } },
  } as BridgeState;
}

const post = (room: GameBridge, path: string, body: string, auth = token) =>
  room.fetch(new Request(`https://alderoberge.com/chess/remote/${path}`, { method: "POST", headers: { Authorization: `Bearer ${auth}` }, body }));

describe("phone bridge", () => {
  it("lets a phone read the game and send a move only with the code", async () => {
    const room = new GameBridge(memory(), {});
    expect((await post(room, "host/state?code=4321", state, "short")).status).toBe(401);
    expect((await post(room, "host/state?code=4321", state)).status).toBe(200);
    expect((await room.fetch(new Request("https://alderoberge.com/chess/remote/api/state?code=0000"))).status).toBe(401);
    const seen = await (await room.fetch(new Request("https://alderoberge.com/chess/remote/api/state?code=4321&cid=p&rev=-1"))).json();
    expect(seen.state).toMatchObject({ v: 1, fen: "start" });
    expect((await room.fetch(new Request("https://alderoberge.com/chess/remote/api/cmd?code=4321", { method: "POST", body: JSON.stringify({ type: "move", from: "e2", to: "e4" }) }))).status).toBe(200);
    const back = await (await post(room, "host/state?code=4321", state)).json();
    expect(back.commands).toEqual([{ type: "move", from: "e2", to: "e4" }]);
    expect((await post(room, "host/state?code=4321", state, "o".repeat(20))).status).toBe(409);
  });

  it("connects production hosts and phones in isolated rooms", async () => {
    const rooms = new Map<string, GameBridge>();
    const env = { BRIDGE: {
      idFromName: (name: string) => name,
      get: (id: unknown) => {
        const key = String(id);
        if (!rooms.has(key)) rooms.set(key, new GameBridge(memory(), {}));
        return rooms.get(key)!;
      },
    } } as unknown as Env;
    const root = "https://alderoberge.com/chess/remote/";
    const session = async () => (await worker.fetch(new Request(`${root}host/session`, { method: "POST" }), env)).json();
    const a = await session(), b = await session();
    expect(a.code).toMatch(/^\d{6}$/); expect(a.code).not.toBe(b.code);
    expect(a.urls).toEqual([`https://alderoberge.com/chess/#/remote?code=${a.code}`]);
    const publish = (code: string, auth: string) => worker.fetch(new Request(`${root}host/state?code=${code}`, {
      method: "POST", headers: { Authorization: `Bearer ${auth}` }, body: state,
    }), env);
    expect((await publish(a.code, b.token)).status).toBe(409);
    expect((await publish(a.code, a.token)).status).toBe(200);
    const phone = await (await worker.fetch(new Request(`${root}api/state?code=${a.code}&cid=phone`), env)).json();
    expect(phone.state).toMatchObject({ v: 1, fen: "start" }); expect(phone.token).toBeUndefined();
    expect((await worker.fetch(new Request(`${root}api/cmd?code=${a.code}`, { method: "POST", body: JSON.stringify({ type: "move", from: "e2", to: "e4" }) }), env)).status).toBe(200);
    expect((await (await publish(a.code, a.token)).json()).commands).toEqual([{ type: "move", from: "e2", to: "e4" }]);
    expect((await (await publish(b.code, b.token)).json()).commands).toEqual([]);
  });

  it("refuses a remote route with no room configured, and a code of the wrong shape", async () => {
    const env = { KEYS: { get: async () => null, put: async () => {}, delete: async () => {} }, ASSETS: { fetch: async () => new Response("asset") } } as Env;
    expect((await worker.fetch(new Request("https://alderoberge.com/chess/remote/api/state?code=4321"), env)).status).toBe(503);
    expect((await worker.fetch(new Request("https://alderoberge.com/chess/remote/api/state?code=no"), env)).status).toBe(401);
    expect(await (await worker.fetch(new Request("https://alderoberge.com/chess/"), env)).text()).toBe("asset");
  });
});
