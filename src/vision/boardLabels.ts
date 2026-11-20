import type { GrayFrame, Pt } from "./types";

/** One character the OCR read, with the pixel centre of its box. */
export interface LabelHit { ch: string; x: number; y: number; conf: number }

/** Anything that can read characters off a picture. `rotate` is how far the picture is turned (0, 90, 180, 270 clockwise) before reading; hits come back in the original picture's pixels. */
export type OcrEngine = (f: GrayFrame, rotate: number) => Promise<LabelHit[]>;

const FILES = "abcdefgh", RANKS = "12345678";
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
const len = (a: Pt) => Math.hypot(a.x, a.y);

/** Labels that sit on a line: where index 0 is (`p0`) and the step per index (`step`), plus how many distinct indexes agree. */
export interface LabelLine { p0: Pt; step: Pt; count: number }

/** Finds up to `max` lines of labels that agree on an even step (index -> position). Robust to stray hits (a letter read off a piece, a clock face). */
export function fitLabelLines(hits: { k: number; p: Pt; conf: number }[], max = 2): LabelLine[] {
  let rest = hits.slice();
  const out: LabelLine[] = [];
  for (let n = 0; n < max; n++) {
    let best: { line: LabelLine; inl: typeof rest; score: number } | null = null;
    for (const a of rest) for (const b of rest) {
      if (b.k <= a.k) continue;
      const step = mul(sub(b.p, a.p), 1 / (b.k - a.k)), s = len(step);
      if (s < 4) continue;
      const p0 = sub(a.p, mul(step, a.k));
      const inl = rest.filter((h) => len(sub(h.p, add(p0, mul(step, h.k)))) < s * 0.35);
      const ks = new Set(inl.map((h) => h.k)).size;
      const score = ks + inl.reduce((t, h) => t + h.conf, 0) / 1000;
      if (ks >= 3 && (!best || score > best.score)) best = { line: { p0, step, count: ks }, inl, score };
    }
    if (!best) break;
    // refit on the inliers, one hit per index (the best read)
    const per = new Map<number, (typeof rest)[number]>();
    for (const h of best.inl) { const o = per.get(h.k); if (!o || h.conf > o.conf) per.set(h.k, h); }
    const pts = [...per.values()], m = pts.length;
    const mk = pts.reduce((t, h) => t + h.k, 0) / m, mx = pts.reduce((t, h) => t + h.p.x, 0) / m, my = pts.reduce((t, h) => t + h.p.y, 0) / m;
    const sk = pts.reduce((t, h) => t + (h.k - mk) ** 2, 0);
    const step = sk > 0 ? { x: pts.reduce((t, h) => t + (h.k - mk) * (h.p.x - mx), 0) / sk, y: pts.reduce((t, h) => t + (h.k - mk) * (h.p.y - my), 0) / sk } : best.line.step;
    out.push({ p0: { x: mx - step.x * mk, y: my - step.y * mk }, step, count: m });
    const used = new Set(best.inl);
    rest = rest.filter((h) => !used.has(h));
  }
  return out;
}

/** The board corners (a8, h8, h1, a1) implied by labels: file letters along one edge and rank digits along another. */
function quadOf(o: Pt, u: Pt, v: Pt): Pt[] {
  return [o, add(o, mul(u, 8)), add(add(o, mul(u, 8)), mul(v, 8)), add(o, mul(v, 8))];
}

const edgeOk = (x: number) => (x >= -1.6 && x <= 0.3) || (x >= 7.7 && x <= 9.6);

/**
 * Where the board is, from the printed letters a-h and digits 1-8 around it. A letter sits half a square along its file,
 * a digit half a square along its rank, so the two rows of labels cross exactly at the corner they share: that fixes the
 * board with no guessing. With only one kind of label the other axis is taken as square to it (two guesses, the label
 * row on either side of the board). Corner order is a8, h8, h1, a1, so the labels also say which way up the board is.
 * Returns the best reading first.
 */
export function quadsFromLabels(hits: LabelHit[]): Pt[][] {
  const files = hits.filter((h) => FILES.includes(h.ch)).map((h) => ({ k: FILES.indexOf(h.ch), p: { x: h.x, y: h.y }, conf: h.conf }));
  // rank 8 is row 0 (the top, as a8 is square 0)
  const ranks = hits.filter((h) => RANKS.includes(h.ch)).map((h) => ({ k: 8 - Number(h.ch), p: { x: h.x, y: h.y }, conf: h.conf }));
  const fl = fitLabelLines(files), rl = fitLabelLines(ranks);
  const out: { q: Pt[]; w: number }[] = [];
  const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;
  const ok = (u: Pt, v: Pt) => {
    const r = len(u) / len(v), c = Math.abs(u.x * v.x + u.y * v.y) / (len(u) * len(v));
    return r > 0.45 && r < 2.2 && c < 0.75 && cross(u, v) > 0;
  };
  for (const L of fl) for (const D of rl) {
    const u = L.step, v = D.step;
    if (!ok(u, v)) continue;
    // letter row: p0L + t*u (t is the file index); digit row: p0D + s*v (s is the row index). Cross them.
    const den = cross(u, v);
    const d = sub(D.p0, L.p0);
    const t = cross(d, v) / den, s = cross(d, u) / den;
    const ux = t + 0.5, vx = s + 0.5; // board coordinates of the crossing
    if (!edgeOk(ux) || !edgeOk(vx)) continue;
    const x = add(L.p0, mul(u, t));
    out.push({ q: quadOf(sub(sub(x, mul(u, ux)), mul(v, vx)), u, v), w: L.count + D.count + 10 });
  }
  if (!out.length) {
    // one kind of label: the other axis is a quarter turn of the first (a board is not mirrored)
    for (const L of fl) {
      const u = L.step, v = { x: -u.y, y: u.x };
      for (const vl of [8.5, -0.5]) out.push({ q: quadOf(sub(sub(L.p0, mul(u, 0.5)), mul(v, vl)), u, v), w: L.count });
    }
    for (const D of rl) {
      const v = D.step, u = { x: v.y, y: -v.x };
      for (const ul of [-0.5, 8.5]) out.push({ q: quadOf(sub(sub(D.p0, mul(v, 0.5)), mul(u, ul)), u, v), w: D.count });
    }
  }
  return out.sort((a, b) => b.w - a.w).map((o) => o.q);
}

let engine: OcrEngine | null = null;
/** Swap the reader (tests, or a native one). Pass null to go back to the built-in. */
export function setOcrEngine(e: OcrEngine | null) { engine = e; }

interface TessWorker { recognize(image: unknown, options?: object, output?: object): Promise<{ data: { blocks?: { paragraphs: { lines: { words: { symbols: { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }[] }[] }[] }[] }[] | null } }>; setParameters(p: object): Promise<unknown> }
let worker: Promise<TessWorker | null> | null = null;
/** Why the built-in reader could not start (no network for its language data, no document), or "" while it works. Shown to the user. */
let workerError = "";

/** What the label reader is doing for one picture, so the screen can show it: still reading, found letters and digits, found none, or could not run at all. */
export interface OcrReport { state: "reading" | "found" | "none" | "unavailable"; hits: LabelHit[]; guesses: number; reason: string; t: number }
const reports = new WeakMap<GrayFrame, OcrReport>();
export const ocrReportOf = (f: GrayFrame): OcrReport | null => reports.get(f) ?? null;

function loadWorker(): Promise<TessWorker | null> {
  worker ??= (async () => {
    try {
      if (typeof document === "undefined") { workerError = "no browser page"; return null; }
      const T = await import("tesseract.js");
      const w = await T.createWorker("eng");
      await w.setParameters({ tessedit_char_whitelist: FILES + RANKS, tessedit_pageseg_mode: "11" as never });
      return w as unknown as TessWorker;
    } catch (e) { workerError = e instanceof Error ? e.message : String(e); return null; }
  })();
  return worker;
}

/** The picture as a canvas, turned `rotate` degrees clockwise and scaled up when small (the labels are tiny). Returns the scale and a way back to the original pixels. */
function canvasOf(f: GrayFrame, rotate: number) {
  const scale = Math.max(1, Math.min(3, 1600 / Math.max(f.width, f.height)));
  const w = Math.round(f.width * scale), h = Math.round(f.height * scale);
  const src = document.createElement("canvas"); src.width = f.width; src.height = f.height;
  const img = new ImageData(f.width, f.height);
  for (let i = 0; i < f.data.length; i++) { const v = f.data[i]; img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  src.getContext("2d")!.putImageData(img, 0, 0);
  const turned = rotate === 90 || rotate === 270, c = document.createElement("canvas");
  c.width = turned ? h : w; c.height = turned ? w : h;
  const g = c.getContext("2d")!;
  g.imageSmoothingQuality = "high";
  g.translate(c.width / 2, c.height / 2); g.rotate((rotate * Math.PI) / 180); g.drawImage(src, -w / 2, -h / 2, w, h);
  const back = (p: Pt): Pt => {
    const dx = p.x - c.width / 2, dy = p.y - c.height / 2, a = (-rotate * Math.PI) / 180;
    return { x: (dx * Math.cos(a) - dy * Math.sin(a)) / scale + f.width / 2, y: (dx * Math.sin(a) + dy * Math.cos(a)) / scale + f.height / 2 };
  };
  return { c, back };
}

const builtIn: OcrEngine = async (f, rotate) => {
  const w = await loadWorker();
  if (!w) return [];
  const { c, back } = canvasOf(f, rotate);
  const { data } = await w.recognize(c, {}, { blocks: true });
  const hits: LabelHit[] = [];
  for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) for (const wd of l.words) for (const s of wd.symbols) {
    const ch = s.text.trim().toLowerCase();
    if (ch.length !== 1 || !(FILES + RANKS).includes(ch) || s.confidence < 30) continue;
    const p0 = back({ x: (s.bbox.x0 + s.bbox.x1) / 2, y: (s.bbox.y0 + s.bbox.y1) / 2 });
    hits.push({ ch, x: p0.x, y: p0.y, conf: s.confidence });
  }
  return hits;
};

const cache = new WeakMap<GrayFrame, Promise<Pt[][]>>();

/**
 * Reads the board's printed labels and returns corner guesses (a8, h8, h1, a1), best first; empty when none are visible or OCR is unavailable.
 * Never rejects. Tries the picture as it is, then turned, since a camera on the other side of the board sees the letters upside down.
 */
export function labelHints(f: GrayFrame, budgetMs = 20000): Promise<Pt[][]> {
  const old = cache.get(f);
  if (old) return old;
  const run = (async () => {
    const read = engine ?? builtIn, end = Date.now() + budgetMs;
    let all: LabelHit[] = [];
    const report = (state: OcrReport["state"], guesses = 0) => reports.set(f, { state, hits: all, guesses, reason: state === "unavailable" ? workerError : "", t: Date.now() });
    report("reading");
    for (const rot of [0, 180, 90, 270]) {
      if (Date.now() > end) break;
      try { all = all.concat(await read(f, rot)); } catch { /* this turn could not be read */ }
      if (!engine && !(await worker)) { report("unavailable"); return []; }
      report("reading");
      const q = quadsFromLabels(all);
      if (q.length && all.length >= 8) { report("found", q.length); return q; }
    }
    const q = quadsFromLabels(all);
    report(all.length ? "found" : "none", q.length);
    return q;
  })().catch(() => { reports.set(f, { state: "unavailable", hits: [], guesses: 0, reason: workerError || "the reader crashed", t: Date.now() }); return [] as Pt[][]; });
  cache.set(f, run);
  return run;
}
