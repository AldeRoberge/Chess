import { findBoardCorners, findCheckerCorners } from "../vision/findBoard";
import type { GrayFrame, Pt } from "../vision/types";
import { GOOD, type GridGuide, guideDrift, iconLevels, scoreAlignment, traceSquareGuide } from "./boardGuide";
import { squareToQuad } from "./quadMap";

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const rot = (c: Pt[], k: number) => c.map((_, i) => c[(i + k) % 4]);
/** Mean length of the four edges, in pixels. A square is a eighth of it. */
const sideOf = (c: Pt[]) => c.reduce((s, p, i) => s + dist(p, c[(i + 1) % 4]), 0) / 4;
const convex = (c: Pt[]) => {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4], d = c[(i + 2) % 4], cr = (b.x - a.x) * (d.y - b.y) - (b.y - a.y) * (d.x - b.x);
    if (Math.abs(cr) < 1e-6) return false;
    if (!sign) sign = Math.sign(cr); else if (Math.sign(cr) !== sign) return false;
  }
  return true;
};

/** A board fills a believable part of the picture: not a speck, and not so big that much of it hangs outside. */
const MIN_AREA = 0.05, MAX_AREA = 1.1, MIN_INSIDE = 0.8;
/**
 * Guards every guess the auto-detect makes. A board is never assumed to be tiny or enormous: its area must be a sensible
 * share of the frame, and most of the grid must lie inside the picture (a corner or two a little outside is fine).
 */
export function plausibleBoard(q: Pt[], f: { width: number; height: number }): boolean {
  if (q.length !== 4 || q.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return false;
  let a2 = 0;
  for (let i = 0; i < 4; i++) { const p = q[i], n = q[(i + 1) % 4]; a2 += p.x * n.y - n.x * p.y; }
  const share = Math.abs(a2) / 2 / (f.width * f.height);
  if (share < MIN_AREA || share > MAX_AREA) return false;
  let inside = 0, total = 0;
  const N = 12;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const u = (i + 0.5) / N, v = (j + 0.5) / N;
    const top = { x: q[0].x + (q[1].x - q[0].x) * u, y: q[0].y + (q[1].y - q[0].y) * u }, bot = { x: q[3].x + (q[2].x - q[3].x) * u, y: q[3].y + (q[2].y - q[3].y) * u };
    const x = top.x + (bot.x - top.x) * v, y = top.y + (bot.y - top.y) * v;
    total++; if (x >= 0 && x <= f.width && y >= 0 && y <= f.height) inside++;
  }
  return inside / total >= MIN_INSIDE;
}

export interface Eval {
  /** Lower is better: distance from the real edges, a tilt penalty, a penalty for leaving the traced square lines, and a penalty for squares that show no contrast. */
  cost: number;
  q: number;
  error: number;
  flipped: boolean;
  contrast: number;
}

/** How well a quad fits the picture. `guide` is the square edges already traced; leaving them costs, so the corners keep that perspective. The colour-order penalty is left out here: it is only used to choose between rotations. */
export function evaluate(f: GrayFrame, c: Pt[], guide?: GridGuide | null): Eval {
  if (!convex(c)) return { cost: Infinity, q: 0, error: 1, flipped: false, contrast: 0 };
  const a = scoreAlignment(f, squareToQuad(c));
  const drift = guide ? guideDrift(guide, squareToQuad(c), sideOf(c) / 8) : 0;
  // `error` is where the lines agree (the empty middle decides that). `fine` alone can look good while those lines are still off, because it throws away the worst stretches.
  return { cost: a.fine + a.error * 0.8 + a.warp * 0.85 + drift * 0.7 + (1 - clamp(a.contrast / 40, 0, 1)) * 0.15 + a.outside * 0.3, q: a.q, error: a.error, flipped: a.flipped, contrast: a.contrast };
}

/** Fit above which a layout is trusted without trying others. */
const SURE = 0.85;

/** How much of the start position's pieces show up where the grid says they should be (0..1). Zero when it cannot be read or the position is not the start. */
function pieceScore(f: GrayFrame, c: Pt[], _q: number): number {
  try { const l = iconLevels(f, c, 1); return l.length ? l.reduce((s, v) => s + v, 0) / l.length : 0; } catch { return 0; }
}

/** Grid fit, nudged by the pieces: they can only confirm a fit, never sink one (the position may not be the start). */
const blend = (ev: Eval, pieces: number) => clamp(ev.q * (0.85 + 0.15 * pieces), 0, 1);

/** High confidence: the grid fits and is the right way round, or fits well and the pieces agree. */
const isSure = (ev: Eval, pieces: number) => !ev.flipped && (ev.q >= SURE || (ev.q >= GOOD && pieces >= 0.6));

/** Traces the square edges once and, when they agree, moves the corners onto the perspective they describe. */
function withGuide(f: GrayFrame, pts: Pt[]): { corners: Pt[]; guide: GridGuide | null } {
  return traceSquareGuide(f, pts) ?? { corners: pts, guide: null };
}

const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];

/**
 * Hill climbing on the quad: at each step size, nudge the whole quad and then each corner in 8 directions, keeping what
 * lowers the cost, until nothing helps. Yields after every corner so a caller can spread the work over frames.
 */
function* climb(f: GrayFrame, start: Pt[], steps: number[], maxIter: number, show?: (p: Pt[]) => void, guide?: GridGuide | null): Generator<void, { pts: Pt[]; ev: Eval }> {
  let pts = start, ev = evaluate(f, pts, guide);
  for (const st of steps) {
    for (let it = 0; it < maxIter; it++) {
      let improved = false;
      for (const [dx, dy] of DIRS) {
        const t = pts.map((p) => ({ x: p.x + dx * st, y: p.y + dy * st })), e = evaluate(f, t, guide);
        if (e.cost < ev.cost - 1e-4) { pts = t; ev = e; improved = true; }
      }
      yield;
      for (let i = 0; i < 4; i++) {
        let moved = true;
        // keep going the same way while it helps, so a far corner arrives in a few moves
        for (let guard = 0; moved && guard < 6; guard++) {
          moved = false;
          for (const [dx, dy] of DIRS) {
            const t = pts.map((p, j) => (j === i ? { x: p.x + dx * st, y: p.y + dy * st } : p)), e = evaluate(f, t, guide);
            if (e.cost < ev.cost - 1e-4) { pts = t; ev = e; improved = moved = true; }
          }
        }
        show?.(pts); yield;
      }
      if (!improved) break;
    }
  }
  return { pts, ev };
}

/**
 * Picks the corner order (which of the four is a8) that has the colours the right way round (a1 is dark). When two
 * orders tie (the board looks the same turned half way), the start position's pieces decide, then the order closest to `ref`.
 */
export function pickRotation(f: GrayFrame, pts: Pt[], ref: Pt[] | null): Pt[] {
  const opts = [0, 1, 2, 3].map((k) => { const c = rot(pts, k); return { c, ev: evaluate(f, c), near: ref ? c.reduce((s, p, i) => s + dist(p, ref[i]), 0) : 0 }; });
  const ok = opts.filter((o) => !o.ev.flipped);
  const pool = ok.length ? ok : opts, best = Math.min(...pool.map((o) => o.ev.cost)), tie = pool.filter((o) => o.ev.cost <= best + 0.02);
  if (tie.length === 1) return tie[0].c;
  const pieces = tie.map((o) => { try { const l = iconLevels(f, o.c, 1); return l.reduce((s, v) => s + v, 0) / l.length; } catch { return 0; } });
  const top = Math.max(...pieces), low = Math.min(...pieces);
  if (top - low > 0.2) return tie[pieces.indexOf(top)].c;
  return tie.reduce((a, b) => (b.near < a.near ? b : a)).c;
}

const MEM_KEY = "cx.align.v1";
const MEM_MAX = 8;
export interface CornerStore { getItem(key: string): string | null; setItem(key: string, value: string): void }

function quadOf(v: unknown): Pt[] | null {
  if (!Array.isArray(v) || v.length !== 4) return null;
  const pts: Pt[] = [];
  for (const p of v) {
    if (!p || typeof p !== "object") return null;
    const x = Number((p as Pt).x), y = Number((p as Pt).y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    pts.push({ x, y });
  }
  return pts;
}

/** Earlier alignments, scaled onto this picture. Stored as fractions of the frame so a different resolution still lands in the same place. */
export function rememberedLayouts(width: number, height: number, store: CornerStore = localStorage): Pt[][] {
  if (!(width > 0) || !(height > 0)) return [];
  try {
    const raw = JSON.parse(store.getItem(MEM_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    const out: Pt[][] = [];
    for (const item of raw) {
      const q = quadOf(item);
      if (!q) continue;
      out.push(q.map((p) => ({ x: p.x * width, y: p.y * height })));
      if (out.length >= MEM_MAX) break;
    }
    return out;
  } catch { return []; }
}

function nearQuad(a: Pt[], b: Pt[], scale: number) {
  return a.reduce((s, p, i) => s + dist(p, b[i]), 0) / 4 < scale * 0.02;
}

/** Keeps this alignment for the next auto-detect, including after a reload. A repeat of one already stored just moves it to the front. */
export function rememberLayout(pts: Pt[], width: number, height: number, store: CornerStore = localStorage) {
  if (!(width > 0) || !(height > 0) || pts.length !== 4) return;
  const norm = pts.map((p) => ({ x: p.x / width, y: p.y / height }));
  const prev = rememberedLayouts(width, height, store).map((q) => q.map((p) => ({ x: p.x / width, y: p.y / height })));
  const next = [norm, ...prev.filter((q) => !nearQuad(q, norm, 1))].slice(0, MEM_MAX);
  try { store.setItem(MEM_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
}

/** Guesses at where the board is. Each one is a reading: the corners the board's printed letters and digits imply (found by OCR), the corners already on screen, the checkerboard period, the perspective those square edges imply, an alignment kept from an earlier run, or, when no squares were found, the outline of the busy patch. Nothing here is a shifted copy of another guess. */
export function candidateLayouts(f: GrayFrame, current: Pt[] | null, prior: Pt[][] = [], labels: Pt[][] = []): Pt[][] {
  const out: Pt[][] = [];
  const push = (q: Pt[] | null | undefined) => {
    if (!q || q.length !== 4 || q.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return;
    const sq = sideOf(q) / 8;
    if (!(sq > 2) || !plausibleBoard(q, f)) return;
    if (out.some((c) => c.reduce((s, p, i) => s + dist(p, q[i]), 0) / 4 < sq * 0.3)) return;
    out.push(q.map((p) => ({ x: p.x, y: p.y })));
  };
  let checker: Pt[] | null = null;
  try { checker = findCheckerCorners(f); } catch { checker = null; }
  // the printed letters and digits are the strongest clue, so they are tried first
  for (const q of labels) push(q);
  push(current);
  push(checker);
  for (const seed of [labels[0], current, checker]) {
    if (!seed) continue;
    try { push(traceSquareGuide(f, seed)?.corners); } catch { /* the picture is not readable there */ }
  }
  for (const q of prior) push(q);
  if (!checker) push(findBoardCorners(f));
  return out;
}

/** How far the refined layouts end up from the merged one, on average, in squares. */
const spreadOf = (all: Pt[][], mid: Pt[]) => all.reduce((s, c) => s + c.reduce((t, p, i) => t + dist(p, mid[i]), 0) / 4, 0) / all.length / (sideOf(mid) / 8);

export interface AlignStatus { phase: "idle" | "find" | "try" | "merge" | "polish" | "done" | "failed"; progress: number; confidence: number; label: string }

/**
 * Finds the board from scratch and settles the grid on it. It tries each informed reading (the corners on screen, the checkerboard, the perspective of those edges, and alignments kept from earlier runs), refines each one against the
 * picture, reads the straight edges of the squares (the empty middle counts the most) and uses those lines as the
 * perspective, then merges them slowly (a step at a time, re-fitting at each) into one that sits on the square edges.
 * Call `step(budgetMs)` every frame; read `corners`, `progress`, `confidence` and `label` to show it.
 */
export class AutoAligner implements AlignStatus {
  phase: AlignStatus["phase"] = "find"; progress = 0; confidence = 0; label = "Looking for the board…";
  corners: Pt[]; changed = false;
  private gen: Generator<void, void>;
  /** Corner guesses read from the letters and digits printed round the board, and whether they are still being read. */
  private labels: Pt[][] = []; private reading = false;
  /** `paceMs` is how long each merge step takes on screen; 0 runs it flat out (tests). */
  constructor(private f: GrayFrame, private start: Pt[] | null, private paceMs = 140, private now: () => number = () => performance.now(), private prior: Pt[][] = []) {
    this.corners = start ?? [];
    this.gen = this.run();
  }
  /**
   * Hands over the OCR reading of the board labels (see `labelHints`). The search does not wait for it: it starts at once
   * and, if the reading arrives while it still has layouts to try, tries those corners next. They are only a guess (the
   * OCR can misread), so they are fitted and scored like any other layout and lose to a better fit.
   */
  expectLabels(p: Promise<Pt[][]>) {
    this.reading = true;
    p.then((q) => { this.labels = q ?? []; }, () => { /* no labels: carry on without */ }).finally(() => { this.reading = false; });
  }
  get done() { return this.phase === "done" || this.phase === "failed"; }
  /** Runs for about `budgetMs`; true while there is more to do. */
  step(budgetMs = 10) {
    const end = this.now() + budgetMs;
    while (!this.done && this.now() < end) { if (this.gen.next().done) break; }
    return !this.done;
  }
  private set(pts: Pt[]) { this.corners = pts; this.changed = true; }
  private *run(): Generator<void, void> {
    const f = this.f;
    // An already aligned grid is a successful detection. Do not replace it
    // with exploratory layouts or change its established corner order.
    if (this.start?.length === 4) {
      const current = evaluate(f, this.start);
      if (current.q >= GOOD && !current.flipped) {
        this.set(this.start.map((p) => ({ ...p })));
        this.confidence = current.q; this.progress = 1;
        this.phase = "done"; this.label = "Kept existing alignment";
        return;
      }
    }
    this.phase = "find"; this.label = "Looking for the board…"; yield;
    const cands = candidateLayouts(f, this.start, this.prior);
    // with nothing else to go on, the letters are all there is: wait for them
    while (!cands.length && this.reading) yield;
    let usedLabels = false;
    const pullLabels = (at: number) => {
      if (usedLabels || !this.labels.length) return;
      usedLabels = true;
      for (const q of this.labels.slice().reverse()) {
        if (q.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)) || !(sideOf(q) / 8 > 2) || !plausibleBoard(q, f)) continue;
        if (cands.some((c) => c.reduce((t, p, i) => t + dist(p, q[i]), 0) / 4 < (sideOf(q) / 8) * 0.3)) continue;
        cands.splice(at, 0, q);
      }
    };
    pullLabels(0);
    if (!cands.length) { this.phase = "failed"; this.label = "No board found. Drag the corners onto it."; return; }
    const done: { pts: Pt[]; ev: Eval; guide: GridGuide | null; pieces: number }[] = [];
    this.phase = "try";
    let sure = false;
    for (let i = 0; i < cands.length && !sure; i++) {
      pullLabels(i); // the OCR may have finished while the last layout was being fitted
      const N = cands.length;
      this.label = `Trying layout ${i + 1} of ${N}`; this.progress = 0.05 + 0.6 * (i / N); this.set(cands[i]); yield;
      const sq = sideOf(cands[i]) / 8;
      // a candidate that already fits well only needs fine steps; do not throw it around
      const head = evaluate(f, cands[i]);
      const coarse = yield* climb(f, cands[i], head.q >= SURE && !head.flipped ? [sq * 0.1, sq * 0.05] : [sq * 0.4, sq * 0.2, sq * 0.1, sq * 0.05], 20, (p) => this.set(p));
      this.progress = 0.05 + 0.6 * ((i + 0.7) / N);
      const turned = pickRotation(f, coarse.pts, this.start ?? this.labels[0] ?? null);
      this.label = "Lining up with the square edges…"; this.set(turned); yield;
      const guided = withGuide(f, turned);
      this.set(guided.corners); yield;
      const fine = yield* climb(f, guided.corners, [2, 1, 0.5], 8, (p) => this.set(p), guided.guide);
      const pieces = pieceScore(f, fine.pts, fine.ev.q);
      done.push({ pts: fine.pts, ev: fine.ev, guide: guided.guide, pieces }); this.confidence = blend(fine.ev, pieces); this.set(fine.pts);
      // high confidence: stop exploring and just polish this one
      if (isSure(fine.ev, pieces)) sure = true;
      if (i + 1 === cands.length && !sure) pullLabels(i + 1); // last one tried: the letters may have just arrived
    }
    // the start position's pieces break ties between layouts that fit the squares about equally
    const adj = (d: { ev: Eval; pieces: number }) => d.ev.cost - d.pieces * 0.1;
    // keep the layouts that agree with the best one; the rest found something else (a table edge, a shadow)
    const best = done.reduce((a, b) => (adj(b) < adj(a) ? b : a)), sq = sideOf(best.pts) / 8;
    const keep = sure ? [best] : done.filter((d) => d.pts.reduce((s, p, i) => s + dist(p, best.pts[i]), 0) / 4 < sq * 0.6);
    const w = keep.map((d) => Math.exp(-(d.ev.cost - best.ev.cost) / 0.03)), wsum = w.reduce((a, b) => a + b, 0);
    const target = best.pts.map((_, i) => ({ x: keep.reduce((s, d, k) => s + d.pts[i].x * w[k], 0) / wsum, y: keep.reduce((s, d, k) => s + d.pts[i].y * w[k], 0) / wsum }));
    // merge slowly: walk from the best layout to the average in small steps, re-fitting at every one. One layout has nothing to merge.
    this.phase = "merge"; const M = keep.length < 2 ? 0 : 8;
    let cur = best.pts, top = best;
    for (let m = 1; m <= M; m++) {
      this.label = `Merging ${keep.length} layouts (${m}/${M})`; this.progress = 0.7 + 0.2 * (m / M);
      const mix = best.pts.map((p, i) => ({ x: p.x + (target[i].x - p.x) * (m / M), y: p.y + (target[i].y - p.y) * (m / M) }));
      const r = yield* climb(f, mix, [0.8, 0.4], 3, undefined, best.guide);
      cur = r.pts; if (evaluate(f, r.pts).cost < evaluate(f, top.pts).cost) top = { pts: r.pts, ev: r.ev, guide: best.guide, pieces: best.pieces };
      this.set(cur); this.confidence = r.ev.q;
      const until = this.now() + this.paceMs; while (this.now() < until) yield;
    }
    this.phase = "polish"; this.label = "Lining up with the square edges…"; this.progress = 0.92; this.set(top.pts); yield;
    // work toward more confidence: re-trace and refine while it keeps paying off, stop when it is stuck
    let result: { pts: Pt[]; ev: Eval } = { pts: top.pts, ev: evaluate(f, top.pts) };
    let stuck = 0;
    for (let round = 0; round < 5 && stuck < 2; round++) {
      const polished = withGuide(f, result.pts);
      this.set(polished.corners); yield;
      const fin = yield* climb(f, polished.corners, round === 0 ? [0.5, 0.25, 0.12] : [0.25, 0.12, 0.06], 12, (p) => this.set(p), polished.guide);
      const fe = evaluate(f, fin.pts);
      if (fe.cost < result.ev.cost - 0.002) { result = { pts: fin.pts, ev: fe }; stuck = 0; this.set(result.pts); this.confidence = blend(fe, pieceScore(f, fin.pts, fe.q)); }
      else stuck++;
      this.progress = 0.92 + 0.07 * ((round + 1) / 5);
      if (stuck === 0 && fe.q >= 0.95 && !fe.flipped) break; // as good as it gets
    }
    this.set(result.pts);
    // sure when the grid fits, the colours are right and the pieces sit where the start position says; when several layouts were merged, they must also agree
    const pieces = pieceScore(f, result.pts, result.ev.q);
    const agree = keep.length < 2 ? 1 : clamp(1 - spreadOf(keep.map((d) => d.pts), result.pts) / 0.5, 0, 1);
    this.confidence = blend(result.ev, pieces) * (0.7 + 0.3 * agree) * (result.ev.flipped ? 0.4 : 1);
    this.progress = 1; this.phase = "done";
    this.label = this.confidence >= GOOD ? "Aligned" : result.ev.contrast < 4 ? "Done, but the squares are hard to see" : "Done, but not a perfect fit";
  }
}

/**
 * Keeps the grid on the board after a camera nudge. Every half second it re-reads how well the grid fits; when that
 * drops from what it was when locked, it re-fits locally from the current corners (small steps, so a hand over the
 * board does not drag the grid away) and eases the corners over to the new place. If that cannot recover the fit
 * for a while, it says the board is lost.
 */
export class AlignFollower {
  private base: Eval | null = null; private last = 0; private job: Generator<void, { pts: Pt[]; ev: Eval }> | null = null; private from: Pt[] = []; private bad = 0; private guide: GridGuide | null = null;
  /** Where the corners are heading, and when the ease last stepped. The grid glides there instead of jumping. */
  private aim: Pt[] | null = null; private glideAt = 0;
  status: "locked" | "adjusting" | "lost" | "idle" = "idle";
  constructor(private checkMs = 500, private now: () => number = () => performance.now()) {}
  get locked() { return this.base !== null; }
  lock(f: GrayFrame, pts: Pt[]) { this.base = evaluate(f, pts); this.job = null; this.aim = null; this.bad = 0; this.status = "locked"; this.last = this.now(); }
  unlock() { this.base = null; this.job = null; this.aim = null; this.status = "idle"; }
  /** One step of the glide toward the latest fit, or null when the grid is already where it should be. */
  private glide(pts: Pt[]): Pt[] | null {
    const aim = this.aim;
    if (!aim || aim.length !== pts.length) return null;
    const now = this.now();
    const dt = Math.max(16, Math.min(180, now - this.glideAt));
    this.glideAt = now;
    const a = 1 - Math.exp(-dt / 150);
    const next = pts.map((p, i) => ({ x: p.x + (aim[i].x - p.x) * a, y: p.y + (aim[i].y - p.y) * a }));
    const left = Math.max(...aim.map((p, i) => Math.hypot(p.x - next[i].x, p.y - next[i].y)));
    if (left < 0.4) { this.aim = null; if (this.status !== "lost") this.status = "locked"; return aim.map((p) => ({ x: p.x, y: p.y })); }
    this.status = "adjusting";
    return next;
  }
  /** Returns corrected corners when the camera moved and the grid was re-fitted; null otherwise. */
  tick(f: GrayFrame, pts: Pt[], budgetMs = 6): Pt[] | null {
    if (!this.base) return null;
    const t = this.now();
    // Leave a glide alone: a second fit in the middle of it would tug the corners off the ease.
    if (!this.job && !this.aim && t - this.last >= this.checkMs) {
      this.last = t;
      const ev = evaluate(f, pts);
      if (ev.error <= this.base.error + 0.035 && ev.q >= this.base.q - 0.15) { this.bad = 0; this.status = "locked"; }
      else {
        this.from = pts; this.status = "adjusting";
        const guided = withGuide(f, pts); this.guide = guided.guide;
        const st = sideOf(guided.corners) / 8;
        this.job = climb(f, guided.corners, [st * 0.2, st * 0.1, st * 0.05, 1, 0.5, 0.25], 12, undefined, this.guide);
      }
    }
    if (this.job) {
      const end = t + budgetMs;
      while (this.now() < end) {
        const r = this.job.next();
        if (!r.done) continue;
        this.job = null;
        const { pts: out, ev } = r.value, was = evaluate(f, this.from, this.guide);
        if (ev.cost < was.cost - 0.005 && ev.q >= Math.max(0.45, this.base.q - 0.15)) {
          this.base = ev; this.bad = 0; this.last = this.now();
          this.aim = out.map((p) => ({ x: p.x, y: p.y })); this.glideAt = this.now();
        } else { this.bad++; this.status = this.bad >= 4 ? "lost" : "locked"; }
        break;
      }
    }
    return this.glide(pts);
  }
}

/** Most boards aligned at the same moment. */
export const MAX_PARALLEL_ALIGN = 8;

/** How many boards to align at once: up to 8 on a machine with plenty of threads (and memory, where the browser says), fewer on a weak one. One thread is left for the page. */
export function alignConcurrency(nav: { hardwareConcurrency?: number; deviceMemory?: number } = typeof navigator === "undefined" ? {} : navigator): number {
  const threads = Number(nav.hardwareConcurrency) || 4;
  let n = Math.floor(threads) - 1;
  if (Number(nav.deviceMemory) > 0 && Number(nav.deviceMemory) < 4) n = Math.min(n, 2);
  return clamp(n, 1, MAX_PARALLEL_ALIGN);
}

export interface AlignJob { id: string; frame: GrayFrame; start: Pt[] | null; prior?: Pt[][]; /** OCR reading of the board labels, when one is under way. */ labels?: Promise<Pt[][]> }
export interface AlignResult { id: string; corners: Pt[]; confidence: number; phase: AlignStatus["phase"]; label: string }

/**
 * Aligns many boards in one go. Up to `limit` AutoAligners are live at once and share each frame's time budget evenly;
 * the rest wait their turn. Call `step(budgetMs)` every frame until it returns false, then read `results`.
 */
export class AlignBatch {
  readonly results = new Map<string, AlignResult>();
  private waiting: AlignJob[]; private live: { job: AlignJob; a: AutoAligner }[] = [];
  /** How many may run right now. It starts at 2 and climbs 3, 4, 5, 6… (one more every `rampSteps` steps) up to `limit`, and backs off a step when a frame runs well over its budget. */
  allowed: number; private steps = 0;
  constructor(jobs: AlignJob[], readonly limit = alignConcurrency(), private paceMs = 0, private now: () => number = () => performance.now(), private rampSteps = 6) { this.waiting = [...jobs]; this.allowed = Math.min(2, limit); }
  get active() { return this.live.length; }
  get pending() { return this.waiting.length + this.live.length; }
  /** What the running boards are doing now, for a progress readout: boards' worth of work finished so far (fractions count), the most advanced board's step label, and how many run / wait. */
  get status() {
    const finished = [...this.results.values()].filter((r) => r.phase === "done" || r.phase === "failed").length;
    const partial = this.live.reduce((s, { a }) => s + (a.done ? 0 : a.progress), 0);
    const lead = this.live.reduce<AutoAligner | null>((b, { a }) => (!b || a.progress > b.progress ? a : b), null);
    return { work: finished + partial, label: lead?.label ?? "", running: this.live.length, waiting: this.waiting.length };
  }
  step(budgetMs = 12) {
    const t0 = this.now();
    while (this.live.length < this.allowed && this.waiting.length) {
      const job = this.waiting.shift()!;
      const a = new AutoAligner(job.frame, job.start, this.paceMs, this.now, job.prior ?? []);
      if (job.labels) a.expectLabels(job.labels);
      this.live.push({ job, a });
    }
    const slice = Math.max(1, budgetMs / Math.max(1, this.live.length));
    for (const l of this.live) l.a.step(slice);
    this.live = this.live.filter(({ job, a }) => {
      const r: AlignResult = { id: job.id, corners: a.corners, confidence: a.confidence, phase: a.phase, label: a.label };
      this.results.set(job.id, r);
      return !a.done;
    });
    const took = this.now() - t0;
    if (took > budgetMs * 2.5) this.allowed = Math.max(1, this.allowed - 1);
    else if (++this.steps % this.rampSteps === 0 && this.allowed < this.limit) this.allowed++;
    return this.pending > 0;
  }
}
