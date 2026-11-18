/**
 * Lightweight frame profiler. Spans are only recorded while `enabled` (the Performance tab is open or
 * a capture is running), so the idle cost is one boolean check. Per-node tick timings are always kept
 * in small ring buffers because the node editor shows them live.
 */
export interface Span {
  name: string;
  /** 0 = frame section, 1 = node / sub-section, 2+ = inner spans. */
  depth: number;
  /** ms from the start of the frame. */
  t0: number;
  dur: number;
  /** Graph node this span belongs to, if any. */
  node?: string;
}

export interface FrameRecord {
  /** performance.now() at frame start. */
  at: number;
  dur: number;
  spans: Span[];
}

const NODE_RING = 120;

export interface NodeSeries {
  ring: Float32Array;
  /** Samples written so far (ring index = n % NODE_RING). */
  n: number;
  total: number;
  max: number;
  last: number;
}

export interface NodeSummary { id: string; avg: number; p95: number; max: number; last: number; samples: number }

export class Profiler {
  enabled = false;
  frames: FrameRecord[] = [];
  readonly maxFrames = 240;
  /** Live capture stops advancing the history while paused (so a frame can be inspected). */
  paused = false;
  /** Per-node average cost (ms) that counts as "over budget"; 0 turns the check off. */
  budget = 0;
  readonly nodes = new Map<string, NodeSeries>();
  private cur: FrameRecord | null = null;
  private stack: Span[] = [];
  private t0 = 0;

  beginFrame(now = performance.now()) {
    if (!this.enabled || this.paused) { this.cur = null; return; }
    this.t0 = performance.now();
    this.cur = { at: now, dur: 0, spans: [] };
    this.stack.length = 0;
  }

  endFrame() {
    const f = this.cur;
    if (!f) return;
    while (this.stack.length) this.end();
    f.dur = performance.now() - this.t0;
    this.frames.push(f);
    if (this.frames.length > this.maxFrames) this.frames.shift();
    this.cur = null;
  }

  begin(name: string, node?: string): void {
    if (!this.cur) return;
    const s: Span = { name, depth: this.stack.length, t0: performance.now() - this.t0, dur: 0, node };
    this.cur.spans.push(s);
    this.stack.push(s);
  }

  end(): void {
    const s = this.stack.pop();
    if (s) s.dur = performance.now() - this.t0 - s.t0;
  }

  /** Time `fn` as a named span. A plain call when no frame is being captured. */
  span<T>(name: string, fn: () => T, node?: string): T {
    if (!this.cur) return fn();
    this.begin(name, node);
    try { return fn(); } finally { this.end(); }
  }

  /** Always on: one tick's cost for one node. */
  recordNode(id: string, ms: number) {
    let s = this.nodes.get(id);
    if (!s) this.nodes.set(id, (s = { ring: new Float32Array(NODE_RING), n: 0, total: 0, max: 0, last: 0 }));
    s.ring[s.n % NODE_RING] = ms; s.n++; s.last = ms;
    s.total += ms;
    if (ms > s.max) s.max = ms;
  }

  forgetNode(id: string) { this.nodes.delete(id); }

  /** Samples oldest to newest (at most NODE_RING). */
  series(id: string): number[] {
    const s = this.nodes.get(id);
    if (!s) return [];
    const len = Math.min(s.n, NODE_RING), out = new Array<number>(len);
    for (let i = 0; i < len; i++) out[i] = s.ring[(s.n - len + i) % NODE_RING];
    return out;
  }

  summarize(id: string): NodeSummary | null {
    const v = this.series(id);
    if (!v.length) return null;
    const sorted = [...v].sort((a, b) => a - b);
    return { id, avg: v.reduce((a, b) => a + b, 0) / v.length, p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))], max: sorted[sorted.length - 1], last: v[v.length - 1], samples: v.length };
  }

  reset() { this.frames = []; this.nodes.clear(); }
}

export const profiler = new Profiler();

// ---- flamegraph layout (pure, tested)

export interface FlameBox {
  name: string;
  depth: number;
  /** Start and width in ms (frame mode) or accumulated ms (aggregate mode). */
  x: number;
  w: number;
  self: number;
  calls: number;
  node?: string;
  path: string;
}

/** Self time = duration minus its direct children. Spans arrive in start order with a depth. */
export function frameBoxes(f: FrameRecord): FlameBox[] {
  const out: FlameBox[] = [], stack: { box: FlameBox; kids: number }[] = [];
  for (const s of f.spans) {
    while (stack.length > s.depth) { const top = stack.pop()!; top.box.self = Math.max(0, top.box.w - top.kids); }
    const parent = stack[stack.length - 1];
    const box: FlameBox = { name: s.name, depth: s.depth, x: s.t0, w: s.dur, self: s.dur, calls: 1, node: s.node, path: (parent ? parent.box.path + "/" : "") + s.name };
    if (parent) parent.kids += s.dur;
    out.push(box); stack.push({ box, kids: 0 });
  }
  while (stack.length) { const top = stack.pop()!; top.box.self = Math.max(0, top.box.w - top.kids); }
  return out;
}

/** Merge many frames into one icicle: siblings with the same name share a box, widths are total ms. */
export function aggregateBoxes(frames: FrameRecord[]): FlameBox[] {
  interface N { box: FlameBox; kids: Map<string, N> }
  const root: N = { box: { name: "", depth: -1, x: 0, w: 0, self: 0, calls: 0, path: "" }, kids: new Map() };
  for (const f of frames) {
    const stack: N[] = [root];
    for (const b of frameBoxes(f)) {
      stack.length = b.depth + 1;
      const parent = stack[b.depth];
      let n = parent.kids.get(b.name);
      if (!n) parent.kids.set(b.name, (n = { box: { name: b.name, depth: b.depth, x: 0, w: 0, self: 0, calls: 0, node: b.node, path: b.path }, kids: new Map() }));
      n.box.w += b.w; n.box.self += b.self; n.box.calls++;
      stack.push(n);
    }
  }
  const out: FlameBox[] = [];
  const walk = (n: N, x: number) => {
    for (const k of [...n.kids.values()].sort((a, b) => b.box.w - a.box.w)) { k.box.x = x; out.push(k.box); walk(k, x); x += k.box.w; }
  };
  walk(root, 0);
  return out;
}

/** Stable pseudo-hue per name so a node keeps its colour across frames. */
export function hueOf(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

/** Linear-interpolated percentile of a numeric list (p in 0..1). */
export function percentile(values: readonly number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b), i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

/** Chrome trace-event JSON (open in ui.perfetto.dev or chrome://tracing). Times are microseconds. */
export function toTrace(frames: readonly FrameRecord[]) {
  const traceEvents: { name: string; ph: "X"; ts: number; dur: number; pid: 1; tid: 1; cat: string; args?: { node: string } }[] = [];
  for (const f of frames) {
    traceEvents.push({ name: "frame", ph: "X", ts: Math.round(f.at * 1000), dur: Math.round(f.dur * 1000), pid: 1, tid: 1, cat: "frame" });
    for (const s of f.spans) traceEvents.push({ name: s.name, ph: "X", ts: Math.round((f.at + s.t0) * 1000), dur: Math.round(s.dur * 1000), pid: 1, tid: 1, cat: s.node ? "node" : "section", ...(s.node ? { args: { node: s.node } } : {}) });
  }
  return { traceEvents, displayTimeUnit: "ms" };
}

/** Index of the longest frame (-1 when empty). */
export function slowestFrame(frames: readonly FrameRecord[]): number {
  let best = -1;
  frames.forEach((f, i) => { if (best < 0 || f.dur > frames[best].dur) best = i; });
  return best;
}

/** Change from a baseline average to the current one, as a signed ms figure plus a percentage (null when the baseline was ~0). */
export function delta(base: number, cur: number): { ms: number; pct: number | null } {
  return { ms: cur - base, pct: base > 0.005 ? ((cur - base) / base) * 100 : null };
}
