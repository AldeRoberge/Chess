import { Chess } from "chess.js";
import { describe, expect, it, vi } from "vitest";
import { analyzePosition } from "./analysis";

class FakeWorker {
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  commands: string[] = [];
  constructor(private lines = "info depth 14 multipv 1 score cp 82 nodes 100 pv e2e4 e7e5\nbestmove e2e4", private respond = true) {}
  postMessage(command: string) {
    this.commands.push(command);
    if (!this.respond) return;
    const reply = command === "uci" ? "id name Stockfish\nuciok" : command === "isready" ? "readyok" : command.startsWith("go ") ? this.lines : null;
    if (reply) queueMicrotask(() => this.onmessage?.({ data: reply }));
  }
}

describe("isolated Stockfish analysis", () => {
  it("does UCI initialization, uses full strength, and reports legal SAN/PV and White-relative centipawns", async () => {
    const worker = new FakeWorker(), fen = new Chess().fen();
    const result = await analyzePosition(fen, { worker: () => worker as unknown as Worker, movetime_ms: 99999 });
    expect(result).toMatchObject({ engine: "Stockfish", fen, depth: 14, turn: "w", score: { unit: "centipawns", white: 82, bound: "exact" }, best_move: { uci: "e2e4", san: "e4" }, principal_variation: [{ uci: "e2e4", san: "e4" }, { uci: "e7e5", san: "e5" }] });
    expect(worker.commands).toContain("setoption name UCI_LimitStrength value false");
    expect(worker.commands).toContain(`position fen ${fen}`); expect(worker.commands.at(-1)).toBe("go movetime 5000");
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it("reverses Black-to-move scores and bound direction, ignores alternate PVs", async () => {
    const game = new Chess(); game.move("e4");
    const worker = new FakeWorker("info depth 9 multipv 1 score cp -120 lowerbound pv e7e5\ninfo depth 9 multipv 2 score cp 999 pv d7d5\nbestmove e7e5");
    const result = await analyzePosition(game.fen(), { worker: () => worker as unknown as Worker });
    expect(result.score).toEqual({ unit: "centipawns", white: 120, bound: "upper" }); expect(result.best_move?.san).toBe("e5");
    const mate = new FakeWorker("info depth 10 score mate 3 pv e7e5\nbestmove e7e5");
    expect((await analyzePosition(game.fen(), { worker: () => mate as unknown as Worker })).score).toEqual({ unit: "mate", white: -3, bound: "exact" });
  });
  it("handles terminal games without loading a worker", async () => {
    const game = new Chess(); for (const move of ["f3", "e5", "g4", "Qh4#"]) game.move(move);
    const worker = vi.fn();
    expect(await analyzePosition(game.fen(), { worker })).toMatchObject({ engine: "rules", terminal: "Black won by checkmate", best_move: null });
    expect(worker).not.toHaveBeenCalled();
  });
  it("rejects bad positions, worker load errors, and invalid engine moves", async () => {
    const factory = vi.fn(); await expect(analyzePosition("garbage", { worker: factory })).rejects.toThrow(); expect(factory).not.toHaveBeenCalled();
    const worker = new FakeWorker("bestmove a1a8"); await expect(analyzePosition(new Chess().fen(), { worker: () => worker as unknown as Worker })).rejects.toThrow(); expect(worker.terminate).toHaveBeenCalledOnce();
    const failed = new FakeWorker("", false), pending = analyzePosition(new Chess().fen(), { worker: () => failed as unknown as Worker });
    failed.onerror?.(); await expect(pending).rejects.toThrow(/could not load/); expect(failed.terminate).toHaveBeenCalledOnce();
  });
  it("terminates on cancellation and timeout, including an aborted-before-start signal", async () => {
    const ctl = new AbortController(), worker = new FakeWorker("", false);
    const pending = analyzePosition(new Chess().fen(), { worker: () => worker as unknown as Worker, signal: ctl.signal });
    ctl.abort(); await expect(pending).rejects.toMatchObject({ name: "AbortError" }); expect(worker.terminate).toHaveBeenCalledOnce();
    const factory = vi.fn(); await expect(analyzePosition(new Chess().fen(), { signal: ctl.signal, worker: factory })).rejects.toMatchObject({ name: "AbortError" }); expect(factory).not.toHaveBeenCalled();
    const silent = new FakeWorker("", false);
    await expect(analyzePosition(new Chess().fen(), { worker: () => silent as unknown as Worker, timeout_ms: 5 })).rejects.toThrow(/timed out/);
    expect(silent.terminate).toHaveBeenCalledOnce();
  });
});
