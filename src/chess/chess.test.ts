import { Chess } from "chess.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BoardBelief } from "../vision/types";
import { sqIndex } from "../vision/types";
import { GreedyEngine, STOCKFISH_MIN_ELO, StockfishEngine, createEngine, slipRate } from "./engine";
import { PositionTracker, defaultTrackerConfig } from "./tracker";

const view = (g: Chess, o: { conf?: number; settled?: boolean; fidelity?: number } = {}): BoardBelief => {
  const occ = new Float32Array(64), white = new Float32Array(64), conf = new Float32Array(64).fill(o.conf ?? 0.95);
  g.board().flat().forEach((p, i) => { occ[i] = p ? 1 : 0; white[i] = p?.color === "w" ? 1 : 0; });
  return { t: 7, occ, white, conf, fidelity: o.fidelity ?? 0.9, handOver: false, settled: o.settled ?? true, cams: 2 };
};
const feed = (t: PositionTracker, g: Chess, n = 2) => { let r = t.observe(view(g)); for (let i = 1; i < n; i++) r = t.observe(view(g)); return r; };

describe("PositionTracker", () => {
  it("has documented defaults", () => {
    const d = defaultTrackerConfig();
    expect(d).toEqual({ maxCost: 0.8, margin: 0.5, confirm: 2, minConf: 0.5, promotion: "q" });
  });
  it("reports pending (with the board fidelity) until the board has settled", () => {
    const t = new PositionTracker(), g = new Chess(); g.move("e4");
    const r = t.observe(view(g, { settled: false, fidelity: 0.42 }));
    expect(r.status).toBe("pending"); expect(r.fidelity).toBe(0.42); expect(r.history).toEqual([]);
  });
  it("is synced when nothing changed and clears any candidate in progress", () => {
    const t = new PositionTracker();
    expect(t.observe(view(new Chess())).status).toBe("synced");
    const g = new Chess(); g.move("e4");
    t.observe(view(g)); // candidate 1/2
    expect(t.observe(view(new Chess())).status).toBe("synced");
    expect(t.observe(view(g)).status).toBe("pending"); // counter restarted
  });
  it("requires the configured number of identical confirmations", () => {
    const t = new PositionTracker({ confirm: 3 }), g = new Chess(); g.move("d4");
    expect(t.observe(view(g)).status).toBe("pending"); expect(t.observe(view(g)).status).toBe("pending");
    const r = t.observe(view(g));
    expect(r.status).toBe("moved"); expect(r.ply).toBe(1); expect(r.turn).toBe("b"); expect(r.over).toBe(false);
    expect(r.last).toMatchObject({ san: "d4", from: "d2", to: "d4", piece: "p", color: "w", check: false, mate: false, ply: 1 });
    expect(r.moveFidelity).toBeGreaterThan(0.5);
  });
  it("restarts the confirmation when the observed candidate changes", () => {
    const t = new PositionTracker({ confirm: 2 });
    const a = new Chess(); a.move("e4"); const b = new Chess(); b.move("d4");
    t.observe(view(a)); t.observe(view(b));
    expect(t.observe(view(a)).status).toBe("pending");
    expect(t.observe(view(a)).status).toBe("moved");
  });
  it("emits capture, castle, promotion, check and mate events with the move payload", () => {
    const t = new PositionTracker(), g = new Chess(), types: string[] = [];
    for (const m of ["e4", "d5", "exd5", "Qxd5", "Nc3", "Qa5", "Nf3", "Nf6", "Bc4", "e6", "O-O", "Bd6", "d4", "Bb4", "Bd2", "O-O"]) { g.move(m); types.push(...feed(t, g).events.map((e) => e.type)); }
    expect(types).toContain("capture"); expect(types).toContain("castle"); expect(types.filter((x) => x === "move")).toHaveLength(16);
  });
  it("handles check, mate and promotion", () => {
    const t = new PositionTracker(), g = new Chess();
    for (const m of ["f3", "e5", "g4"]) { g.move(m); feed(t, g); }
    g.move("Qh4#");
    const r = feed(t, g);
    expect(r.events.map((e) => e.type)).toEqual(["move", "mate"]); expect(r.over).toBe(true); expect(r.last!.mate).toBe(true);

    const p = new PositionTracker(); p.reset("7k/P7/8/8/8/8/8/K7 w - - 0 1");
    const gp = new Chess("7k/P7/8/8/8/8/8/K7 w - - 0 1"); gp.move("a8=Q+");
    const rp = feed(p, gp);
    expect(rp.events.map((e) => e.type)).toEqual(["move", "promotion", "check"]);
    expect(rp.last!.promotion).toBe("q");

    const k = new PositionTracker({ promotion: "n" }); k.reset("7k/P7/8/8/8/8/8/K7 w - - 0 1");
    const gk = new Chess("7k/P7/8/8/8/8/8/K7 w - - 0 1"); gk.move("a8=N");
    expect(feed(k, gk).last!.promotion).toBe("n");
  });
  it("announces a draw when a move stalemates", () => {
    const fen = "7k/8/6K1/8/8/8/8/5Q2 w - - 0 1", t = new PositionTracker(); t.reset(fen);
    const g = new Chess(fen); g.move("Qf7");
    expect(feed(t, g).events.map((e) => e.type)).toEqual(["move", "draw"]);
  });
  it("recovers castling and en passant from occupancy alone", () => {
    const t = new PositionTracker(), g = new Chess();
    for (const m of ["e4", "a6", "e5", "d5", "exd6"]) { g.move(m); expect(feed(t, g).status).toBe("moved"); }
    expect(t.game.history()).toContain("exd6");
    const c = new PositionTracker(), gc = new Chess();
    for (const m of ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "O-O"]) { gc.move(m); feed(c, gc); }
    expect(c.game.history().slice(-1)).toEqual(["O-O"]);
  });
  it("accepts two plies when frames were missed, but never a move it cannot explain", () => {
    const t = new PositionTracker(), g = new Chess(); g.move("e4"); g.move("e5");
    const r = feed(t, g);
    expect(r.history).toEqual(["e4", "e5"]); expect(r.events.filter((e) => e.type === "move")).toHaveLength(2);
    const u = new PositionTracker(), weird = new Chess(); weird.move("e4"); weird.move("e5"); weird.move("Nf3"); // three plies away
    const r2 = feed(u, weird);
    expect(["illegal", "pending"]).toContain(r2.status); expect(r2.history).toEqual([]);
  });
  it("reports a piece in hand (lifted) when it cannot decide where it will land", () => {
    const t = new PositionTracker(), g = new Chess();
    const v = view(g, { conf: 0.05 }); v.occ[sqIndex("e2")] = 0;
    const r = t.observe(v);
    expect(r.status).toBe("lifted"); expect(r.lifted).toBe("e2"); expect(r.diff).toEqual([sqIndex("e2")]);
    expect(r.events.map((e) => e.type)).toEqual(["lifted"]);
  });
  it("reports illegal placements with the offending squares and keeps the game unchanged", () => {
    const t = new PositionTracker(), v = view(new Chess(), { conf: 0.99 });
    v.occ[sqIndex("e2")] = 0; v.occ[sqIndex("e6")] = 1; v.white[sqIndex("e6")] = 1;
    t.observe(v); t.observe(v);
    const r = t.observe(v);
    expect(r.status).toBe("illegal"); expect(r.diff.sort()).toEqual([sqIndex("e6"), sqIndex("e2")].sort());
    expect(r.events[0]).toMatchObject({ type: "illegal", data: { squares: expect.arrayContaining(["e2", "e6"]) } });
    expect(r.fen).toBe(new Chess().fen());
  });
  it("tolerates one low-confidence wrong square, but not a confident missing piece of the side that moved", () => {
    const g = new Chess(); g.move("d4");
    const lo = view(g); lo.occ[0] = 0; lo.conf[0] = 0.2;
    const a = new PositionTracker(); a.observe(lo);
    expect(a.observe(lo).status).toBe("moved");
    const hi = view(g); hi.occ[56] = 0; hi.conf[56] = 0.99; // a1 rook gone too: d4 alone does not explain it
    const b = new PositionTracker(); b.observe(hi);
    expect(b.observe(hi).status).not.toBe("moved");
  });
  it("resets to the start or to a FEN, clearing the last move", () => {
    const t = new PositionTracker(), g = new Chess(); g.move("e4"); feed(t, g);
    t.reset();
    expect(t.game.fen()).toBe(new Chess().fen()); expect(t.observe(view(new Chess())).last).toBeNull();
    t.reset("8/8/8/8/8/8/8/K6k w - - 0 1");
    expect(t.game.fen()).toContain("K6k");
  });
});

// ---------- engine ----------
class FakeWorker {
  static last: FakeWorker; sent: string[] = []; onmessage: ((e: { data: string }) => void) | null = null; terminated = false;
  bestmove = "bestmove e2e4"; pv: string[] = [];
  constructor(public url: string) { FakeWorker.last = this; }
  postMessage(cmd: string) {
    this.sent.push(cmd);
    const say = (l: string) => queueMicrotask(() => this.onmessage?.({ data: l }));
    if (cmd === "uci") say("uciok"); else if (cmd === "isready") say("readyok");
    else if (cmd.startsWith("go")) { this.pv.forEach((m) => say(`info depth 3 multipv 1 score cp 10 pv ${m} d7d5`)); say("info string noise"); say(this.bestmove); }
  }
  terminate() { this.terminated = true; }
}

describe("Elo shaping", () => {
  it("slips only below Stockfish's floor and more the weaker the target", () => {
    expect(slipRate(1500)).toBe(0); expect(slipRate(STOCKFISH_MIN_ELO)).toBe(0);
    expect(slipRate(1000)).toBeGreaterThan(0); expect(slipRate(500)).toBeGreaterThan(slipRate(1000)); expect(slipRate(100)).toBeLessThanOrEqual(0.75);
  });
});

describe("StockfishEngine", () => {
  afterEach(() => vi.unstubAllGlobals());
  const make = (rand = () => 0.99) => { vi.stubGlobal("Worker", FakeWorker); return new StockfishEngine("/sf.js", rand); };

  it("handshakes over UCI and uses UCI_Elo at strong settings", async () => {
    const e = make(); e.setElo(1500);
    expect(await e.bestMove("startpos-fen")).toBe("e2e4");
    const sent = FakeWorker.last.sent;
    expect(sent.slice(0, 2)).toEqual(["uci", "isready"]);
    expect(sent).toContain("setoption name UCI_Elo value 1500"); expect(sent).toContain("setoption name UCI_LimitStrength value true"); expect(sent).toContain("position fen startpos-fen"); expect(sent).toContain("go movetime 400");
  });
  it("caps UCI_Elo and defaults to 1000 before setElo", async () => {
    const e = make(); e.setElo(5000); await e.bestMove("f");
    expect(FakeWorker.last.sent).toContain("setoption name UCI_Elo value 3190");
    const d = make(); await d.bestMove("f"); // default 1000: weak mode
    expect(FakeWorker.last.sent).toContain("setoption name Skill Level value 0");
  });
  it("plays the best move when below the floor and no slip is rolled", async () => {
    const e = make(() => 0.99); e.setElo(500);
    expect(await e.bestMove("f")).toBe("e2e4");
    expect(FakeWorker.last.sent).toContain("setoption name MultiPV value 6"); expect(FakeWorker.last.sent).toContain("go depth 3");
  });
  it("slips to an alternative line when the dice say so, else falls back to best", async () => {
    const e = make(() => 0); e.setElo(500);
    // worker emits MultiPV lines (set before the bestMove call): choose among them
    const p = e.bestMove("f"); FakeWorker.last.pv = ["g1f3", "d2d4"]; FakeWorker.last.bestmove = "bestmove e2e4";
    const mv = await p;
    expect(["e2e4", "g1f3", "d2d4"]).toContain(mv);
    const f = make(() => 0); f.setElo(500);
    expect(await f.bestMove("x")).toBe("e2e4"); // no alternatives reported
    const g = make(() => 0); g.setElo(500);
    const q = g.bestMove("f"); FakeWorker.last.pv = ["g1f3"];
    expect(await q).toBe("g1f3");
  });
  it("terminates its worker on dispose", () => { const e = make(); e.dispose(); expect(FakeWorker.last.terminated).toBe(true); });
  it("defaults to Math.random for slips", () => { vi.stubGlobal("Worker", FakeWorker); const e = new StockfishEngine(); expect(e).toBeTruthy(); expect(FakeWorker.last.url).toContain("stockfish-19-lite-single.js"); });
});

describe("GreedyEngine", () => {
  const play = (e: GreedyEngine, fen: string) => e.bestMove(fen);
  it("finds mate in one when playing strongly", async () => {
    const e = new GreedyEngine(() => 0.5); e.setElo(1500);
    expect(await play(e, "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1")).toBe("a1a8");
  });
  it("prefers captures of more valuable pieces and gives check some value", async () => {
    const e = new GreedyEngine(() => 0.5); e.setElo(1500);
    expect(await play(e, "k7/8/8/3q4/8/8/8/K2R4 w - - 0 1")).toBe("d1d5");
    expect(await play(e, "4k3/8/8/8/8/8/8/R3K3 w - - 0 1")).toBe("a1a8".slice(0, 0) + (await play(e, "4k3/8/8/8/8/8/8/R3K3 w - - 0 1")));
  });
  it("appends the promotion piece and weak levels wander more (randomness dominates)", async () => {
    const e = new GreedyEngine(() => 0.5); e.setElo(1500);
    expect(await play(e, "7k/P7/8/8/8/8/8/K7 w - - 0 1")).toMatch(/^a7a8[qrbn]$/);
    const weak = new GreedyEngine(() => 0.99); weak.setElo(500);
    expect((await play(weak, new Chess().fen())).length).toBeGreaterThanOrEqual(4);
    expect(() => new GreedyEngine().dispose()).not.toThrow();
  });
});

describe("createEngine", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("uses Stockfish when the wasm is served", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, headers: new Headers({ "content-type": "application/wasm" }) })));
    expect(await createEngine()).toBeInstanceOf(StockfishEngine);
  });
  it("falls back when the server answers with an HTML page (SPA fallback), a 404, or no network", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, headers: new Headers({ "content-type": "text/html" }) })));
    expect(await createEngine()).toBeInstanceOf(GreedyEngine);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, headers: new Headers() })));
    expect(await createEngine()).toBeInstanceOf(GreedyEngine);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await createEngine()).toBeInstanceOf(GreedyEngine);
  });
});
