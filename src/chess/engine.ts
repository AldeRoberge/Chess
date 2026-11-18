import { Chess } from "chess.js";

export interface Engine {
  setElo(elo: number): void;
  bestMove(fen: string): Promise<string>; // UCI move, e.g. "e2e4"
  dispose(): void;
}

/** Elo below Stockfish's own floor (~1320) is emulated: weak search + occasional deliberate slips. */
export const STOCKFISH_MIN_ELO = 1350;
export const slipRate = (elo: number) => (elo >= STOCKFISH_MIN_ELO ? 0 : Math.min(0.75, ((STOCKFISH_MIN_ELO - elo) / 900) * 0.75));

/** Stockfish 19 lite (single-thread WASM). Needs `npm run setup:stockfish` (copies into /stockfish/). */
export class StockfishEngine implements Engine {
  private w: Worker;
  private elo = 1000;
  private pending: ((line: string) => void) | null = null;
  private ready: Promise<void>;
  private rand: () => number;

  constructor(url = `${import.meta.env.BASE_URL}stockfish/stockfish-19-lite-single.js`, rand = Math.random) {
    this.rand = rand;
    this.w = new Worker(url);
    this.w.onmessage = (e) => this.pending?.(String(e.data));
    this.ready = this.send("uci", (l) => l === "uciok").then(() => this.send("isready", (l) => l === "readyok"));
  }

  private send(cmd: string, until: (line: string) => boolean, collect?: string[]): Promise<void> {
    return new Promise((resolve) => {
      this.pending = (l) => {
        collect?.push(l);
        if (until(l)) { this.pending = null; resolve(); }
      };
      this.w.postMessage(cmd);
    });
  }

  setElo(elo: number) {
    this.elo = elo;
  }

  async bestMove(fen: string): Promise<string> {
    await this.ready;
    const slow = this.elo < STOCKFISH_MIN_ELO;
    if (slow) {
      this.w.postMessage("setoption name UCI_LimitStrength value false");
      this.w.postMessage("setoption name Skill Level value 0");
      this.w.postMessage("setoption name MultiPV value 6");
    } else {
      this.w.postMessage("setoption name MultiPV value 1");
      this.w.postMessage("setoption name Skill Level value 20");
      this.w.postMessage("setoption name UCI_LimitStrength value true");
      this.w.postMessage(`setoption name UCI_Elo value ${Math.min(3190, this.elo)}`);
    }
    this.w.postMessage(`position fen ${fen}`);
    const lines: string[] = [];
    await this.send(slow ? "go depth 3" : "go movetime 400", (l) => l.startsWith("bestmove"), lines);
    const best = lines.find((l) => l.startsWith("bestmove"))!.split(" ")[1];
    if (!slow || this.rand() > slipRate(this.elo)) return best;
    // deliberate slip: choose among the alternatives Stockfish saw
    const alts = [...new Set(lines.filter((l) => l.includes(" pv ")).map((l) => l.split(" pv ")[1].split(" ")[0]))];
    return alts.length ? alts[Math.floor(this.rand() * alts.length)] : best;
  }

  dispose() {
    this.w.terminate();
  }
}

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Dependency-free fallback so the experience still plays if the WASM file is missing. */
export class GreedyEngine implements Engine {
  private elo = 800;
  constructor(private rand = Math.random) {}
  setElo(e: number) { this.elo = e; }
  async bestMove(fen: string) {
    const g = new Chess(fen);
    const moves = g.moves({ verbose: true });
    const greed = Math.min(1, this.elo / 1500);
    let best = moves[0], bs = -1e9;
    for (const m of moves) {
      let s = this.rand() * (1.5 - greed) * 4;
      if (m.captured) s += VALUE[m.captured] * greed * 2;
      g.move(m);
      if (g.isCheckmate()) s += 100;
      else if (g.inCheck()) s += 0.5;
      g.undo();
      if (s > bs) { bs = s; best = m; }
    }
    return best.from + best.to + (best.promotion ?? "");
  }
  dispose() {}
}

export async function createEngine(): Promise<Engine> {
  try {
    const head = await fetch(`${import.meta.env.BASE_URL}stockfish/stockfish-19-lite-single.wasm`, { method: "HEAD" });
    if (head.ok && !String(head.headers.get("content-type")).includes("html")) return new StockfishEngine();
  } catch { /* fall through */ }
  return new GreedyEngine();
}
