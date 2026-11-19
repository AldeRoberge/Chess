import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createRelay, lanAddresses, remotePlugin } from "./relay";
import type { RemoteState } from "./protocol";

let server: Server | null = null;
afterEach(() => { server?.close(); server = null; });

const state = (t = Date.now()): RemoteState => ({ v: 1, t, phase: "game", status: "synced", fen: "x", turn: "w", ply: 0, over: false, moves: [], last: null, hint: null, fidelity: 1, cameras: [], lines: [], play: "virtual", notice: null });

async function boot(opts: Parameters<typeof createRelay>[0] = { code: "4321", addresses: () => ["10.0.0.5"] }, prefix = "/remote/") {
  const relay = createRelay(opts);
  server = createServer((req, res) => { void relay.handle(req, res, prefix).then((done) => { if (!done) { res.writeHead(404); res.end("not ours"); } }); });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const call = (path: string, init: { method?: string; body?: string | Buffer } = {}) => fetch(`http://127.0.0.1:${port}${path}`, init as RequestInit);
  return { relay, call, port };
}

describe("relay", () => {
  it("tells the host its code, addresses and phones, and ignores URLs that are not under its prefix", async () => {
    const { call, port } = await boot();
    const info = await (await call("/remote/host/info")).json();
    expect(info).toEqual({ code: "4321", clients: 0, urls: [`http://10.0.0.5:${port}/#/remote?code=4321`] });
    expect((await call("/other")).status).toBe(404);
    expect((await call("/remote/nope")).status).toBe(404);
    expect((await call("/remote/host/nope")).status).toBe(404);
  });
  it("refuses host routes from another machine", async () => {
    const { relay } = await boot();
    const res = { writeHead: (s: number) => { status = s; }, end: () => {} } as never; let status = 0;
    await relay.handle({ url: "/remote/host/info", method: "GET", socket: { remoteAddress: "192.168.1.9" } } as never, res, "/remote/");
    expect(status).toBe(403);
  });
  it("makes phones present the join code", async () => {
    const { call } = await boot();
    expect((await call("/remote/api/state")).status).toBe(401); expect((await call("/remote/api/state?code=0000")).status).toBe(401);
    expect((await call("/remote/api/state?code=4321")).status).toBe(200);
  });
  it("carries the game from host to phone, and only resends it when it changed", async () => {
    const { call } = await boot();
    expect(await (await call("/remote/api/state?code=4321&cid=a")).json()).toMatchObject({ waiting: true });
    expect((await call("/remote/host/state", { method: "POST", body: "{nope" })).status).toBe(400);
    expect((await call("/remote/host/state", { method: "POST", body: JSON.stringify({ v: 2 }) })).status).toBe(400);
    const post = await (await call("/remote/host/state", { method: "POST", body: JSON.stringify(state()) })).json();
    expect(post).toMatchObject({ ok: true, commands: [], clients: 1, code: "4321" });
    const first = await (await call("/remote/api/state?code=4321&cid=a&rev=-1")).json();
    expect(first.state.phase).toBe("game"); expect(first.rev).toBe(1);
    const same = await (await call("/remote/api/state?code=4321&cid=a&rev=1")).json();
    expect(same.state).toBeUndefined(); expect(same.rev).toBe(1);
  });
  it("queues moves from phones and hands them to the host once", async () => {
    const { call } = await boot();
    const move = { type: "move", from: "e2", to: "e4" };
    expect((await call("/remote/api/cmd?code=4321", { method: "POST", body: JSON.stringify(move) })).status).toBe(503); // nothing shared yet
    await call("/remote/host/state", { method: "POST", body: JSON.stringify(state()) });
    expect((await call("/remote/api/cmd?code=4321", { method: "POST", body: "nonsense" })).status).toBe(400);
    expect((await call("/remote/api/cmd?code=4321", { method: "POST", body: JSON.stringify({ type: "move", from: "z9", to: "e4" }) })).status).toBe(400);
    expect((await call("/remote/api/cmd?code=4321", { method: "POST", body: JSON.stringify(move) })).status).toBe(200);
    const got = await (await call("/remote/host/state", { method: "POST", body: JSON.stringify(state()) })).json();
    expect(got.commands).toEqual([move]);
    expect((await (await call("/remote/host/state", { method: "POST", body: JSON.stringify(state()) })).json()).commands).toEqual([]);
    for (let i = 0; i < 20; i++) await call("/remote/api/cmd?code=4321", { method: "POST", body: JSON.stringify(move) });
    expect((await call("/remote/api/cmd?code=4321", { method: "POST", body: JSON.stringify(move) })).status).toBe(429);
    expect((await call("/remote/api/cmd?code=4321")).status).toBe(404);
  });
  it("stops taking moves when the host has gone quiet", async () => {
    let t = 1_000_000;
    const { call } = await boot({ code: "1", now: () => t });
    await call("/remote/host/state", { method: "POST", body: JSON.stringify(state(t)) });
    t += 20_000;
    expect((await call("/remote/api/cmd?code=1", { method: "POST", body: JSON.stringify({ type: "move", from: "e2", to: "e4" }) })).status).toBe(503);
  });
  it("stores camera pictures per camera and serves the latest", async () => {
    const { call } = await boot();
    const jpeg = Buffer.from([0xff, 0xd8, 1, 2, 3]);
    expect((await call("/remote/api/frame/A.jpg?code=4321")).status).toBe(404);
    expect((await call("/remote/host/frame?cam=A", { method: "POST", body: jpeg })).status).toBe(200);
    expect((await call("/remote/host/frame?cam=bad%20id!", { method: "POST", body: jpeg })).status).toBe(400);
    expect((await call("/remote/host/frame?cam=A", { method: "POST", body: Buffer.alloc(0) })).status).toBe(400);
    expect((await call("/remote/host/frame?cam=A", { method: "POST", body: Buffer.alloc(600 * 1024, 1) })).status).toBe(400);
    const r = await call("/remote/api/frame/A.jpg?code=4321"); expect(r.headers.get("content-type")).toBe("image/jpeg"); expect(Buffer.from(await r.arrayBuffer())).toEqual(jpeg);
    await call("/remote/host/state", { method: "POST", body: JSON.stringify(state()) });
    expect((await (await call("/remote/api/state?code=4321&rev=-1")).json()).frames).toEqual({ A: 1 });
  });
  it("counts a phone as connected for a few seconds after it last asked", async () => {
    let t = 0; const { call, relay } = await boot({ code: "1", now: () => t });
    await call("/remote/api/state?code=1&cid=a"); await call("/remote/api/state?code=1&cid=b"); expect(relay.clients()).toBe(2);
    t = 10_000; await call("/remote/api/state?code=1&cid=a"); expect(relay.clients()).toBe(1);
  });
  it("works under a base path and with a random code", async () => {
    const { relay, call } = await boot({ addresses: () => [] }, "/chess/remote/");
    expect(relay.code).toMatch(/^\d{4}$/); expect(relay.rev).toBe(0);
    expect((await call("/chess/remote/host/info")).status).toBe(200);
  });
  it("lists this machine's network addresses without throwing", () => { expect(Array.isArray(lanAddresses())).toBe(true); });
  it("plugs into the dev and preview servers and says how to join", async () => {
    const logs: string[] = []; const orig = console.log; console.log = (m: string) => { logs.push(String(m)); };
    try {
      const plugin = remotePlugin({ code: "7777", addresses: () => ["10.0.0.5"] });
      plugin.configResolved({ base: "/chess" });
      const used: ((req: never, res: never, next: () => void) => void)[] = []; let onListening = () => {};
      plugin.configureServer({ middlewares: { use: (f) => used.push(f as never) }, httpServer: { once: (_e, f) => { onListening = f; }, address: () => ({ port: 5173 }) } });
      onListening(); expect(logs.join("")).toContain("join code 7777"); expect(logs.join("")).toContain("http://10.0.0.5:5173/chess/#/remote?code=7777");
      plugin.configurePreviewServer({ middlewares: { use: (f) => used.push(f as never) } }); expect(used).toHaveLength(2);
      let nexted = false; used[0]({ url: "/elsewhere", method: "GET", socket: {} } as never, {} as never, () => { nexted = true; });
      await new Promise((r) => setTimeout(r, 20)); expect(nexted).toBe(true);
      const quiet = remotePlugin({ addresses: () => [] }); quiet.configureServer({ middlewares: { use: () => {} }, httpServer: { once: (_e, f) => f(), address: () => "pipe" } });
      expect(logs.join("")).toContain("No network address found");
      remotePlugin().configureServer({ middlewares: { use: () => {} }, httpServer: null });
    } finally { console.log = orig; }
  });
  it("answers 'too big' bodies and broken uploads without crashing", async () => {
    const { port } = await boot();
    const status = await new Promise<number>((resolve) => { const r = request({ port, host: "127.0.0.1", path: "/remote/host/state", method: "POST" }, (res) => resolve(res.statusCode ?? 0)); r.end("x".repeat(70 * 1024)); });
    expect(status).toBe(400);
  });
});
