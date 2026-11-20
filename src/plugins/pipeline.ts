import type { HoverInfo, NodeSpec, ParamDef, Plugin } from "../core/types";
import { bus } from "../core/bus";
import { boardTheme } from "../ui/boardThemes";
import { pieceImage } from "../ui/pieceSets";
import type { TipRow } from "../ui/tooltip";
import { BoardCache, type BoardCnn } from "../vision/boardCnn";
import { BOARD_MARGIN, BOARD_PX, BOARD_SIDE, extractBoard } from "../vision/boardImage";
import { loadBoardCnn } from "../vision/boardModel";
import { netPool, type NetResult } from "../vision/netPool";
import { collectFrame } from "../vision/collect";
import { FrameCleaner, type Cleaned } from "../vision/cleaner";
import { cleanPool } from "../vision/cleanPool";
import { BoardSampler, defaultSamplerConfig } from "../vision/sampler";
import { agreement, blendReadings, pieceCount, readingFromProbs, squareConf, type BlendResult, type FlatBoard, type Reading } from "../vision/readings";
import { AutoAligner } from "../ui/autoAlign";
import { extractView, VIEW_SIDE, type BoardView } from "../vision/boardView";
import { loadViewCnn } from "../vision/viewModel";
import type { ViewCnn } from "../vision/viewCnn";
import { SquareCache, type SquareCnn } from "../vision/squareCnn";
import { extractCrops } from "../vision/squareCrops";
import { loadSquareCnn } from "../vision/squareModel";
import { CalibrationWatch } from "../vision/autoCalibrate";
import { autoCalibrate, stopCalibration } from "./vision";
import { sqName, type GrayFrame, type SquareObs } from "../vision/types";
import { FRAME_H, FRAME_W, RIGS, rigCorners } from "../sim/rigs";
import { brief, confColor, drawFrame, fmtCorners, frameScale, looksLikeStart, parseCorners, withDetail, type DetailRow } from "./shared";
import { boardSquareAt, isLightSquare, markSquares, pct, tone, visualSize } from "./hover";

/**
 * The camera-to-board pipeline as separate nodes, one idea each, every one showing what it does:
 *   picture -> Clean Picture -> Flatten Board -> detectors (Brightness Reader, Neural Board Reader, Neural Square Reader)
 *           -> Blend Readings -> Camera Reading -> Multi-Camera Fusion.
 * Detectors say whether a piece stands on a square and which colour it is. The Neural Board Reader also shows the piece
 * type it thinks it sees (a letter on the disc) when its model reads them; that is for watching only, the tracker still
 * works the pieces out from the moves.
 */
const BASE: [number, number] = [160, 160];
const WHITE = "#fdfdfd", BLACK = "#1f1d1b";

/** Plain grey copy of a flattened board, built once per board and shared by every preview that shows it. */
const flatCache = new WeakMap<FlatBoard, HTMLCanvasElement>();
function flatCanvas(f: FlatBoard): HTMLCanvasElement {
  let c = flatCache.get(f);
  if (c) return c;
  c = document.createElement("canvas"); c.width = c.height = BOARD_SIDE;
  const ctx = c.getContext("2d");
  if (ctx && typeof ctx.createImageData === "function") {
    const im = ctx.createImageData(BOARD_SIDE, BOARD_SIDE);
    for (let i = 0; i < f.img.length; i++) { const v = Math.max(0, Math.min(255, f.img[i] * 255)); im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; }
    ctx.putImageData(im, 0, 0);
  }
  flatCache.set(f, c);
  return c;
}

interface PresenceOpts { flat?: FlatBoard | null; rings?: Uint8Array | null; note?: string; /** Class probabilities per square (13 each: empty, white P N B R Q K, black P N B R Q K), when the detector reads piece types. */ types?: Float32Array | null }

/** The most likely piece letter on a square from 13-class probabilities, given its colour (so a white-looking disc never gets a black class). */
export function pieceLetter(types: ArrayLike<number>, sq: number, white: boolean): string {
  const base = sq * 13 + (white ? 1 : 7);
  let best = 0;
  for (let k = 1; k < 6; k++) if (types[base + k] > types[base + best]) best = k;
  return "PNBRQK"[best];
}
/**
 * A detector's board: the flattened picture it looked at, and on each square a disc where it thinks a piece stands
 * (white or black, fainter when less sure, with the percentage under 100%). Empty squares stay clean. Amber rings
 * mark squares where combined readings disagree, red ticks the squares a hand is over.
 */
function drawPresence(ctx: CanvasRenderingContext2D, w: number, h: number, r: Reading | null | undefined, o: PresenceOpts = {}) {
  const th = boardTheme();
  ctx.fillStyle = th.surround; ctx.fillRect(0, 0, w, h);
  const s = Math.min(w, h) / 8, ox = (w - s * 8) / 2;
  if (o.flat) {
    const m = BOARD_MARGIN * BOARD_PX;
    ctx.drawImage(flatCanvas(o.flat), m, m, BOARD_SIDE - 2 * m, BOARD_SIDE - 2 * m, ox, 0, s * 8, s * 8);
    ctx.fillStyle = "rgba(0,0,0,.18)"; ctx.fillRect(ox, 0, s * 8, s * 8);
  } else for (let i = 0; i < 64; i++) { ctx.fillStyle = ((i % 8) + Math.floor(i / 8)) % 2 ? th.dark : th.light; ctx.fillRect(ox + (i % 8) * s, Math.floor(i / 8) * s, s, s); }
  ctx.strokeStyle = "rgba(255,255,255,.14)"; ctx.lineWidth = 1; ctx.beginPath();
  for (let i = 0; i <= 8; i++) { ctx.moveTo(ox + i * s, 0); ctx.lineTo(ox + i * s, s * 8); ctx.moveTo(ox, i * s); ctx.lineTo(ox + s * 8, i * s); }
  ctx.stroke();
  if (!r) { ctx.fillStyle = "#8fa0a8"; ctx.font = "12px system-ui"; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(o.note ?? "no reading yet", 8, h / 2); return; }
  for (let i = 0; i < 64; i++) {
    const x = ox + (i % 8) * s, y = Math.floor(i / 8) * s, cx = x + s / 2, cy = y + s / 2, occ = r.occ[i];
    if (occ > 0.5) {
      const white = r.white[i] > 0.5, c = squareConf(r, i);
      const letter = o.types ? pieceLetter(o.types, i, white) : null;
      // the piece the model says it is, drawn as the piece itself; a disc with its letter while the picture loads
      const icon = letter ? pieceImage((white ? "w" : "b") + letter.toLowerCase()) : null;
      ctx.globalAlpha = 0.3 + 0.7 * c;
      if (icon) ctx.drawImage(icon, cx - s * 0.42, cy - s * 0.46, s * 0.84, s * 0.84);
      else {
        ctx.fillStyle = white ? WHITE : BLACK; ctx.strokeStyle = white ? "#3b3a37" : "#e8e8e8"; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(cx, cy, s * 0.3, 0, 7); ctx.fill(); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (letter && !icon && s >= 14) {
        ctx.font = `700 ${Math.max(8, s * 0.36)}px "IBM Plex Mono",ui-monospace,monospace`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillStyle = white ? "#1f1d1b" : "#fdfdfd"; ctx.fillText(letter, cx, cy + s * 0.02);
      }
      if (s >= 18) {
        const t = String(Math.round(c * 100));
        ctx.font = `600 ${Math.max(7, s * 0.2)}px "IBM Plex Mono",ui-monospace,monospace`; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
        ctx.fillStyle = "rgba(0,0,0,.65)"; ctx.fillText(t, cx + 0.7, y + s - 2 + 0.7); ctx.fillStyle = confColor(c); ctx.fillText(t, cx, y + s - 2);
      }
    } else if (occ > 0.3) { // unsure there is anything: a dashed hint, no disc
      ctx.strokeStyle = "rgba(255,200,90,.7)"; ctx.lineWidth = 1.2; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.arc(cx, cy, s * 0.26, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    }
    if (o.rings?.[i]) { ctx.strokeStyle = "#ffb347"; ctx.lineWidth = Math.max(1.5, s * 0.07); ctx.strokeRect(x + 1.5, y + 1.5, s - 3, s - 3); }
    if (r.handSquares?.[i]) { ctx.fillStyle = "rgba(255,90,110,.85)"; ctx.fillRect(x + s - 5, y + 2, 3, 3); }
  }
}

const counts = (r: Reading | null | undefined): DetailRow[] => {
  if (!r) return [["pieces", "—"]];
  let white = 0, black = 0, sure = 0, min = 1;
  for (let i = 0; i < 64; i++) { if (r.occ[i] > 0.5) { if (r.white[i] > 0.5) white++; else black++; } const c = squareConf(r, i); sure += c; min = Math.min(min, c); }
  return [["pieces", `${white + black} (${white} white, ${black} black)`], ["average sureness", pct(sure / 64)], ["least sure", pct(min)]];
};
const meanConf = (r: Reading) => { let s = 0; for (let i = 0; i < 64; i++) s += squareConf(r, i); return s / 64; };

/** Hover card for a square of a detector board: what this reading says and how sure it is. */
function squareHover(p: { x: number; y: number }, w: number, h: number, r: Reading | null | undefined, title: string, body: string, extra?: (sq: number) => TipRow[]): HoverInfo | null {
  const v = visualSize(w, h, BASE);
  if (p.x > v.w || p.y > v.h) return null;
  const q = boardSquareAt(p, v.w, v.h);
  if (q === null) return null;
  if (!r) return { title: sqName(q), tag: title, color: "#35e0b4", body: "Nothing to show yet: this node has no input." };
  const occ = r.occ[q], white = r.white[q], c = squareConf(r, q);
  const rows: TipRow[] = [
    { label: "Square", value: `${sqName(q)} (${isLightSquare(q) ? "light" : "dark"})` },
    { label: "Says", value: occ > 0.5 ? `${white > 0.5 ? "white" : "black"} piece` : "empty" },
    { label: "Sure of it", value: pct(c), bar: c, tone: tone(c) },
    { label: "A piece is here", value: pct(occ), bar: occ },
    ...(occ > 0.5 ? [{ label: "Piece is white", value: pct(white), bar: white } as TipRow] : []),
    ...(extra?.(q) ?? []),
  ];
  return { title: sqName(q), tag: title, color: "#35e0b4", body, rows, mark: (ctx) => markSquares(ctx, v.w, v.h, q) };
}

const sparse = (f: GrayFrame) => { const step = Math.max(1, Math.floor(f.data.length / 1500)), out: number[] = []; for (let i = 0; i < f.data.length; i += step) out.push(f.data[i]); return out; };
const meanLuma = (f: GrayFrame) => { const d = f.data, step = Math.max(1, Math.floor(d.length / 4096)); let sum = 0, n = 0; for (let i = 0; i < d.length; i += step) { sum += d[i]; n++; } return n ? sum / n : 0; };

// ---------------------------------------------------------------- Clean Picture
interface CleanState { cleaner: FrameCleaner; key: string; inflight: number; epoch: number; ready: Cleaned | null; raw: GrayFrame | null; out: GrayFrame | null; probe: number[] | null; motion: number; ms: number }
let cleanSeq = 0;
const clean: NodeSpec<CleanState> = {
  type: "vision.clean", title: "Clean Picture", category: "Vision",
  desc: "Shrinks the camera picture to the size the readers use, removes sensor noise (median filter) and averages the last few frames of a still board. Averaging restarts whenever something moves.",
  inputs: [{ id: "frame", type: "frame" }], outputs: [{ id: "frame", type: "frame" }],
  params: [
    { id: "clean", kind: "bool", label: "Remove noise", value: true },
    { id: "average", kind: "number", label: "Average frames", min: 1, max: 8, step: 1, value: 4 },
  ],
  previewSize: [240, 90],
  init: () => ({ cleaner: new FrameCleaner(), key: `clean${++cleanSeq}`, inflight: 0, epoch: 0, ready: null, raw: null, out: null, probe: null, motion: 0, ms: 0 }),
  process({ frame }, { params, state, setFidelity }) {
    if (!frame) { if (state.raw) cleanPool().forget(state.key); state.raw = state.out = state.ready = state.probe = null; state.cleaner.recent = []; state.epoch++; state.inflight = 0; setFidelity(null); return { frame: null }; }
    if (frame !== state.raw) {
      // how much changed since the last picture, from a sparse sample: a hand or a moved piece must not be averaged into the still board
      const probe = sparse(frame);
      let d = 0; if (state.probe && state.probe.length === probe.length) { for (let i = 0; i < probe.length; i++) d += Math.abs(probe[i] - state.probe[i]); d /= probe.length; }
      state.probe = probe; state.motion = d; state.raw = frame;
      const opts = { width: FRAME_W, height: FRAME_H, keep: Number(params.average), clean: !!params.clean, reset: d > 5 };
      const pool = cleanPool(), t0 = performance.now();
      if (!pool.supported) { state.ready = state.cleaner.run(frame, opts); state.ms = performance.now() - t0; }
      else {
        if (state.inflight && t0 - state.inflight > 2000) { state.epoch++; state.inflight = 0; } // a lost answer must never stall the pipeline
        if (!state.inflight) {
          state.inflight = t0; const epoch = state.epoch;
          void pool.clean(state.key, frame, opts).then((r) => { if (epoch === state.epoch) { state.inflight = 0; state.ms = performance.now() - t0; state.ready = r; } });
        }
      }
    }
    if (state.ready) { state.out = state.ready.cleaned; state.ready = null; }
    setFidelity(state.out ? 1 - Math.min(1, state.motion / 20) : null);
    return { frame: state.out };
  },
  dispose(s) { cleanPool().forget(s.key); },
  preview(ctx, w, h, s) {
    withDetail(ctx, w, h, [240, 90], (pw, ph) => {
      ctx.fillStyle = "#07090d"; ctx.fillRect(0, 0, pw, ph);
      const half = pw / 2;
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, half - 1, ph); ctx.clip(); drawFrame(ctx, half - 1, ph, s.raw, "no picture"); ctx.restore();
      ctx.save(); ctx.translate(half + 1, 0); ctx.beginPath(); ctx.rect(0, 0, half - 1, ph); ctx.clip(); drawFrame(ctx, half - 1, ph, s.out, "cleaning…"); ctx.restore();
      ctx.font = "600 9px system-ui"; ctx.textBaseline = "top"; ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillRect(2, 2, 52, 12); ctx.fillRect(half + 3, 2, 70, 12);
      ctx.fillStyle = "#cfe0ff"; ctx.textAlign = "left"; ctx.fillText("camera", 5, 4); ctx.fillText("cleaned", half + 6, 4);
    }, () => [["input", s.raw ? `${s.raw.width}×${s.raw.height}` : "no frame"], ["output", s.out ? `${s.out.width}×${s.out.height}` : "—"], ["change since last", brief(s.motion)], ["clean-up time", `${s.ms.toFixed(0)} ms`]]);
  },
};

// ---------------------------------------------------------------- Flatten Board
interface FlatState { frame: GrayFrame | null; of: GrayFrame | null; key: string; flat: FlatBoard | null; ms: number; why: string; sampler: { cam: string }; obs: SquareObs | null; watch: CalibrationWatch; aligner: AutoAligner | null; checkAt: number; fit: number }
const flatten: NodeSpec<FlatState> = {
  type: "vision.flatten", title: "Flatten Board", category: "Vision",
  desc: "Uses the four board corners to cut the board out of the camera picture and straighten it into one square image, with a square of margin all round. Every detector after it reads this same image.",
  inputs: [{ id: "frame", type: "frame" }], outputs: [{ id: "flat", type: "flat" }],
  params: [
    { id: "cam", kind: "text", label: "Camera id", value: "A" },
    { id: "corners", kind: "text", label: "Board corners", value: fmtCorners(rigCorners(RIGS.A)), quad: { names: ["a8", "h8", "h1", "a1"], grid: 8 } },
    { id: "autoFind", kind: "bool", label: "Suggest auto-calibration when lost", value: true },
    { id: "collect", kind: "bool", label: "Save training frames (dev server only)", value: false },
  ],
  previewSize: BASE,
  frameOf: (s) => s.frame,
  init: () => ({ frame: null, of: null, key: "", flat: null, ms: 0, why: "no picture", sampler: { cam: "A" }, obs: null, watch: new CalibrationWatch(), aligner: null, checkAt: -Infinity, fit: 1 }),
  process({ frame }, { params, state, now, setFidelity }) {
    state.frame = frame ?? null; state.sampler.cam = String(params.cam);
    if (!frame) { stopCalibration(state, now); state.flat = state.of = null; state.why = "no picture"; setFidelity(null); return { flat: null }; }
    const c = parseCorners(String(params.corners));
    if (!c) { state.flat = null; state.why = "corners are not valid"; setFidelity(null); return { flat: null }; }
    const key = `${params.corners}|${params.cam}`;
    if (frame !== state.of || key !== state.key) {
      const t0 = performance.now(), sc = frameScale(frame.width, frame.height), corners = c.map((p) => ({ x: p.x * sc.sx, y: p.y * sc.sy }));
      state.flat = { cam: String(params.cam), t: frame.t, img: extractBoard(frame, corners), frame, corners };
      state.of = frame; state.key = key; state.ms = performance.now() - t0; state.why = "";
      if (params.collect) collectFrame({ cam: String(params.cam), frame, corners, fen: bus.game?.fen, board: bus.board });
    }
    // The watch needs a picture-quality figure; the camera reading that follows publishes one on the bus.
    const q = bus.cameras.find((c) => c.id === state.sampler.cam)?.quality;
    state.obs = q === undefined ? null : ({ cam: state.sampler.cam, t: frame.t, quality: q, weight: 1, occ: new Float32Array(64), white: new Float32Array(64), motion: 0, handSquares: new Uint8Array(64) } as SquareObs);
    autoCalibrate(state, params, frame, now, state.of === frame);
    setFidelity(1);
    return { flat: state.flat };
  },
  preview(ctx, w, h, s) {
    withDetail(ctx, w, h, BASE, (pw, ph) => {
      ctx.fillStyle = "#07090d"; ctx.fillRect(0, 0, pw, ph);
      if (!s.flat) { ctx.fillStyle = "#8fa0a8"; ctx.font = "12px system-ui"; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(s.why, 8, ph / 2); return; }
      const side = Math.min(pw, ph), ox = (pw - side) / 2, oy = (ph - side) / 2, k = side / BOARD_SIDE;
      ctx.imageSmoothingEnabled = false; ctx.drawImage(flatCanvas(s.flat), ox, oy, side, side);
      const b0 = BOARD_MARGIN * BOARD_PX * k, bs = 8 * BOARD_PX * k;
      ctx.strokeStyle = "#35e0b4"; ctx.lineWidth = 1.5; ctx.strokeRect(ox + b0, oy + b0, bs, bs);
      ctx.strokeStyle = "rgba(53,224,180,.35)"; ctx.lineWidth = 1; ctx.beginPath();
      for (let i = 1; i < 8; i++) { ctx.moveTo(ox + b0 + (i * bs) / 8, oy + b0); ctx.lineTo(ox + b0 + (i * bs) / 8, oy + b0 + bs); ctx.moveTo(ox + b0, oy + b0 + (i * bs) / 8); ctx.lineTo(ox + b0 + bs, oy + b0 + (i * bs) / 8); }
      ctx.stroke();
      if (bs >= 100) { ctx.font = "600 9px system-ui"; ctx.fillStyle = "#35e0b4"; ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillText("a8", ox + b0 + 2, oy + b0 + 2); ctx.textAlign = "right"; ctx.textBaseline = "bottom"; ctx.fillText("h1", ox + b0 + bs - 2, oy + b0 + bs - 2); }
    }, () => [["camera", String(s.flat?.cam ?? "—")], ["picture", s.frame ? `${s.frame.width}×${s.frame.height}` : "—"], ["flat image", `${BOARD_SIDE}×${BOARD_SIDE} (${BOARD_PX} px a square)`], ["time", `${s.ms.toFixed(1)} ms`], ["corners", s.flat ? fmtCorners(s.flat.corners) : "—"]]);
  },
};

// ---------------------------------------------------------------- Brightness Reader (heuristic)
interface BrightState { sampler: BoardSampler; of: GrayFrame | null; obs: SquareObs | null; reading: Reading | null; flat: FlatBoard | null; cornersKey: string; autoDone: boolean; calT: number; calTries: number; settings: string; ms: number }
const brightness: NodeSpec<BrightState> = {
  type: "vision.brightness", title: "Brightness Reader", category: "Vision",
  desc: "A hand-written rule reader, no learning. It compares each square's brightness and texture with what that square looks like empty, and with its own corners. It also watches for hands and moving pieces.",
  inputs: [{ id: "flat", type: "flat" }], outputs: [{ id: "reading", type: "reading" }],
  params: [
    { id: "threshold", kind: "number", label: "Piece sensitivity", min: 0.15, max: 0.6, step: 0.01, value: 0.22 },
    { id: "shapeWeight", kind: "number", label: "Shape / texture evidence", min: 0.25, max: 2, step: 0.25, value: 1 },
    { id: "colorWeight", kind: "number", label: "Color / brightness evidence", min: 0.25, max: 2, step: 0.25, value: 1 },
    { id: "patch", kind: "number", label: "Piece size / sample width", min: 0.35, max: 0.85, step: 0.05, value: 0.6 },
    { id: "positionWeight", kind: "number", label: "Position / perspective correction", min: 0, max: 2, step: 0.25, value: 1 },
    { id: "softness", kind: "number", label: "Decision softness", min: 0.02, max: 0.2, step: 0.005, value: 0.06 },
    { id: "grid", kind: "number", label: "Sample dots per axis", min: 3, max: 10, step: 1, value: 6 },
    { id: "autoCal", kind: "bool", label: "Auto-learn at start position", value: true },
    { id: "learn", kind: "bool", label: "Learn now", value: false, action: true },
  ],
  previewSize: BASE,
  init: () => ({ sampler: new BoardSampler("A", defaultSamplerConfig()), of: null, obs: null, reading: null, flat: null, cornersKey: "", autoDone: false, calT: -Infinity, calTries: 0, settings: "", ms: 0 }),
  process({ flat }, { params, state, setFidelity }) {
    const f = flat as FlatBoard | null | undefined, s = state.sampler;
    if (!f) { state.reading = state.obs = state.flat = state.of = null; setFidelity(null); return { reading: null }; }
    state.flat = f; s.cam = f.cam;
    const cfg = s.cfg, ck = JSON.stringify(f.corners);
    cfg.corners = f.corners;
    // moved corners make the learned empty squares stale: learn the start position again, unless a game is under way
    if (ck !== state.cornersKey) { if (state.cornersKey && !((bus.game?.ply ?? 0) > 0)) { state.autoDone = false; state.calTries = 0; state.calT = -Infinity; } state.cornersKey = ck; state.of = null; }
    cfg.threshold = Number(params.threshold); cfg.shapeWeight = Number(params.shapeWeight); cfg.colorWeight = Number(params.colorWeight);
    cfg.patch = Number(params.patch); cfg.positionWeight = Number(params.positionWeight); cfg.softness = Number(params.softness); cfg.grid = Math.round(Number(params.grid));
    cfg.engine = "rules";
    const settings = JSON.stringify([params.threshold, params.shapeWeight, params.colorWeight, params.patch, params.positionWeight, params.softness, params.grid]);
    if (settings !== state.settings) { state.settings = settings; state.of = null; }
    const img = f.frame, started = (bus.game?.ply ?? 0) > 0;
    if (params.learn) { s.calibrateFromStart(img); state.autoDone = true; params.learn = false; state.of = null; }
    else if (params.autoCal && !state.autoDone && (!started || !s.calibrated) && img !== state.of && img.t - state.calT >= 1000 && !(state.obs && state.obs.motion > 0.02) && meanLuma(img) >= 20) {
      s.calibrateFromStart(img); state.calT = img.t; state.calTries++;
      state.of = img; state.obs = s.read(img, 1);
      if (looksLikeStart(state.obs) || state.calTries >= 8 || (started && s.calibrated)) state.autoDone = true;
    }
    if (img !== state.of || !state.obs) { const t0 = performance.now(); state.of = img; state.obs = s.read(img, 1); state.ms = performance.now() - t0; }
    const o = state.obs;
    // the reading only changes with a new picture: keep the same object so downstream nodes and previews can tell nothing changed
    if (!state.reading || state.reading.occ !== o.occ || state.reading.t !== f.t) state.reading = { cam: f.cam, t: f.t, source: "brightness", occ: o.occ, white: o.white, quality: o.quality, motion: o.motion, handSquares: o.handSquares };
    setFidelity(o.quality * (1 - Math.min(1, o.motion * 4)));
    return { reading: state.reading };
  },
  preview(ctx, w, h, s) {
    withDetail(ctx, w, h, BASE, (pw, ph) => drawPresence(ctx, pw, ph, s.reading, { flat: s.flat, note: s.flat ? "learning the empty squares…" : "no board yet" }), () => [
      ...counts(s.reading), ["picture quality", s.reading ? brief(s.reading.quality) : "—"], ["motion", s.reading ? brief(s.reading.motion) : "—"],
      ["hand squares", s.reading?.handSquares ? String(Array.from(s.reading.handSquares).filter(Boolean).length) : "—"], ["learned empty squares", brief(s.sampler.calibrated)], ["time", `${s.ms.toFixed(1)} ms`]]);
  },
  hover(p, w, h, s) {
    return squareHover(p, w, h, s.reading, "Brightness Reader", "Compares the squares' brightness and texture with the empty square it learned and with the square's own corners. A piece only a little lighter or darker than its square still counts; a blown-out glare spot is left undecided.", (q) => {
      if (!s.flat || !s.sampler.calibrated) return [{ label: "Reference", value: "not learned yet", tone: "warn" }];
      const d = s.sampler.diagnose(s.flat.frame, q);
      return Number.isNaN(d.crown) ? [] : [{ label: "Brightness", value: `${Math.round(d.crown)} vs ${Math.round(d.ref)} empty` }, { label: "Change", value: `${d.drive >= 0 ? "+" : ""}${Math.round(d.drive)} (needs ±${Math.round(d.gate)})`, bar: Math.min(1, Math.abs(d.drive) / (d.gate * 2 || 1)), tone: Math.abs(d.drive) > d.gate ? "ok" : "warn" }];
    });
  },
};

// ---------------------------------------------------------------- Neural Board Reader (ML)
interface NetState<N, C> { net: N | null; cache: C | null; cacheOf: N | null; loading: boolean; reading: Reading | null; flat: FlatBoard | null; ran: boolean; ms: number; lastRun: number; shape: string }
/** Reads per second a network node is allowed: a board changes slowly, so the last reading stands in between. */
const RATE: ParamDef = { id: "maxRate", kind: "number", label: "Reads per second (at most)", min: 1, max: 30, step: 1, value: 8 };
/** True when the last reading is still fresh enough to reuse for this picture. */
const reuse = (st: { reading: Reading | null; lastRun: number; shape: string }, f: FlatBoard, now: number, rate: number) =>
  !!st.reading && st.shape === JSON.stringify(f.corners) && now - st.lastRun < 1000 / Math.max(1, rate);
/** The board reader's state: the network runs in a worker when the browser has one, inline otherwise (tests). */
interface BoardNetState extends NetState<BoardCnn, BoardCache> { loaded: boolean; inflight: number; epoch: number; arrived: NetResult | null; probs: Float32Array | null; types: Float32Array | null; key: string; readOf: Float32Array | null; readT: number }
let boardSeq = 0;
const neuralBoard: NodeSpec<BoardNetState> = {
  type: "vision.neuralBoard", title: "Neural Board Reader", category: "Vision",
  desc: "A small trained network that looks at the whole flattened board at once and says, for every square, whether a piece stands there and which colour. Runs on your device in the background, so it never stalls the picture; a still board costs almost nothing.",
  inputs: [{ id: "flat", type: "flat" }], outputs: [{ id: "reading", type: "reading" }],
  params: [{ id: "temperature", kind: "number", label: "Caution (higher = less sure)", min: 1, max: 4, step: 0.25, value: 2 }, RATE],
  previewSize: BASE,
  init: () => ({ net: null, cache: null, cacheOf: null, loading: false, reading: null, flat: null, ran: false, ms: 0, lastRun: -Infinity, shape: "", loaded: false, inflight: 0, epoch: 0, arrived: null, probs: null, types: null, key: `neural${++boardSeq}`, readOf: null, readT: 0 }),
  process({ flat }, { params, state, setFidelity, now }) {
    const f = flat as FlatBoard | null | undefined, T = Number(params.temperature), rate = Number(params.maxRate);
    state.flat = f ?? null;
    const pool = netPool();
    if (!pool.supported && !state.net && !state.loading) { state.loading = true; void loadBoardCnn().then((n) => { state.net = n; }).catch(() => { state.loading = false; }); } // load while there is nothing to read yet
    if (!f) { state.reading = null; state.probs = null; state.types = null; state.arrived = null; state.epoch++; state.inflight = 0; setFidelity(null); return { reading: null }; }
    const shape = JSON.stringify(f.corners);
    if (pool.supported) {
      // an answer from the worker arrives between ticks; ask for the next one when it is time (at once if the corners moved)
      if (state.arrived) { state.probs = state.arrived.probs; state.types = state.arrived.types; state.ran = state.arrived.ran; if (state.ran) state.ms = state.arrived.ms; state.loaded = true; state.arrived = null; }
      const t = performance.now();
      if (state.inflight && t - state.inflight > 3000) { state.epoch++; state.inflight = 0; } // a lost answer must never stall the reader
      if (!state.inflight && (shape !== state.shape || now - state.lastRun >= 1000 / Math.max(1, rate))) {
        state.inflight = t; state.lastRun = now; state.shape = shape;
        const epoch = state.epoch;
        void pool.read(state.key, f.img).then((r) => { if (epoch === state.epoch) { state.inflight = 0; state.arrived = r; } });
      }
      if (!state.probs) { state.reading = null; setFidelity(null); return { reading: null }; }
      if (state.probs !== state.readOf || T !== state.readT || f.t !== state.reading?.t) { state.reading = readingFromProbs(f.cam, f.t, "neural board", state.probs, T); state.readOf = state.probs; state.readT = T; }
      setFidelity(meanConf(state.reading!));
      return { reading: state.reading };
    }
    if (!state.net) { state.reading = null; setFidelity(null); return { reading: null }; }
    state.loaded = true;
    if (reuse(state, f, now, rate)) { state.ran = false; state.reading = { ...state.reading!, t: f.t }; return { reading: state.reading }; }
    if (state.cacheOf !== state.net) { state.cache = new BoardCache(state.net); state.cacheOf = state.net; }
    const t0 = performance.now(), probs = state.cache!.classify(f.img);
    state.ran = state.cache!.ran; if (state.ran) state.ms = performance.now() - t0;
    state.lastRun = now; state.shape = shape;
    state.types = state.net.classes === 13 ? state.cache!.types : null;
    state.reading = readingFromProbs(f.cam, f.t, "neural board", probs, T);
    setFidelity(meanConf(state.reading));
    return { reading: state.reading };
  },
  dispose(s) { netPool().forget(s.key); },
  preview(ctx, w, h, s) {
    withDetail(ctx, w, h, BASE, (pw, ph) => drawPresence(ctx, pw, ph, s.reading, { flat: s.flat, types: s.types, note: s.loaded ? "no board yet" : "loading the model…" }), () => [
      ...counts(s.reading), ...(s.types ? [["piece types", "read by the model (shown as piece icons)"] as DetailRow] : []), ["model", s.loaded ? "loaded" : "loading"], ["ran last read", s.ran ? "yes" : "no, picture unchanged"], ["last run", `${s.ms.toFixed(1)} ms`], ["where", netPool().supported ? "background worker" : "main thread"]]);
  },
  hover(p, w, h, s) { return squareHover(p, w, h, s.reading, "Neural Board Reader", "The network sees the whole flattened board, so a tall piece leaning over its neighbour or a hand on the board is read in context. Its probabilities are tempered so a camera it has never seen cannot shout."); },
};

// ---------------------------------------------------------------- Neural Square Reader (ML)
const neuralSquares: NodeSpec<NetState<SquareCnn, SquareCache>> = {
  type: "vision.neuralSquares", title: "Neural Square Reader", category: "Vision",
  desc: "A smaller trained network that looks at one square at a time, with the squares around it. Cheaper than the board reader but blind to context.",
  inputs: [{ id: "flat", type: "flat" }], outputs: [{ id: "reading", type: "reading" }],
  params: [{ id: "temperature", kind: "number", label: "Caution (higher = less sure)", min: 1, max: 4, step: 0.25, value: 2 }, RATE],
  previewSize: BASE,
  init: () => ({ net: null, cache: null, cacheOf: null, loading: false, reading: null, flat: null, ran: false, ms: 0, lastRun: -Infinity, shape: "" }),
  process({ flat }, { params, state, setFidelity, now }) {
    const f = flat as FlatBoard | null | undefined;
    if (!state.net && !state.loading) { state.loading = true; void loadSquareCnn().then((n) => { state.net = n; }).catch(() => { state.loading = false; }); }
    if (!f || !state.net) { state.reading = null; state.flat = f ?? null; setFidelity(null); return { reading: null }; }
    state.flat = f;
    if (reuse(state, f, now, Number(params.maxRate))) { state.ran = false; state.reading = { ...state.reading!, t: f.t }; return { reading: state.reading }; }
    if (state.cacheOf !== state.net) { state.cache = new SquareCache(state.net); state.cacheOf = state.net; }
    const t0 = performance.now(), probs = state.cache!.classify(extractCrops(f.frame, f.corners));
    state.ran = state.cache!.ran > 0; if (state.ran) state.ms = performance.now() - t0;
    state.lastRun = now; state.shape = JSON.stringify(f.corners);
    state.reading = readingFromProbs(f.cam, f.t, "neural squares", probs, Number(params.temperature));
    setFidelity(meanConf(state.reading));
    return { reading: state.reading };
  },
  preview(ctx, w, h, s) {
    withDetail(ctx, w, h, BASE, (pw, ph) => drawPresence(ctx, pw, ph, s.reading, { flat: s.flat, note: s.net ? "no board yet" : "loading the model…" }), () => [
      ...counts(s.reading), ["model", s.net ? "loaded" : "loading"], ["squares re-read", s.cache ? String(s.cache.ran) : "—"], ["last run", `${s.ms.toFixed(1)} ms`]]);
  },
  hover(p, w, h, s) { return squareHover(p, w, h, s.reading, "Neural Square Reader", "Each square is cut out (two squares wide, so a leaning piece is included) and classified on its own: empty, white or black. Squares whose picture has not changed are not read again."); },
};

// ---------------------------------------------------------------- Mask Board + Neural View Reader
const viewCanvas = new WeakMap<BoardView, HTMLCanvasElement>();
function viewImage(v: BoardView): HTMLCanvasElement {
  let c = viewCanvas.get(v);
  if (c) return c;
  c = document.createElement("canvas"); c.width = c.height = VIEW_SIDE;
  const ctx = c.getContext("2d");
  if (ctx && typeof ctx.createImageData === "function") {
    const im = ctx.createImageData(VIEW_SIDE, VIEW_SIDE);
    for (let i = 0; i < v.img.length; i++) { const g = Math.max(0, Math.min(255, v.img[i] * 255)); im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = g; im.data[i * 4 + 3] = 255; }
    ctx.putImageData(im, 0, 0);
  }
  viewCanvas.set(v, c);
  return c;
}
interface MaskState { view: BoardView | null; of: FlatBoard | null; ms: number; why: string }
const mask: NodeSpec<MaskState> = {
  type: "vision.mask", title: "Mask Board", category: "Vision",
  desc: "Keeps the board exactly as the camera sees it, with its perspective, and blacks out everything outside the board (with some padding). The picture is only turned so the board's a8-h8 edge runs left to right. Uses the corners and picture from Flatten Board, so place the corners there.",
  inputs: [{ id: "flat", type: "flat" }], outputs: [{ id: "view", type: "view" }],
  params: [],
  previewSize: BASE,
  init: () => ({ view: null, of: null, ms: 0, why: "no board yet" }),
  process({ flat }, { state, setFidelity }) {
    const f = flat as FlatBoard | null | undefined;
    if (!f) { state.view = state.of = null; state.why = "no board yet"; setFidelity(null); return { view: null }; }
    if (f !== state.of) {
      const t0 = performance.now();
      state.view = { cam: f.cam, t: f.t, img: extractView(f.frame, f.corners) };
      state.of = f; state.ms = performance.now() - t0;
    }
    setFidelity(1);
    return { view: state.view };
  },
  preview(ctx, w, h, s) {
    withDetail(ctx, w, h, BASE, (pw, ph) => {
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, pw, ph);
      if (!s.view) { ctx.fillStyle = "#8fa0a8"; ctx.font = "12px system-ui"; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(s.why, 8, ph / 2); return; }
      const side = Math.min(pw, ph); ctx.imageSmoothingEnabled = true; ctx.drawImage(viewImage(s.view), (pw - side) / 2, (ph - side) / 2, side, side);
    }, () => [["camera", s.view?.cam ?? "—"], ["view", `${VIEW_SIDE}×${VIEW_SIDE}, perspective kept`], ["time", `${s.ms.toFixed(1)} ms`]]);
  },
};

interface ViewNetState { net: ViewCnn | null; loading: boolean; reading: Reading | null; ran: boolean; ms: number; lastRun: number; of: BoardView | null; loaded: boolean }
const neuralView: NodeSpec<ViewNetState> = {
  type: "vision.neuralView", title: "Neural View Reader", category: "Vision",
  desc: "A trained network that reads the masked board as the camera sees it, without straightening it first. It was trained on boards seen from every angle round the table, so it has to know what a whole board looks like from where the camera is. Useful when the corners are a little off, because nothing is warped by them.",
  inputs: [{ id: "view", type: "view" }], outputs: [{ id: "reading", type: "reading" }],
  params: [{ id: "temperature", kind: "number", label: "Caution (higher = less sure)", min: 1, max: 4, step: 0.25, value: 2 }, RATE],
  previewSize: BASE,
  init: () => ({ net: null, loading: false, reading: null, ran: false, ms: 0, lastRun: -Infinity, of: null, loaded: false }),
  process({ view }, { params, state, setFidelity, now }) {
    const v = view as BoardView | null | undefined;
    if (!state.net && !state.loading) { state.loading = true; void loadViewCnn().then((n) => { state.net = n; state.loaded = true; }).catch(() => { state.loading = false; }); }
    if (!v || !state.net) { state.reading = null; state.of = null; setFidelity(null); return { reading: null }; }
    if (state.reading && (v === state.of || now - state.lastRun < 1000 / Math.max(1, Number(params.maxRate)))) { state.ran = false; return { reading: state.reading }; }
    const t0 = performance.now(), probs = state.net.classify(v.img);
    state.ms = performance.now() - t0; state.ran = true; state.lastRun = now; state.of = v;
    state.reading = readingFromProbs(v.cam, v.t, "neural view", probs, Number(params.temperature));
    setFidelity(meanConf(state.reading));
    return { reading: state.reading };
  },
  preview(ctx, w, h, s) {
    withDetail(ctx, w, h, BASE, (pw, ph) => drawPresence(ctx, pw, ph, s.reading, { note: s.loaded ? "no board yet" : "loading the model…" }), () => [
      ...counts(s.reading), ["model", s.loaded ? "loaded" : "loading"], ["ran last read", s.ran ? "yes" : "no, picture unchanged"], ["last run", `${s.ms.toFixed(1)} ms`]]);
  },
  hover(p, w, h, s) { return squareHover(p, w, h, s.reading, "Neural View Reader", "Reads the board straight from the masked camera view, so a bad corner cannot bend the picture it sees. Its probabilities are tempered so a camera angle it has never seen cannot shout."); },
};

// ---------------------------------------------------------------- Blend Readings
interface BlendState { res: BlendResult | null; inputs: (Reading | null)[]; ms: number; trust: number[]; eff: number[] }
const IN = ["r1", "r2", "r3", "r4"] as const;
const trustScale = (agree: number) => Math.max(0, Math.min(1, (agree - 0.8) / 0.2)); // 80% agreement or less = no trust, 100% = full
const blend: NodeSpec<BlendState> = {
  type: "vision.blend", title: "Blend Readings", category: "Vision",
  desc: "Mixes up to four detectors, square by square, each counted by its weight. The first connected reading is the anchor: a reading whose piece count is implausible next to it is thrown out. Amber squares are where the detectors disagree.",
  inputs: IN.map((id, i) => ({ id, type: "reading" as const, label: `reading ${i + 1}` })), outputs: [{ id: "reading", type: "reading" }],
  params: [
    { id: "w1", kind: "number", label: "Weight of reading 1 (anchor)", min: 0, max: 2, step: 0.1, value: 0.4 },
    { id: "w2", kind: "number", label: "Weight of reading 2", min: 0, max: 2, step: 0.1, value: 0.6 },
    { id: "w3", kind: "number", label: "Weight of reading 3", min: 0, max: 2, step: 0.1, value: 0.6 },
    { id: "w4", kind: "number", label: "Weight of reading 4", min: 0, max: 2, step: 0.1, value: 0.6 },
    { id: "guard", kind: "bool", label: "Ignore implausible readings", value: true },
    { id: "adapt", kind: "bool", label: "Learn which detector to trust", value: true },
  ],
  previewSize: BASE,
  init: () => ({ res: null, inputs: [null, null, null, null], ms: 0, trust: [1, 1, 1, 1], eff: [0, 0, 0, 0] }),
  process(inputs, { params, state, setFidelity }) {
    state.inputs = IN.map((k) => (inputs[k] as Reading | null | undefined) ?? null);
    const t0 = performance.now();
    // A detector that keeps disagreeing with what the others agree on counts for less; one that agrees counts fully.
    // With only two detectors there is no way to tell which one is wrong, so the weights stay as set.
    const adapt = !!params.adapt;
    const eff = state.inputs.map((_, i) => Number(params[`w${i + 1}`]) * (adapt ? 0.2 + 0.8 * trustScale(state.trust[i]) : 1));
    state.eff = eff;
    state.res = blendReadings(state.inputs.map((reading, i) => ({ reading, weight: eff[i] })), !!params.guard);
    const res = state.res, used = state.inputs.map((_, i) => i).filter((i) => res.used[i]);
    if (adapt && used.length >= 3) for (const i of used) {
      const rest = blendReadings(used.filter((j) => j !== i).map((j) => ({ reading: state.inputs[j], weight: eff[j] })), false).reading;
      if (rest) state.trust[i] += 0.05 * (agreement(state.inputs[i]!, rest) - state.trust[i]);
    }
    state.ms = performance.now() - t0;
    const r = state.res.reading;
    setFidelity(r ? meanConf(r) * (1 - 0.5 * (Array.from(state.res.disagree).filter(Boolean).length / 64)) : null);
    return { reading: r };
  },
  preview(ctx, w, h, s) {
    withDetail(ctx, w, h, BASE, (pw, ph) => drawPresence(ctx, pw, ph, s.res?.reading, { rings: s.res?.disagree, note: "connect at least one detector" }), () => {
      const rows: DetailRow[] = [...counts(s.res?.reading)];
      s.inputs.forEach((r, i) => rows.push([`reading ${i + 1}`, !r ? "not connected" : s.res?.used[i] ? `${r.source}: ${pieceCount(r)} pieces, sure ${pct(meanConf(r))}, counts ${pct(s.eff[i] / (s.eff.reduce((a, b) => a + b, 0) || 1))}` : `left out: ${s.res?.why[i] || "not used"}`, !r ? undefined : s.res?.used[i] ? undefined : "#ffb347"]));
      const dis = s.res ? Array.from(s.res.disagree).filter(Boolean).length : 0;
      rows.push(["disagreeing squares", s.res ? String(dis) : "—"], ["detectors agree", s.res?.reading ? pct(1 - dis / 64) : "—"]);
      return rows;
    });
  },
  hover(p, w, h, s) {
    return squareHover(p, w, h, s.res?.reading, "Blend Readings", "Each connected detector votes with its weight, in log-odds, so none can switch a square on or off alone. An amber frame marks a square where the detectors that took part disagree.", (q) =>
      s.inputs.flatMap((r, i): TipRow[] => (r ? [{ label: `${r.source}`, value: `${r.occ[q] > 0.5 ? (r.white[q] > 0.5 ? "white" : "black") : "empty"} ${pct(squareConf(r, q))}${s.res?.used[i] ? "" : " (left out)"}`, tone: s.res?.used[i] ? undefined : "warn" }] : [])));
  },
};

// ---------------------------------------------------------------- Camera Reading
interface ObserveState { obs: SquareObs | null; reading: Reading | null }
const observe: NodeSpec<ObserveState> = {
  type: "vision.observe", title: "Camera Reading", category: "Vision",
  desc: "Packages one camera's final reading, with its picture quality, motion and hand squares, for Multi-Camera Fusion. Trust says how much this camera's vote counts.",
  inputs: [{ id: "reading", type: "reading" }], outputs: [{ id: "obs", type: "obs" }],
  params: [{ id: "weight", kind: "number", label: "Trust", min: 0, max: 2, step: 0.1, value: 1 }],
  previewSize: BASE,
  init: () => ({ obs: null, reading: null }),
  process({ reading }, { params, state, setFidelity }) {
    const r = reading as Reading | null | undefined;
    if (!r) { state.obs = null; state.reading = null; setFidelity(null); return { obs: null }; }
    const quality = r.quality ?? 0.8, motion = r.motion ?? 0;
    state.reading = r;
    state.obs = { cam: r.cam, t: r.t, quality, weight: Number(params.weight), occ: r.occ, white: r.white, motion, handSquares: r.handSquares ?? new Uint8Array(64) };
    setFidelity(quality * (1 - Math.min(1, motion * 4)));
    return { obs: state.obs };
  },
  preview(ctx, w, h, s) {
    withDetail(ctx, w, h, BASE, (pw, ph) => drawPresence(ctx, pw, ph, s.reading, { note: "no reading yet" }), () => [
      ["camera", s.obs?.cam ?? "—"], ...counts(s.reading), ["quality", s.obs ? brief(s.obs.quality) : "—"], ["motion", s.obs ? brief(s.obs.motion) : "—"], ["trust", s.obs ? brief(s.obs.weight) : "—"]]);
  },
  hover(p, w, h, s) { return squareHover(p, w, h, s.reading, "Camera Reading", "This camera's final answer, as it goes into Multi-Camera Fusion: where it sees a piece, and which colour."); },
};

export const pipelinePlugin: Plugin = { id: "pipeline", name: "Detection pipeline", register: (r) => { [clean, flatten, mask, brightness, neuralBoard, neuralSquares, neuralView, blend, observe].forEach((n) => r.register(n as NodeSpec)); } };
