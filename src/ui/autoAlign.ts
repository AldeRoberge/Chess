import { findBoardCorners } from "../vision/findBoard";
import type { GrayFrame, Pt } from "../vision/types";
import { GOOD, type GridGuide, guideDrift, iconLevels, scoreAlignment, traceSquareGuide } from "./boardGuide";
import { squareToQuad } from "./quadMap";

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const rot = (c: Pt[], k: number) => c.map((_, i) => c[(i + k) % 4]);
/** Mean length of the four edges, in pixels. A square is a eighth of it. */
const sideOf = (c: Pt[]) => c.reduce((s, p, i) => s + dist(p, c[(i + 1) % 4]), 0) / 4;
const centre = (c: Pt[]): Pt => ({ x: c.reduce((s, p) => s + p.x, 0) / 4, y: c.reduce((s, p) => s + p.y, 0) / 4 });
const convex = (c: Pt[]) => {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4], d = c[(i + 2) % 4], cr = (b.x - a.x) * (d.y - b.y) - (b.y - a.y) * (d.x - b.x);
    if (Math.abs(cr) < 1e-6) return false;
    if (!sign) sign = Math.sign(cr); else if (Math.sign(cr) !== sign) return false;
  }
  return true;
};

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
  return { cost: a.fine + a.warp * 0.85 + drift * 0.7 + (1 - clamp(a.contrast / 40, 0, 1)) * 0.15 + a.outside * 0.3, q: a.q, error: a.error, flipped: a.flipped, contrast: a.contrast };
}

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

/** Up to ten different guesses at where the board is: the picture's texture blob read loosely and tightly, grown and shrunk, plus the current corners. */
export function candidateLayouts(f: GrayFrame, current: Pt[] | null): Pt[][] {
  const out: Pt[][] = [];
  const tries: [number, number][] = [[1, 1], [0.7, 1], [1.35, 1], [0.5, 1.6], [1, 0.6], [1.7, 1.3]];
  for (const [tScale, blurScale] of tries) { const c = findBoardCorners(f, { tScale, blurScale }); if (c) out.push(c); }
  const base = out[0] ?? current;
  if (!base) return [];
  const grow = (c: Pt[], s: number) => { const m = centre(c); return c.map((p) => ({ x: m.x + (p.x - m.x) * s, y: m.y + (p.y - m.y) * s })); };
  for (const s of [0.94, 1.06]) out.push(grow(base, s));
  if (current) out.push(current);
  const j = sideOf(base) / 8 * 0.3; // fill up to ten with shifted copies
  const shifts: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]];
  for (let i = 0; out.length < 10; i++) { const [dx, dy] = shifts[i % shifts.length]; out.push(base.map((p) => ({ x: p.x + dx * j, y: p.y + dy * j }))); }
  return out.slice(0, 10);
}

/** How far the refined layouts end up from the merged one, on average, in squares. */
const spreadOf = (all: Pt[][], mid: Pt[]) => all.reduce((s, c) => s + c.reduce((t, p, i) => t + dist(p, mid[i]), 0) / 4, 0) / all.length / (sideOf(mid) / 8);

export interface AlignStatus { phase: "idle" | "find" | "try" | "merge" | "polish" | "done" | "failed"; progress: number; confidence: number; label: string }

/**
 * Finds the board from scratch and settles the grid on it. It tries ten different layouts, refines each one against the
 * picture, reads the straight edges of the squares (the empty middle counts the most) and uses those lines as the
 * perspective, then merges them slowly (a step at a time, re-fitting at each) into one that sits on the square edges.
 * Call `step(budgetMs)` every frame; read `corners`, `progress`, `confidence` and `label` to show it.
 */
export class AutoAligner implements AlignStatus {
  phase: AlignStatus["phase"] = "find"; progress = 0; confidence = 0; label = "Looking for the board…";
  corners: Pt[]; changed = false;
  private gen: Generator<void, void>;
  /** `paceMs` is how long each merge step takes on screen; 0 runs it flat out (tests). */
  constructor(private f: GrayFrame, private start: Pt[] | null, private paceMs = 140, private now: () => number = () => performance.now()) {
    this.corners = start ?? [];
    this.gen = this.run();
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
    this.phase = "find"; this.label = "Looking for the board…"; yield;
    const cands = candidateLayouts(f, this.start);
    if (!cands.length) { this.phase = "failed"; this.label = "No board found. Drag the corners onto it."; return; }
    const N = cands.length, done: { pts: Pt[]; ev: Eval; guide: GridGuide | null }[] = [];
    this.phase = "try";
    for (let i = 0; i < N; i++) {
      this.label = `Trying layout ${i + 1} of ${N}`; this.progress = 0.05 + 0.6 * (i / N); this.set(cands[i]); yield;
      const sq = sideOf(cands[i]) / 8;
      const coarse = yield* climb(f, cands[i], [sq * 0.4, sq * 0.2, sq * 0.1, sq * 0.05], 20, (p) => this.set(p));
      this.progress = 0.05 + 0.6 * ((i + 0.7) / N);
      const turned = pickRotation(f, coarse.pts, this.start);
      this.label = "Lining up with the square edges…"; this.set(turned); yield;
      const guided = withGuide(f, turned);
      this.set(guided.corners); yield;
      const fine = yield* climb(f, guided.corners, [2, 1, 0.5], 8, (p) => this.set(p), guided.guide);
      done.push({ pts: fine.pts, ev: fine.ev, guide: guided.guide }); this.confidence = fine.ev.q; this.set(fine.pts);
    }
    // keep the layouts that agree with the best one; the rest found something else (a table edge, a shadow)
    const best = done.reduce((a, b) => (b.ev.cost < a.ev.cost ? b : a)), sq = sideOf(best.pts) / 8;
    const keep = done.filter((d) => d.pts.reduce((s, p, i) => s + dist(p, best.pts[i]), 0) / 4 < sq * 0.6);
    const w = keep.map((d) => Math.exp(-(d.ev.cost - best.ev.cost) / 0.03)), wsum = w.reduce((a, b) => a + b, 0);
    const target = best.pts.map((_, i) => ({ x: keep.reduce((s, d, k) => s + d.pts[i].x * w[k], 0) / wsum, y: keep.reduce((s, d, k) => s + d.pts[i].y * w[k], 0) / wsum }));
    // merge slowly: walk from the best layout to the average in small steps, re-fitting at every one
    this.phase = "merge"; const M = 8;
    let cur = best.pts, top = best;
    for (let m = 1; m <= M; m++) {
      this.label = `Merging ${keep.length} layouts (${m}/${M})`; this.progress = 0.7 + 0.2 * (m / M);
      const mix = best.pts.map((p, i) => ({ x: p.x + (target[i].x - p.x) * (m / M), y: p.y + (target[i].y - p.y) * (m / M) }));
      const r = yield* climb(f, mix, [0.8, 0.4], 3, undefined, best.guide);
      cur = r.pts; if (evaluate(f, r.pts).cost < evaluate(f, top.pts).cost) top = { pts: r.pts, ev: r.ev, guide: best.guide };
      this.set(cur); this.confidence = r.ev.q;
      const until = this.now() + this.paceMs; while (this.now() < until) yield;
    }
    this.phase = "polish"; this.label = "Lining up with the square edges…"; this.progress = 0.92; this.set(top.pts); yield;
    const polished = withGuide(f, top.pts);
    this.set(polished.corners); yield;
    const fin = yield* climb(f, polished.corners, [0.5, 0.25, 0.12], 12, (p) => this.set(p), polished.guide);
    const result = evaluate(f, fin.pts).cost <= evaluate(f, top.pts).cost ? fin : top;
    this.set(result.pts);
    // sure only when the grid fits, the colours are right, and the ten attempts landed in the same place
    const agree = keep.length < 2 ? 0.7 : clamp(1 - spreadOf(keep.map((d) => d.pts), result.pts) / 0.5, 0, 1);
    this.confidence = result.ev.q * (0.5 + 0.5 * agree) * (result.ev.flipped ? 0.4 : 1);
    this.progress = 1; this.phase = "done";
    this.label = this.confidence >= GOOD ? "Aligned" : result.ev.contrast < 4 ? "Done, but the squares are hard to see" : "Done, but not a perfect fit";
  }
}

/**
 * Keeps the grid on the board after a camera nudge. Every half second it re-reads how well the grid fits; when that
 * drops from what it was when locked, it re-fits locally from the current corners (small steps, so a hand over the
 * board does not drag the grid away). If that cannot recover the fit for a while, it says the board is lost.
 */
export class AlignFollower {
  private base: Eval | null = null; private last = 0; private job: Generator<void, { pts: Pt[]; ev: Eval }> | null = null; private from: Pt[] = []; private bad = 0; private guide: GridGuide | null = null;
  status: "locked" | "adjusting" | "lost" | "idle" = "idle";
  constructor(private checkMs = 500, private now: () => number = () => performance.now()) {}
  get locked() { return this.base !== null; }
  lock(f: GrayFrame, pts: Pt[]) { this.base = evaluate(f, pts); this.job = null; this.bad = 0; this.status = "locked"; this.last = this.now(); }
  unlock() { this.base = null; this.job = null; this.status = "idle"; }
  /** Returns corrected corners when the camera moved and the grid was re-fitted; null otherwise. */
  tick(f: GrayFrame, pts: Pt[], budgetMs = 6): Pt[] | null {
    if (!this.base) return null;
    const t = this.now();
    if (!this.job) {
      if (t - this.last < this.checkMs) return null;
      this.last = t;
      const ev = evaluate(f, pts);
      if (ev.error <= this.base.error + 0.035 && ev.q >= this.base.q - 0.15) { this.bad = 0; this.status = "locked"; return null; }
      this.from = pts; this.status = "adjusting";
      const guided = withGuide(f, pts); this.guide = guided.guide;
      const st = sideOf(guided.corners) / 8;
      this.job = climb(f, guided.corners, [st * 0.2, st * 0.1, st * 0.05, 1, 0.5, 0.25], 12, undefined, this.guide);
    }
    const end = t + budgetMs;
    while (this.now() < end) {
      const r = this.job.next();
      if (!r.done) continue;
      this.job = null;
      const { pts: out, ev } = r.value, was = evaluate(f, this.from, this.guide);
      if (ev.cost < was.cost - 0.005 && ev.q >= Math.max(0.45, this.base.q - 0.15)) { this.base = ev; this.bad = 0; this.status = "locked"; this.last = this.now(); return out; }
      this.bad++; this.status = this.bad >= 4 ? "lost" : "locked";
      return null;
    }
    return null;
  }
}
