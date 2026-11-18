import { Fusion } from "../vision/fusion";
import { BoardSampler, defaultSamplerConfig } from "../vision/sampler";
import { Stabilizer } from "../vision/stabilizer";
import type { BoardBelief, GrayFrame, SquareObs } from "../vision/types";
import type { NodeSpec, Plugin } from "../core/types";
import { bus } from "../core/bus";
import { applyH, boardToImage, invertH } from "../vision/homography";
import { sqName } from "../vision/types";
import { brief, CAM_PRESETS, drawBoard, drawFrame, fmtCorners, parseCorners, withDetail, type DetailRow } from "./shared";
import { boardHover, cropFrame, framePixel, isLightSquare, markPixel, pct, tone, visualSize } from "./hover";
import type { TipRow } from "../ui/tooltip";

interface ReaderState { sampler: BoardSampler; frame: GrayFrame | null; obs: SquareObs | null; corners: string; autoDone: boolean; lastT: number }
/** Board square (0 = a8) under an image pixel for these corners, or null when the pixel is off the board. */
function squareAtPixel(corners: { x: number; y: number }[], x: number, y: number): number | null {
  const q = applyH(invertH(boardToImage(corners)), x, y);
  const c = Math.floor(q.x), r = Math.floor(q.y);
  return q.x >= 0 && q.y >= 0 && c < 8 && r < 8 ? r * 8 + c : null;
}

const reader: NodeSpec<ReaderState> = {
  type: "vision.boardReader", title: "Board Reader", category: "Vision",
  inputs: [{ id: "frame", type: "frame" }], outputs: [{ id: "obs", type: "obs" }],
  params: [
    { id: "cam", kind: "text", label: "Camera id", value: "A" },
    { id: "corners", kind: "text", label: "Board corners", value: fmtCorners(CAM_PRESETS.A), quad: { names: ["a8", "h8", "h1", "a1"], grid: 8 } },
    { id: "threshold", kind: "number", label: "Piece sensitivity", min: 0.1, max: 0.6, step: 0.01, value: 0.22 },
    { id: "weight", kind: "number", label: "Trust", min: 0, max: 2, step: 0.1, value: 1 },
    { id: "autoCal", kind: "bool", label: "Auto-learn at start position", value: true },
    { id: "learn", kind: "bool", label: "Learn now", value: false, action: true },
  ],
  previewSize: [160, 120],
  frameOf: (s) => s.frame,
  init: () => ({ sampler: new BoardSampler("A", defaultSamplerConfig()), frame: null, obs: null, corners: "", autoDone: false, lastT: -1 }),
  process({ frame }, { params, state, setFidelity, span }) {
    const s = state.sampler;
    s.cam = String(params.cam);
    if (state.corners !== params.corners) { const c = parseCorners(String(params.corners)); if (c) { s.cfg.corners = c; state.corners = String(params.corners); } }
    s.cfg.threshold = Number(params.threshold);
    state.frame = frame ?? null;
    if (!frame) { state.obs = null; setFidelity(null); return { obs: null }; }
    if (params.learn || (params.autoCal && !state.autoDone && !s.calibrated)) { span("calibrateFromStart", () => s.calibrateFromStart(frame)); state.autoDone = true; params.learn = false; }
    if (frame.t !== state.lastT || !state.obs) { state.lastT = frame.t; state.obs = span("sample board (read)", () => s.read(frame, Number(params.weight))); } // one read per camera frame
    setFidelity(state.obs.quality * (1 - Math.min(1, state.obs.motion * 4)));
    return { obs: state.obs };
  },
  hover(p, w, h, s) {
    const v = visualSize(w, h, [160, 120]), f = s.frame;
    if (p.x > v.w || p.y > v.h) return null;
    if (!f) return { title: "No camera picture", tag: "Board Reader", body: "Wire a camera into this node: it reads the 64 squares from the picture.", rows: [{ label: "Calibrated", value: s.sampler.calibrated ? "yes" : "no", tone: s.sampler.calibrated ? "ok" : "warn" }] };
    const { r, x, y, inside } = framePixel(f, p, v.w, v.h);
    if (!inside) return null;
    const cfg = s.sampler.cfg, lum = f.data[Math.floor(y) * f.width + Math.floor(x)];
    const sq = squareAtPixel(cfg.corners, x, y), o = s.obs;
    const rows: TipRow[] = [{ label: "Pixel", value: `${Math.floor(x)}, ${Math.floor(y)}` }, { label: "Brightness", value: `${lum} / 255`, bar: lum / 255 }];
    const H = boardToImage(cfg.corners);
    const at = (u: number, vv: number) => { const q = applyH(H, u, vv); return { x: r.x + q.x * r.s, y: r.y + q.y * r.s }; };
    if (sq === null) {
      rows.push({ label: "Board", value: "outside the corners", tone: "warn" });
      return { title: `pixel ${Math.floor(x)}, ${Math.floor(y)}`, tag: "off the board", color: "#9fb8ff", body: "This part of the picture is outside the four corners, so it is ignored.", rows, preview: { frame: cropFrame(f, x, y) }, mark: (ctx) => markPixel(ctx, r, x, y) };
    }
    const m = s.sampler.measure(f)[sq], ref = s.sampler.ref[sq], thr = ref * cfg.threshold, d = m - ref;
    rows.unshift({ label: "Square", value: `${sqName(sq)} (${isLightSquare(sq) ? "light" : "dark"})` });
    if (s.sampler.calibrated && !Number.isNaN(m)) {
      rows.push({ label: "Square brightness", value: `${Math.round(m)} vs ${Math.round(ref)} when empty` });
      rows.push({ label: "Change", value: `${d >= 0 ? "+" : ""}${Math.round(d)} (needs ±${Math.round(thr)})`, bar: Math.min(1, Math.abs(d) / (thr * 2 || 1)), tone: Math.abs(d) > thr ? "ok" : "warn" });
    } else rows.push({ label: "Reference", value: "not learned yet", tone: "warn" });
    if (o) {
      const occ = o.occ[sq], white = o.white[sq];
      rows.push({ label: "Says occupied", value: pct(occ), bar: occ, tone: tone(Math.abs(occ * 2 - 1)) });
      if (occ > 0.5) rows.push({ label: "Piece colour", value: `${white > 0.5 ? "white" : "black"} ${pct(white > 0.5 ? white : 1 - white)}`, bar: white > 0.5 ? white : 1 - white });
      rows.push({ label: "Hand / motion here", value: o.handSquares[sq] ? "yes, anomaly" : "no", tone: o.handSquares[sq] ? "bad" : "ok" });
      rows.push({ label: "Camera quality", value: pct(o.quality), bar: o.quality, tone: tone(o.quality) });
    }
    return {
      title: sqName(sq), tag: `Board Reader · cam ${s.sampler.cam}`, color: "#35e0b4",
      body: `This node averages the ${cfg.grid * cfg.grid} dots in the middle of the square (${pct(cfg.patch)} of its width), compares them with how bright the empty square was, and turns the change into a probability.`,
      rows, preview: { frame: cropFrame(f, x, y) },
      mark: (ctx) => {
        const c = sq % 8, rr = Math.floor(sq / 8), q = [at(c, rr), at(c + 1, rr), at(c + 1, rr + 1), at(c, rr + 1)];
        ctx.save();
        ctx.fillStyle = "rgba(255,228,92,.22)"; ctx.strokeStyle = "#ffe45c"; ctx.lineWidth = 1.5;
        ctx.beginPath(); q.forEach((t, i) => (i ? ctx.lineTo(t.x, t.y) : ctx.moveTo(t.x, t.y))); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#fff";
        for (let j = 0; j < cfg.grid; j++) for (let i = 0; i < cfg.grid; i++) { const t = at(c + 0.5 + ((i + 0.5) / cfg.grid - 0.5) * cfg.patch, rr + 0.5 + ((j + 0.5) / cfg.grid - 0.5) * cfg.patch); ctx.fillRect(t.x - 0.8, t.y - 0.8, 1.6, 1.6); }
        ctx.restore();
      },
    };
  },
  preview(ctx, w, h, s) {
    withDetail(ctx, w, h, [160, 120], (pw, ph) => {
      const r = drawFrame(ctx, pw, ph, s.frame);
      if (!s.frame || !r) return;
      const at = (p: { x: number; y: number }) => ({ x: r.x + p.x * r.s, y: r.y + p.y * r.s }), c = s.sampler.cfg.corners;
      ctx.strokeStyle = "#35e0b4"; ctx.beginPath(); c.forEach((p, i) => { const q = at(p); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); }); ctx.closePath(); ctx.stroke();
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
  params: [{ id: "staleMs", kind: "number", label: "Drop feed after (ms)", min: 100, max: 3000, step: 50, value: 600 }, { id: "handMotion", kind: "number", label: "Hand motion gate", min: 0.02, max: 0.4, step: 0.01, value: 0.08 }],
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
  preview: (ctx, w, h, s) => withDetail(ctx, w, h, [120, 120], (pw, ph) => drawBoard(ctx, pw, ph, s.board, { fen: bus.game?.fen }), () => [
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
      drawBoard(ctx, pw, ph, s.out, { fen: bus.game?.fen });
      if (s.out) { ctx.fillStyle = s.out.handOver ? "#ff5a6e" : s.out.settled ? "#35e0b4" : "#ffb347"; ctx.fillRect(pw - 10, 2, 8, 8); }
    }, () => [["state", s.out ? (s.out.handOver ? "hand over board" : s.out.settled ? "settled" : "settling") : "no input", s.out?.handOver ? "#ff5a6e" : s.out?.settled ? "#35e0b4" : "#ffb347"],
      ["fidelity", s.out ? brief(s.out.fidelity) : "—"], ["pieces", s.out ? String(Array.from(s.out.occ).filter((v) => v > 0.5).length) : "—"],
      ["low confidence", s.out ? String(Array.from(s.out.conf).filter((v) => v < 0.5).length) : "—"], ["cameras", String(s.out?.cams ?? 0)]]);
  },
};

export const visionPlugin: Plugin = { id: "vision", name: "Vision", register: (r) => { r.register(reader); r.register(fuse); r.register(stabilize); } };
