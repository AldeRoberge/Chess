import { calibrationRuntime } from "../vision/calibration";
import { FrameCleaner, type Cleaned } from "../vision/cleaner";
import { cleanPool } from "../vision/cleanPool";
import { Fusion } from "../vision/fusion";
import { BoardSampler, defaultSamplerConfig } from "../vision/sampler";
import { loadSquareCnn } from "../vision/squareModel";
import { Stabilizer } from "../vision/stabilizer";
import type { BoardBelief, GrayFrame, SquareObs } from "../vision/types";
import type { NodeSpec, Plugin } from "../core/types";
import { bus } from "../core/bus";
import { applyH, boardToImage, invertH } from "../vision/homography";
import { sqIndex, sqName } from "../vision/types";
import { drawChevrons } from "../world/chevrons";
import { brief, CAM_PRESETS, drawBoard, drawFrame, drawReaderBoard, readerTiles, fenPieces, fmtCorners, frameScale, looksLikeStart, parseCorners, withDetail, type DetailRow } from "./shared";
import { FRAME_H, FRAME_W } from "../sim/rigs";
import { boardHover, boardSquareAt, markSquares, cropFrame, framePixel, isLightSquare, markPixel, pieceLabel, pct, tone, visualSize } from "./hover";
import type { TipRow } from "../ui/tooltip";
import { AlignFollower, AutoAligner, evaluate, rememberLayout, rememberedLayouts } from "../ui/autoAlign";
import { findCheckerCorners, orientBoardCorners } from "../vision/findBoard";
import { CalibrationWatch, type WatchReading } from "../vision/autoCalibrate";
import { GOOD } from "../ui/boardGuide";

interface ReaderState { sampler: BoardSampler; frame: GrayFrame | null; obs: SquareObs | null; corners: string; autoDone: boolean; calT: number; calTries: number; lastT: number; cleaner: FrameCleaner; key: string; inflight: number; epoch: number; ready: Cleaned | null; raw: GrayFrame | null; analysis: GrayFrame | null; cleaned: GrayFrame | null; readOf: GrayFrame | null; follower: AlignFollower; followOf: GrayFrame | null; followWrote: string; lockTry: number; watch: CalibrationWatch; aligner: AutoAligner | null; checkAt: number; fit: number }
const AUTO_CAL_RETRY_MS = 1000, AUTO_CAL_MAX_TRIES = 8, AUTO_CAL_MIN_LUMA = 20;
/** A move has been played: the pieces are no longer where the start-position calibration assumes. */
const gameStarted = () => (bus.game?.ply ?? 0) > 0;
/** Average brightness, sampled sparsely: a webcam still warming up sends near-black frames. */
function meanLuma(f: GrayFrame): number {
  const d = f.data, step = Math.max(1, Math.floor(d.length / 4096));
  let sum = 0, n = 0;
  for (let i = 0; i < d.length; i += step) { sum += d[i]; n++; }
  return n ? sum / n : 0;
}
/** Board square (0 = a8) under an image pixel for these corners, or null when the pixel is off the board. */
function squareAtPixel(corners: { x: number; y: number }[], x: number, y: number): number | null {
  const q = applyH(invertH(boardToImage(corners)), x, y);
  const c = Math.floor(q.x), r = Math.floor(q.y);
  return q.x >= 0 && q.y >= 0 && c < 8 && r < 8 ? r * 8 + c : null;
}

/** The reader preview: the camera picture on top (160×120), the board it reads from that picture below (160×160). */
const READER_BASE: [number, number] = [160, 280];
const readerSplit = (w: number, h: number) => { const fh = Math.min(w * 0.75, h * (120 / 280)); return { fh, bh: h - fh }; };

let readerSeq = 0;
/** Drops this reader's calibration (no camera, node removed) and its window. */
function stopCalibration(state: ReaderState, now: number) {
  if (state.aligner) { state.aligner = null; state.watch.ended(now); }
  if (bus.calibration?.cam === state.sampler.cam) bus.calibration = null;
}

const storage = () => (typeof localStorage === "undefined" ? undefined : localStorage);

/**
 * When the board stays unreadable, find the corners again (the same search as Auto detect in the corners editor) and
 * re-learn the empty squares when the start position stands on the board. Shows "Calibration in progress..." on the bus
 * while it runs. CalibrationWatch keeps it from looping: a cooldown, three tries, and Dismiss holds it off.
 */
function autoCalibrate(state: ReaderState, params: Record<string, number | string | boolean>, f: GrayFrame, now: number, fresh: boolean) {
  const cam = state.sampler.cam, view = bus.calibration, mine = view?.cam === cam;
  if (mine && bus.calibrationDismiss) { bus.calibrationDismiss = false; state.aligner = null; state.watch.dismiss(now); bus.calibration = null; return; }
  if (mine && view.phase !== "running" && now >= (view.hideAt ?? 0)) bus.calibration = null;
  if (!params.autoFind) { if (state.aligner) stopCalibration(state, now); return; }
  // Judge the board twice a second: how well the grid fits, how much of it reads, and whether the start position shows.
  if (fresh && now - state.checkAt >= 500) {
    state.checkAt = now;
    const corners = parseCorners(String(params.corners)), o = state.obs, g = bus.game;
    state.fit = corners ? evaluate(f, corners).q : 0;
    const r: WatchReading = {
      now, fit: state.fit, quality: o?.quality ?? 0,
      startSeen: looksLikeStart(o) || g?.status === "synced", started: (g?.ply ?? 0) > 0,
      still: !!o && o.motion <= 0.02 && !Array.from(o.handSquares as ArrayLike<number>).some(Boolean),
    };
    if (state.aligner) {
      if (state.watch.healthy(r)) { // reads well again on its own: nothing left to do
        state.aligner = null; state.watch.ended(now);
        bus.calibration = { cam, phase: "done", label: "The board reads well again.", progress: 1, hideAt: now + 1500 };
        return;
      }
    } else {
      const why = state.watch.feed(r);
      const busy = !!bus.calibration && !mine && bus.calibration.phase === "running"; // one camera at a time
      if (why && busy) state.watch.ended(now);
      else if (why) {
        let seed: { x: number; y: number }[] | null = null;
        try { const q = findCheckerCorners(f); seed = q ? orientBoardCorners(f, q) : null; } catch { seed = null; }
        const store = storage();
        state.aligner = new AutoAligner(f, seed ?? corners, 60, undefined, store ? rememberedLayouts(f.width, f.height, store) : []);
        state.follower.unlock();
        bus.calibration = { cam, phase: "running", label: why === "no-start" ? "The start position is not showing. Looking for the board…" : "Looking for the board…", progress: 0 };
      }
    }
  }
  const al = state.aligner;
  if (!al) return;
  al.step(8);
  bus.calibration = { cam, phase: "running", label: al.label, progress: al.progress };
  if (!al.done) return;
  state.aligner = null; state.watch.ended(now);
  if (al.phase === "done" && al.corners.length === 4 && al.confidence >= Math.max(0.45, state.fit + 0.05)) {
    params.corners = fmtCorners(al.corners);
    const store = storage(); if (store) rememberLayout(al.corners, f.width, f.height, store);
    // New corners make the reader learn the start position again (unless a game is under way).
    bus.calibration = { cam, phase: "done", label: "Board found. Re-learning the squares.", progress: 1, hideAt: now + 4000 };
  } else {
    bus.calibration = { cam, phase: "failed", label: "Could not find the board. Open Board corners and drag them onto it.", progress: 1, hideAt: now + 6000 };
  }
}

const reader: NodeSpec<ReaderState> = {
  type: "vision.boardReader", title: "Board Reader", category: "Vision",
  inputs: [{ id: "frame", type: "frame" }], outputs: [{ id: "obs", type: "obs" }],
  params: [
    { id: "cam", kind: "text", label: "Camera id", value: "A" },
    { id: "corners", kind: "text", label: "Board corners", value: fmtCorners(CAM_PRESETS.A), quad: { names: ["a8", "h8", "h1", "a1"], grid: 8 } },
    { id: "follow", kind: "bool", label: "Follow camera moves", value: true },
    { id: "cnn", kind: "bool", label: "Neural square reader (beta)", value: false },
    { id: "threshold", kind: "number", label: "Piece sensitivity", min: 0.15, max: 0.6, step: 0.01, value: 0.22 },
    { id: "shapeWeight", kind: "number", label: "Shape / texture evidence", min: 0.25, max: 2, step: 0.25, value: 1 },
    { id: "colorWeight", kind: "number", label: "Color / brightness evidence", min: 0.25, max: 2, step: 0.25, value: 1 },
    { id: "patch", kind: "number", label: "Piece size / sample width", min: 0.35, max: 0.85, step: 0.05, value: 0.6 },
    { id: "positionWeight", kind: "number", label: "Position / perspective correction", min: 0, max: 2, step: 0.25, value: 1 },
    { id: "softness", kind: "number", label: "Decision softness", min: 0.02, max: 0.2, step: 0.005, value: 0.06 },
    { id: "grid", kind: "number", label: "Sample dots per axis", min: 3, max: 10, step: 1, value: 6 },
    { id: "weight", kind: "number", label: "Trust", min: 0, max: 2, step: 0.1, value: 1 },
    { id: "clean", kind: "bool", label: "Clean up noise", value: true },
    { id: "average", kind: "number", label: "Average frames", min: 1, max: 8, step: 1, value: 4 },
    { id: "autoCal", kind: "bool", label: "Auto-learn at start position", value: true },
    { id: "autoFind", kind: "bool", label: "Auto-calibrate when lost", value: true },
    { id: "learn", kind: "bool", label: "Learn now", value: false, action: true },
  ],
  previewSize: READER_BASE,
  frameOf: (s) => s.frame,
  init: () => ({ sampler: new BoardSampler("A", defaultSamplerConfig()), frame: null, obs: null, corners: "", autoDone: false, calT: -Infinity, calTries: 0, lastT: -1, cleaner: new FrameCleaner(), key: `reader${++readerSeq}`, inflight: 0, epoch: 0, ready: null, raw: null, analysis: null, cleaned: null, readOf: null, follower: new AlignFollower(), followOf: null, followWrote: "", lockTry: 0, watch: new CalibrationWatch(), aligner: null, checkAt: -Infinity, fit: 1 }),
  process({ frame }, { now, params, state, setFidelity, span }) {
    const s = state.sampler;
    s.cam = String(params.cam);
    if (!frame) { stopCalibration(state, now); if (state.raw) cleanPool().forget(state.key); state.frame = state.raw = state.analysis = state.cleaned = state.ready = null; state.cleaner.recent = []; state.epoch++; state.inflight = 0; state.obs = null; state.follower.unlock(); setFidelity(null); return { obs: null }; }
    // The picture you line up stays at the camera's resolution. The squares are read from a 480×360 average of it, which is the space the saved corners are in.
    // Clean-up: a median filter plus the mean of the last few frames of a still board (benchmarked: far fewer phantom and missed pieces than reading raw frames).
    // The mean restarts whenever the board is changing (a hand, a moved piece), so motion is never smeared into the picture the reader samples. The preview is not averaged.
    // In the browser this runs in a worker and its result is read on the next tick; a frame that arrives while one is still being cleaned is skipped.
    if (frame !== state.raw) {
      state.raw = frame;
      const opts = { width: FRAME_W, height: FRAME_H, keep: Number(params.average), clean: !!params.clean, reset: !!(state.obs && state.obs.motion > 0.02) };
      const pool = cleanPool();
      if (!pool.supported) state.ready = span("clean up picture", () => state.cleaner.run(frame, opts));
      else {
        const t = performance.now();
        if (state.inflight && t - state.inflight > 2000) { state.epoch++; state.inflight = 0; } // a lost answer must never stall the reader
        if (!state.inflight) {
          state.inflight = t;
          const epoch = state.epoch;
          void pool.clean(state.key, frame, opts).then((r) => { if (epoch === state.epoch) { state.inflight = 0; state.ready = r; } });
        }
      }
    }
    const ready = state.ready;
    state.ready = null;
    // Camera nudged? Keep the corners on the board: re-fit them in small steps whenever the grid stops lining up with the squares.
    const cur = params.follow && !calibrationRuntime.active && !state.aligner ? parseCorners(String(params.corners)) : null;
    if (!cur || (state.follower.locked && String(params.corners) !== state.followWrote)) state.follower.unlock(); // switched off, or the corners were edited by hand
    if (ready) {
      state.analysis = ready.analysis; state.cleaned = ready.cleaned;
      state.frame = frame.width === FRAME_W && frame.height === FRAME_H ? ready.cleaned : frame;
      const analysis = ready.analysis;
      if (cur) {
        if (!state.follower.locked) {
          const now = performance.now();
          if (now - state.lockTry > 1000) { state.lockTry = now; if (evaluate(analysis, cur).q >= GOOD) { state.follower.lock(analysis, cur); state.followWrote = String(params.corners); } }
        } else {
          const fixed = span("follow camera", () => state.follower.tick(analysis, cur, 4));
          if (fixed) { params.corners = state.followWrote = fmtCorners(fixed); }
          else if (state.follower.status === "lost") state.follower.unlock();
        }
      }
    }
    if (state.corners !== params.corners) {
      const c = parseCorners(String(params.corners));
      // New corners make the learned empty squares stale: learn the start position again, unless a game is under way.
      if (c) { s.cfg.corners = c; if (state.corners && !gameStarted()) { state.autoDone = false; state.calTries = 0; state.calT = -Infinity; } state.corners = String(params.corners); }
    }
    const settingsKey = JSON.stringify([params.threshold, params.shapeWeight, params.colorWeight, params.patch, params.positionWeight, params.softness, params.grid]);
    if ((state as ReaderState & { settingsKey?: string }).settingsKey !== settingsKey) {
      (state as ReaderState & { settingsKey?: string }).settingsKey = settingsKey; state.readOf = null;
    }
    s.cfg.threshold = Number(params.threshold);
    s.cfg.shapeWeight = Number(params.shapeWeight ?? 1); s.cfg.colorWeight = Number(params.colorWeight ?? 1);
    s.cfg.positionWeight = Number(params.positionWeight ?? 1); s.cfg.patch = Number(params.patch ?? 0.6);
    s.cfg.softness = Number(params.softness ?? 0.06); s.cfg.grid = Math.round(Number(params.grid ?? 6));
    s.cfg.engine = params.cnn ? "cnn" : "rules";
    if (params.cnn && !BoardSampler.cnn) void loadSquareCnn(); // reads fall back to the brightness reader until the model has loaded
    if (!state.cleaned) { setFidelity(null); return { obs: null }; } // the first picture is still being cleaned
    const img = state.cleaned!;
    if (params.learn) { span("calibrateFromStart", () => s.calibrateFromStart(img)); state.autoDone = true; params.learn = false; state.readOf = null; }
    else if (!calibrationRuntime.active && params.autoCal && !state.autoDone && !gameStarted() && img !== state.readOf && img.t - state.calT >= AUTO_CAL_RETRY_MS && !(state.obs && state.obs.motion > 0.02) && meanLuma(img) >= AUTO_CAL_MIN_LUMA) {
      // Auto-learn keeps trying until the reading looks like the start position. Learning once from the first frame locked in a
      // dark warm-up frame or the default corners for good: every square then read wrong and the game never started.
      span("calibrateFromStart", () => s.calibrateFromStart(img));
      state.calT = img.t; state.calTries++;
      state.readOf = img; state.lastT = img.t; state.obs = span("sample board (read)", () => s.read(img, Number(params.weight)));
      if (looksLikeStart(state.obs) || state.calTries >= AUTO_CAL_MAX_TRIES) state.autoDone = true;
    }
    if (img !== state.readOf || !state.obs) { state.readOf = img; state.lastT = img.t; state.obs = span("sample board (read)", () => s.read(img, Number(params.weight))); } // one read per camera frame
    if (state.analysis && !calibrationRuntime.active) { const f = state.analysis; span("auto-calibrate", () => autoCalibrate(state, params, f, now, !!ready)); }
    setFidelity(state.obs.quality * (1 - Math.min(1, state.obs.motion * 4)));
    return { obs: state.obs };
  },
  dispose(s) { cleanPool().forget(s.key); },
  hover(p, w, h, s) {
    const v = visualSize(w, h, READER_BASE), f = s.frame, { fh, bh } = readerSplit(v.w, v.h);
    if (p.x > v.w || p.y > v.h) return null;
    if (p.y > fh) { // the board under the picture: this square as the reader reads it
      const q = boardSquareAt({ x: p.x, y: p.y - fh }, v.w, bh);
      if (q === null || !s.obs) return null;
      const t = readerTiles(s.obs, bus.game?.fen)[q];
      const rows: TipRow[] = [{ label: "Square", value: `${sqName(q)} (${isLightSquare(q) ? "light" : "dark"})` },
        { label: "Reads as", value: t.occupied ? (t.piece ? pieceLabel(t.piece) : `${t.white ? "white" : "black"} piece (type unknown)`) : "empty" },
        { label: "Confidence", value: pct(t.conf), bar: t.conf, tone: tone(t.conf) },
        { label: "Says occupied", value: pct(s.obs.occ[q]), bar: s.obs.occ[q] }];
      return { title: sqName(q), tag: `Board Reader · cam ${s.sampler.cam}`, color: "#35e0b4", body: "What this camera alone reads on the square, before the cameras are fused. The piece type comes from the tracked game; the reader itself only tells empty, white and black apart.", rows,
        mark: (ctx) => { ctx.save(); ctx.translate(0, fh); markSquares(ctx, v.w, bh, q); ctx.restore(); } };
    }
    if (!f) return { title: "No camera picture", tag: "Board Reader", body: "Wire a camera into this node: it reads the 64 squares from the picture.", rows: [{ label: "Calibrated", value: s.sampler.calibrated ? "yes" : "no", tone: s.sampler.calibrated ? "ok" : "warn" }] };
    const { r, x, y, inside } = framePixel(f, p, v.w, fh);
    if (!inside) return null;
    const cfg = s.sampler.cfg, lum = f.data[Math.floor(y) * f.width + Math.floor(x)];
    const sc = frameScale(f.width, f.height), ax = x / sc.sx, ay = y / sc.sy;
    const sq = squareAtPixel(cfg.corners, ax, ay), o = s.obs, read = s.cleaned ?? f;
    const rows: TipRow[] = [{ label: "Pixel", value: `${Math.floor(x)}, ${Math.floor(y)}` }, { label: "Brightness", value: `${lum} / 255`, bar: lum / 255 }];
    const H = boardToImage(cfg.corners);
    const at = (u: number, vv: number) => { const q = applyH(H, u, vv); return { x: r.x + q.x * sc.sx * r.s, y: r.y + q.y * sc.sy * r.s }; };
    if (sq === null) {
      rows.push({ label: "Board", value: "outside the corners", tone: "warn" });
      return { title: `pixel ${Math.floor(x)}, ${Math.floor(y)}`, tag: "off the board", color: "#9fb8ff", body: "This part of the picture is outside the four corners, so it is ignored.", rows, preview: { frame: cropFrame(f, x, y) }, mark: (ctx) => markPixel(ctx, r, x, y) };
    }
    const dgn = s.sampler.diagnose(read, sq), m = dgn.crown, ref = dgn.ref, thr = dgn.gate, d = dgn.drive;
    rows.unshift({ label: "Square", value: `${sqName(sq)} (${isLightSquare(sq) ? "light" : "dark"})` });
    const tracked = bus.game?.fen ? fenPieces(bus.game.fen)[sq] ?? null : undefined;
    if (tracked !== undefined) rows.splice(1, 0, { label: "Tracked piece", value: pieceLabel(tracked) });
    if (s.sampler.calibrated && !Number.isNaN(m)) {
      rows.push({ label: "Square brightness", value: `${Math.round(m)} vs ${Math.round(ref)} empty · corners ${Number.isFinite(dgn.rim) ? Math.round(dgn.rim) : "—"}` });
      rows.push({ label: "Change", value: `${d >= 0 ? "+" : ""}${Math.round(d)} (needs ±${Math.round(thr)})`, bar: Math.min(1, Math.abs(d) / (thr * 2 || 1)), tone: Math.abs(d) > thr ? "ok" : "warn" });
    } else rows.push({ label: "Reference", value: "not learned yet", tone: "warn" });
    if (o) {
      const occ = o.occ[sq], white = o.white[sq];
      rows.push({ label: "Says occupied", value: pct(occ), bar: occ, tone: tone(Math.abs(occ * 2 - 1)) });
      if (occ > 0.5) rows.push({ label: "Piece colour", value: `${white > 0.5 ? "white" : "black"} ${pct(white > 0.5 ? white : 1 - white)}`, bar: white > 0.5 ? white : 1 - white });
      rows.push({ label: "Hand / motion here", value: o.handSquares[sq] ? "yes, anomaly" : "no", tone: o.handSquares[sq] ? "bad" : "ok" });
      rows.push({ label: "Camera quality", value: pct(o.quality), bar: o.quality, tone: tone(o.quality) });
      if (tracked !== undefined) {
        const seen = occ > 0.5, agree = (tracked !== null) === seen && (!tracked || (tracked === tracked.toUpperCase()) === white > 0.5);
        rows.push({ label: "Reader vs. game", value: agree ? "agree" : "disagree", tone: agree ? "ok" : "bad" });
      }
    }
    return {
      title: sqName(sq), tag: `Board Reader · cam ${s.sampler.cam}`, color: "#35e0b4",
      body: `The ${cfg.grid * cfg.grid} dots in the middle of the square (${pct(cfg.patch)} of its width) are compared with the empty square and with the square's own corners. A piece only a little lighter or darker than its square still counts, and a blown-out glare spot is left undecided.`,
      rows, preview: { frame: cropFrame(f, x, y) },
      mark: (ctx) => {
        const c = sq % 8, rr = Math.floor(sq / 8), q = [at(c, rr), at(c + 1, rr), at(c + 1, rr + 1), at(c, rr + 1)];
        ctx.save();
        ctx.fillStyle = "rgba(255,228,92,.22)"; ctx.strokeStyle = "#ffe45c"; ctx.lineWidth = 1.5;
        ctx.beginPath(); q.forEach((t, i) => (i ? ctx.lineTo(t.x, t.y) : ctx.moveTo(t.x, t.y))); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#fff";
        const lean = s.sampler.lean();
        for (let j = 0; j < cfg.grid; j++) for (let i = 0; i < cfg.grid; i++) { const t = at(c + 0.5 + ((i + 0.5) / cfg.grid - 0.5) * cfg.patch + lean.u, rr + 0.5 + ((j + 0.5) / cfg.grid - 0.5) * cfg.patch + lean.v); ctx.fillRect(t.x - 0.8, t.y - 0.8, 1.6, 1.6); }
        ctx.restore();
      },
    };
  },
  preview(ctx, w, h, s) {
    withDetail(ctx, w, h, READER_BASE, (pw, ph) => {
      const { fh, bh } = readerSplit(pw, ph);
      const r = drawFrame(ctx, pw, fh, s.frame);
      // what the reader sees, tile by tile, under the picture it reads
      ctx.save(); ctx.translate(0, fh); ctx.beginPath(); ctx.rect(0, 0, pw, bh); ctx.clip(); drawReaderBoard(ctx, pw, bh, s.obs, bus.game?.fen); ctx.restore();
      if (!s.frame || !r) return;
      const sc = frameScale(s.frame.width, s.frame.height);
      const at = (p: { x: number; y: number }) => ({ x: r.x + p.x * sc.sx * r.s, y: r.y + p.y * sc.sy * r.s }), c = s.sampler.cfg.corners;
      ctx.strokeStyle = "#35e0b4"; ctx.beginPath(); c.forEach((p, i) => { const q = at(p); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); }); ctx.closePath(); ctx.stroke();
      if (bus.engineHint) { // the move the human must play on the real board for the bot
        const H = boardToImage(c), ctr = (n: string) => { const i = sqIndex(n), q = applyH(H, (i % 8) + 0.5, Math.floor(i / 8) + 0.5); return at(q); };
        const a = ctr(bus.engineHint.from), b = ctr(bus.engineHint.to);
        drawChevrons(ctx, a, b, Math.hypot(at(applyH(H, 1, 0)).x - at(applyH(H, 0, 0)).x, at(applyH(H, 1, 0)).y - at(applyH(H, 0, 0)).y), performance.now() / 1000);
      }
      ctx.fillStyle = "rgba(255,90,110,.6)"; // a frame always comes with its observation
      const right = r.x + s.frame.width * r.s;
      for (let i = 0; i < 64; i++) if (s.obs!.handSquares[i]) ctx.fillRect(right - 6, r.y + 4 + (i % 8), 4, 1);
    }, (): DetailRow[] => {
      const o = s.obs, cfg = s.sampler.cfg;
      return [["camera", s.sampler.cam], ["calibrated", brief(s.sampler.calibrated)], ["corners", fmtCorners(cfg.corners)], ["threshold", brief(cfg.threshold)],
        ["quality", o ? brief(o.quality) : "—"], ["motion", o ? brief(o.motion) : "—"], ["hand squares", o ? String(Array.from(o.handSquares as ArrayLike<number>).filter(Boolean).length) : "—"],
        ["frame", s.frame ? `${s.frame.width}×${s.frame.height}` : "no frame"]];
    });
  },
};

const camWeight = (s: { fusion: Fusion; handMotion: number }, o: SquareObs) => o.quality * o.weight * (s.fusion.reliability.get(o.cam) ?? 0.8) * (o.motion > s.handMotion ? 0.1 : 1);
interface FuseState { fusion: Fusion; board: BoardBelief | null; obs: SquareObs[]; handMotion: number }
const fuse: NodeSpec<FuseState> = {
  type: "vision.fuse", title: "Multi-Camera Fusion", category: "Vision",
  inputs: ["o1", "o2", "o3", "o4"].map((id, i) => ({ id, type: "obs" as const, label: `cam ${i + 1}` })), outputs: [{ id: "board", type: "board" }],
  params: [{ id: "staleMs", kind: "number", label: "Drop feed after (ms)", min: 100, max: 3000, step: 50, value: 600 }, { id: "handMotion", kind: "number", label: "Hand motion gate", min: 0.06, max: 0.4, step: 0.01, value: 0.08 }],
  previewSize: [120, 120],
  init: () => ({ fusion: new Fusion(), board: null, obs: [], handMotion: 0.08 }),
  process(inputs, { now, params, state, setFidelity, span }) {
    const obs = (["o1", "o2", "o3", "o4"].map((k) => inputs[k]).filter(Boolean)) as SquareObs[];
    // timestamp with graph time: cameras that stop producing frames age out and drop from the vote
    const live = obs.map((o) => ({ ...o, t: o.t || now }));
    state.board = span("fuse", () => state.fusion.fuse(live, now, Number(params.staleMs), Number(params.handMotion)));
    state.obs = live; state.handMotion = Number(params.handMotion);
    bus.cameras = live.map((o) => ({ id: o.cam, online: true, quality: o.quality, reliability: state.fusion.reliability.get(o.cam) ?? 0.8 }));
    setFidelity(state.board.fidelity);
    return { board: state.board };
  },
  hover(p, w, h, s) {
    const v = visualSize(w, h, [120, 120]);
    return boardHover(p, v.w, v.h, s.board, {
      title: "Multi-Camera Fusion", fen: bus.game?.fen,
      body: (sq) => (s.board ? `${s.obs.length} camera${s.obs.length === 1 ? "" : "s"} vote on ${sqName(sq)}: each camera's reading is weighted by its picture quality, trust and track record, then added together.` : undefined),
      extra: (sq): TipRow[] => {
        const total = s.obs.reduce((a, o) => a + camWeight(s, o), 0) || 1;
        return s.obs.map((o) => {
          const occ = o.occ[sq], muted = o.motion > s.handMotion;
          return { label: `cam ${o.cam}`, value: `${pct(occ)} occupied${occ > 0.5 ? ` · ${o.white[sq] > 0.5 ? "white" : "black"}` : ""} · weight ${pct(camWeight(s, o) / total)}${muted ? " (hand)" : ""}`, bar: camWeight(s, o) / total, tone: muted ? "warn" : undefined };
        });
      },
    });
  },
  preview: (ctx, w, h, s) => withDetail(ctx, w, h, [120, 120], (pw, ph) => drawBoard(ctx, pw, ph, s.board, { fen: bus.game?.fen, live: true }), () => [
    ["cameras", String(s.board?.cams ?? 0)], ["fidelity", s.board ? brief(s.board.fidelity) : "—"], ["hand over", brief(s.board?.handOver)], ["settled", brief(s.board?.settled)],
    ["pieces seen", s.board ? String(Array.from(s.board.occ).filter((v) => v > 0.5).length) : "—"],
    ...(bus.cameras ?? []).map((c): DetailRow => [`cam ${c.id}`, `q ${brief(c.quality)} · rel ${brief(c.reliability)}`])]),
};

interface StabState { stab: Stabilizer; out: BoardBelief | null; inp: BoardBelief | null }
const stabilize: NodeSpec<StabState> = {
  type: "vision.stabilize", title: "Temporal Stabilizer", category: "Vision",
  inputs: [{ id: "board", type: "board" }], outputs: [{ id: "board", type: "board" }],
  params: [
    { id: "memory", kind: "number", label: "Memory", min: 0.3, max: 0.97, step: 0.01, value: 0.8 },
    { id: "hysteresis", kind: "number", label: "Hysteresis", min: 1, max: 6, step: 0.5, value: 3 },
    { id: "settleMs", kind: "number", label: "Settle time (ms)", min: 100, max: 3000, step: 50, value: 700 },
    { id: "holdOnHand", kind: "bool", label: "Freeze while hand present", value: true },
  ],
  previewSize: [120, 120],
  init: () => ({ stab: new Stabilizer(), out: null, inp: null }),
  process({ board }, { params, state, setFidelity, span }) {
    if (!board) return { board: null };
    const c = state.stab.cfg;
    c.decay = Number(params.memory); c.on = Number(params.hysteresis); c.off = -Number(params.hysteresis); c.settleMs = Number(params.settleMs); c.holdOnHand = !!params.holdOnHand;
    state.inp = board;
    state.out = span("stabilize step", () => state.stab.step(board));
    bus.board = state.out;
    setFidelity(state.out.fidelity);
    return { board: state.out };
  },
  hover(p, w, h, s) {
    const v = visualSize(w, h, [120, 120]), st = s.stab;
    return boardHover(p, v.w, v.h, s.out, {
      title: "Temporal Stabilizer", fen: bus.game?.fen,
      body: (sq) => `${sqName(sq)} only flips when the evidence builds past ±${st.cfg.on} (and back past ${st.cfg.off}), so a one-frame glitch never changes the board.`,
      extra: (sq): TipRow[] => {
        const acc = st.accOcc[sq], lim = st.cfg.on;
        return [
          { label: "Latched as", value: st.occ[sq] ? (st.white[sq] ? "white piece" : "black piece") : "empty" },
          { label: "Evidence (occupied)", value: `${acc >= 0 ? "+" : ""}${acc.toFixed(1)} of ±${lim}`, bar: Math.min(1, Math.abs(acc) / (lim * 2)), tone: Math.abs(acc) >= lim ? "ok" : "warn" },
          { label: "Evidence (colour)", value: `${st.accWhite[sq] >= 0 ? "+" : ""}${st.accWhite[sq].toFixed(1)} → ${st.accWhite[sq] >= 0 ? "white" : "black"}` },
          ...(s.inp ? [{ label: "Input this tick", value: `${pct(s.inp.occ[sq])} occupied · conf ${pct(s.inp.conf[sq])}` }] : []),
          { label: "Memory", value: `${pct(st.cfg.decay)} kept per tick` },
          ...(s.out?.settled ? [] : [{ label: "Board", value: s.out?.handOver ? "frozen: hand present" : "still settling", tone: "warn" as const }]),
        ];
      },
    });
  },
  preview(ctx, w, h, s) {
    withDetail(ctx, w, h, [120, 120], (pw, ph) => {
      drawBoard(ctx, pw, ph, s.out, { fen: bus.game?.fen, live: true });
      if (s.out) { ctx.fillStyle = s.out.handOver ? "#ff5a6e" : s.out.settled ? "#35e0b4" : "#ffb347"; ctx.fillRect(pw - 10, 2, 8, 8); }
    }, () => [["state", s.out ? (s.out.handOver ? "hand over board" : s.out.settled ? "settled" : "settling") : "no input", s.out?.handOver ? "#ff5a6e" : s.out?.settled ? "#35e0b4" : "#ffb347"],
      ["fidelity", s.out ? brief(s.out.fidelity) : "—"], ["pieces", s.out ? String(Array.from(s.out.occ).filter((v) => v > 0.5).length) : "—"],
      ["low confidence", s.out ? String(Array.from(s.out.conf).filter((v) => v < 0.5).length) : "—"], ["cameras", String(s.out?.cams ?? 0)]]);
  },
};

export const visionPlugin: Plugin = { id: "vision", name: "Vision", register: (r) => { r.register(reader); r.register(fuse); r.register(stabilize); } };
