import { describe, expect, it, vi } from "vitest";
import { Chess } from "chess.js";
import { RemoteHost, applyRemoteCommand, applyRemoteMove, dropStaleHint, encodeFrame, playMode, snapshot, type BusView } from "./host";
import type { RemoteState } from "./protocol";

const game = (over = false) => ({ fen: new Chess().fen(), turn: "w" as const, ply: 0, over, status: "synced", history: ["e4"], fidelity: 0.9, last: { from: "e2", to: "e4", san: "e4" } });
const bus = (o: Partial<BusView> = {}): BusView => ({ game: game(), director: { phase: "game" }, engineHint: null, botColor: null, cameras: [{ id: "A", online: true, quality: 0.8 }], lines: Array.from({ length: 7 }, (_, i) => ({ name: "Jean", text: `line ${i}` })), ...o });

describe("remote host", () => {
  it("shares reset guidance from the observed board only while setting up a new game", () => {
    const g = new Chess(); g.move("e4");
    const occ = new Float32Array(64), white = new Float32Array(64);
    g.board().flat().forEach((p, i) => { occ[i] = p ? 1 : 0; white[i] = p?.color === "w" ? 1 : 0; });
    const source = bus({ game: { ...game(), ply: 0, history: [] }, director: { phase: "idle" }, board: { occ, white, cams: 1, handOver: false } });
    const opts = { now: 5, virtualBoard: false, framed: new Set<string>(), notice: null };
    expect(snapshot(source, opts).setupMoves).toEqual([{ from: "e4", to: "e2", code: "wp" }]);
    source.director = { phase: "game" }; expect(snapshot(source, opts).setupMoves).toEqual([]);
    source.director = { phase: "idle" }; source.board!.handOver = true;
    expect(snapshot(source, opts).setupMoves).toEqual([]);
  });
  it("words the result of a finished game", () => {
    const mate = "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3";
    expect(snapshot(bus({ game: { ...game(true), fen: mate } }), { now: 5, virtualBoard: true, framed: new Set(), notice: null }).result).toBe("Checkmate. Black wins.");
    expect(snapshot(bus(), { now: 5, virtualBoard: true, framed: new Set(), notice: null }).result).toBeNull();
  });
  it("decides what a phone's move can do", () => {
    expect(playMode(bus(), true)).toBe("virtual"); expect(playMode(bus(), false)).toBe("hint");
    expect(playMode(bus({ game: null }), true)).toBe("off"); expect(playMode(bus({ game: game(true) }), true)).toBe("off");
    expect(playMode(bus({ botColor: "w" }), true)).toBe("off"); expect(playMode(bus({ botColor: "b" }), true)).toBe("virtual");
  });
  it("snapshots the game for phones, with only the latest five narration lines", () => {
    const s = snapshot(bus(), { now: 5, virtualBoard: true, framed: new Set(["A"]), notice: null });
    expect(s).toMatchObject({ v: 1, t: 5, phase: "game", turn: "w", moves: ["e4"], last: { san: "e4" }, play: "virtual", fidelity: 0.9, cameras: [{ id: "A", hasFrame: true }] });
    expect(s.lines).toHaveLength(5); expect(s.lines[4].text).toBe("line 6"); expect(s.clocks).toBeNull();
    expect(snapshot(bus({ clock: { white: { ms: 61000 }, black: { ms: 59000 }, running: "w" } }), { now: 5, virtualBoard: true, framed: new Set(), notice: null }).clocks).toEqual({ white: "1:01", black: "0:59", running: "w" });
    expect(snapshot(bus({ clock: { white: { ms: 0 }, black: { ms: 0 }, running: null } }), { now: 5, virtualBoard: true, framed: new Set(), notice: null }).clocks).toEqual({ white: "0:00", black: "0:00", running: null });
    const empty = snapshot(bus({ game: null, director: null }), { now: 1, virtualBoard: false, framed: new Set(), notice: null });
    expect(empty).toMatchObject({ phase: "idle", status: "pending", moves: [], last: null, over: false, play: "off", ply: 0 }); expect(empty.fen).toContain("rnbqkbnr");
    expect(snapshot(bus({ game: { ...game(), last: null } }), { now: 1, virtualBoard: true, framed: new Set(), notice: null }).last).toBeNull();
  });
  const ctx = (o: Partial<Parameters<typeof applyRemoteMove>[1]> = {}) => ({ mode: "virtual" as const, fen: new Chess().fen(), bus: { engineHint: null as { from: string; to: string } | null }, table: { busy: false, play: vi.fn(() => true) }, now: 7, botTurn: false, ...o });
  it("plays a phone's move on the virtual table", () => {
    const c = ctx(); expect(applyRemoteMove({ type: "move", from: "e2", to: "e4" }, c)).toEqual({ ok: true, text: "Playing e4." }); expect(c.table.play).toHaveBeenCalledWith("e2e4", 7);
    expect(applyRemoteMove({ type: "move", from: "e2", to: "e5" }, ctx())).toMatchObject({ ok: false });
    expect(applyRemoteMove({ type: "move", from: "e2", to: "e4" }, ctx({ table: { busy: true, play: vi.fn() } }))).toMatchObject({ ok: false, text: expect.stringContaining("still being played") });
    expect(applyRemoteMove({ type: "move", from: "e2", to: "e4" }, ctx({ table: { busy: false, play: vi.fn(() => false) } }))).toMatchObject({ ok: false, text: expect.stringContaining("could not play") });
    const promo = ctx({ fen: "8/4P3/8/8/8/8/8/k6K w - - 0 1" }); applyRemoteMove({ type: "move", from: "e7", to: "e8", promotion: "n" }, promo); expect(promo.table.play).toHaveBeenCalledWith("e7e8n", 7);
  });
  it("shows a phone's move as an arrow on a real board, and refuses when nobody may play", () => {
    const c = ctx({ mode: "hint" }); expect(applyRemoteMove({ type: "move", from: "g1", to: "f3" }, c)).toEqual({ ok: true, text: "Nf3 sent. Play g1 to f3 on the board." }); expect(c.bus.engineHint).toEqual({ from: "g1", to: "f3" });
    expect(applyRemoteMove({ type: "move", from: "e2", to: "e4" }, ctx({ mode: "off", botTurn: true })).text).toContain("bot's turn");
    expect(applyRemoteMove({ type: "move", from: "e2", to: "e4" }, ctx({ mode: "off" })).text).toContain("No game");
    expect(applyRemoteMove({ type: "move", from: "e2", to: "e4" }, ctx({ table: { busy: false, play: vi.fn(), over: true } })).text).toContain("over");
  });
  it("takes back, resigns, and agrees a draw from a phone", () => {
    const takeback = vi.fn(() => true);
    expect(applyRemoteCommand({ type: "takeback" }, ctx({ table: { busy: false, play: vi.fn(), takeback } }))).toEqual({ ok: true, text: "Takeback applied." });
    expect(applyRemoteCommand({ type: "takeback" }, ctx({ mode: "off", table: { busy: false, play: vi.fn(), takeback: vi.fn(() => true) } }))).toEqual({ ok: true, text: "Takeback applied." });
    expect(applyRemoteCommand({ type: "takeback" }, ctx({ table: { busy: true, play: vi.fn(), takeback: vi.fn() } })).text).toContain("still being played");
    expect(applyRemoteCommand({ type: "takeback" }, ctx({ table: { busy: false, play: vi.fn() } })).text).toContain("nothing to take back");
    const resign = vi.fn(() => true);
    expect(applyRemoteCommand({ type: "resign" }, ctx({ table: { busy: false, play: vi.fn(), resign } }))).toEqual({ ok: true, text: "White resigns." });
    expect(resign).toHaveBeenCalledWith("w");
    expect(applyRemoteCommand({ type: "resign" }, ctx({ fen: "8/8/8/8/8/8/8/k6K b - - 0 1", table: { busy: false, play: vi.fn(), resign: vi.fn(() => true) } })).text).toBe("Black resigns.");
    expect(applyRemoteCommand({ type: "resign" }, ctx({ table: { busy: false, play: vi.fn() } })).text).toContain("cannot resign");
    expect(applyRemoteCommand({ type: "resign" }, ctx({ table: { busy: false, play: vi.fn(), resign: vi.fn(() => false) } })).text).toContain("already over");
    expect(applyRemoteCommand({ type: "resign" }, ctx({ mode: "off" })).text).toContain("No game");
    expect(applyRemoteCommand({ type: "draw" }, ctx({ table: { busy: false, play: vi.fn(), agreeDraw: vi.fn(() => true) } }))).toEqual({ ok: true, text: "Draw agreed." });
    expect(applyRemoteCommand({ type: "draw" }, ctx({ table: { busy: false, play: vi.fn() } })).text).toContain("cannot agree");
    expect(applyRemoteCommand({ type: "draw" }, ctx({ table: { busy: false, play: vi.fn(), agreeDraw: vi.fn(() => false) } })).text).toContain("already over");
    expect(applyRemoteCommand({ type: "draw" }, ctx({ mode: "off", botTurn: true })).text).toContain("bot's turn");
    expect(applyRemoteCommand({ type: "move", from: "e2", to: "e4" }, ctx())).toEqual({ ok: true, text: "Playing e4." });
  });
  it("takes a phone's arrow off once the position changes, and never touches another source's hint", () => {
    const b = bus(); applyRemoteMove({ type: "move", from: "g1", to: "f3" }, { ...ctx({ mode: "hint" }), bus: b });
    dropStaleHint(b); expect(b.engineHint).toEqual({ from: "g1", to: "f3" }); // same position: still shown
    b.game = { ...game(), fen: "rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1" }; snapshot(b, { now: 1, virtualBoard: false, framed: new Set(), notice: null }); expect(b.engineHint).toBeNull();
    const c = bus(); applyRemoteMove({ type: "move", from: "g1", to: "f3" }, { ...ctx({ mode: "hint" }), bus: c });
    c.engineHint = { from: "d2", to: "d4" }; c.game = { ...game(), fen: "other" }; dropStaleHint(c); expect(c.engineHint).toEqual({ from: "d2", to: "d4" }); // the engine replaced it
    const d = bus(); dropStaleHint(d); expect(d.engineHint).toBeNull();
  });
  it("encodes a camera frame as a picture, or says it cannot", async () => {
    const frame = { width: 4, height: 2, data: new Uint8ClampedArray(8).fill(9), t: 0 };
    const orig = HTMLCanvasElement.prototype.toBlob; HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) { cb(new Blob(["x"], { type: "image/jpeg" })); };
    try { expect(await encodeFrame(frame)).toBeInstanceOf(Blob); } finally { HTMLCanvasElement.prototype.toBlob = orig; }
    const ctxOrig = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = (() => null) as never;
    try { expect(await encodeFrame(frame)).toBeNull(); } finally { HTMLCanvasElement.prototype.getContext = ctxOrig; }
  });

  const make = (fetchFn: ReturnType<typeof vi.fn>, extra: Partial<ConstructorParameters<typeof RemoteHost>[0]> = {}) => {
    const command = vi.fn(() => ({ ok: true, text: "Playing e4." }));
    const host = new RemoteHost({ base: "/remote/", build: (framed, notice, now) => snapshot(bus(), { now, virtualBoard: true, framed, notice }) as RemoteState, frames: () => [{ id: "A", frame: { width: 1, height: 1, data: new Uint8ClampedArray(1), t: 0 } }], command, fetchFn: fetchFn as never, encode: async () => new Blob(["j"]), ...extra });
    return { host, command };
  };
  const reply = (body: unknown, ok = true) => Promise.resolve({ ok, json: async () => body } as Response);
  const flush = () => new Promise((r) => setTimeout(r, 5));

  it("finds out whether this server has a relay, and stays quiet when it has none", async () => {
    const f = vi.fn(() => reply({}, false)); const { host } = make(f);
    host.tick(0); host.tick(1); await flush(); expect(host.available).toBe(false); host.tick(1000); await flush(); expect(f).toHaveBeenCalledTimes(1);
    const bad = make(vi.fn(() => Promise.reject(new Error("offline")))); bad.host.tick(0); await flush(); expect(bad.host.available).toBe(false);
  });
  it("publishes the game, runs phone moves and reports their outcome", async () => {
    const posts: string[] = [];
    const f = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith("host/info")) return reply({ code: "1234", urls: ["http://a/"], clients: 1 });
      posts.push(`${url}|${init?.body && typeof init.body === "string" ? JSON.parse(init.body).notice?.text ?? "" : "frame"}`);
      return url.endsWith("host/state") ? reply({ clients: 1, code: "1234", commands: [{ type: "move", from: "e2", to: "e4" }] }) : reply({ ok: true });
    });
    const { host, command } = make(f);
    host.tick(0); await flush(); expect(host).toMatchObject({ available: true, code: "1234", urls: ["http://a/"], clients: 1 });
    host.tick(10); await flush(); expect(command).toHaveBeenCalledWith({ type: "move", from: "e2", to: "e4" }, 10);
    const frames = () => posts.filter((p) => p.startsWith("/remote/host/frame?cam=A")).length;
    await flush(); expect(frames()).toBe(1); // a watching phone gets a picture straight away
    host.tick(20); await flush(); expect(frames()).toBe(1); // then at most one a second
    host.tick(1500); await flush(); expect(frames()).toBe(2);
    host.tick(2000); await flush(); expect(posts.some((p) => p.endsWith("|Playing e4."))).toBe(true); // the next state carries the notice
  });
  it("sends no pictures while nobody is watching, and survives failures", async () => {
    const f = vi.fn((url: string) => url.endsWith("host/info") ? reply({ code: "1", urls: [], clients: 0 }) : url.endsWith("host/state") ? reply({ clients: 0 }) : reply({}, false));
    const { host } = make(f); host.tick(0); await flush(); host.tick(10); await flush(); host.tick(2000); await flush();
    expect(f.mock.calls.some((c) => String(c[0]).includes("host/frame"))).toBe(false);
    const down = vi.fn((url: string) => url.endsWith("host/info") ? reply({ code: "1", urls: [], clients: 2 }) : Promise.reject(new Error("gone")));
    const d = make(down); d.host.tick(0); await flush(); d.host.tick(10); await flush(); d.host.tick(1500); await flush(); expect(d.host.available).toBe(true);
    const nope = make(vi.fn((url: string) => url.endsWith("host/info") ? reply({ code: "1", clients: 1 }) : reply({ ok: true })), { encode: async () => null }); nope.host.tick(0); await flush(); nope.host.tick(2000); await flush(); expect(nope.host.urls).toEqual([]);
  });
  it("publishes production games with host credentials and collects phone moves", async () => {
    const f = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith("host/session")) {
        expect(init?.method).toBe("POST");
        return reply({ code: "654321", token: "private-host-token", urls: ["https://alderoberge.com/chess/#/remote?code=654321"], clients: 1 });
      }
      expect(init?.headers).toMatchObject({ Authorization: "Bearer private-host-token" });
      expect(url).toContain("code=654321");
      return reply({ clients: 1, commands: url.includes("host/state") ? [{ type: "move", from: "e2", to: "e4" }] : [] });
    });
    const { host, command } = make(f, { cloud: true, base: "/chess/remote/" });
    host.tick(0); await flush(); expect(host.available).toBe(true);
    host.tick(10); await flush();
    expect(command).toHaveBeenCalledWith({ type: "move", from: "e2", to: "e4" }, 10);
    expect(f.mock.calls.some(([url]) => url.includes("host/frame?cam=A&code=654321"))).toBe(true);
  });

  it("uses the browser's fetch when none is injected", () => { expect(() => new RemoteHost({ base: "/", build: () => ({}) as never, frames: () => [], command: () => ({ ok: true, text: "" }) })).not.toThrow(); });
});
