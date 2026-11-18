import { Fusion } from "../vision/fusion";
import { BoardSampler, defaultSamplerConfig } from "../vision/sampler";
import { Stabilizer } from "../vision/stabilizer";
import type { BoardBelief, GrayFrame, SquareObs } from "../vision/types";
import type { NodeSpec, Plugin } from "../core/types";
import { bus } from "../core/bus";
import { brief, CAM_PRESETS, drawBoard, drawFrame, fmtCorners, parseCorners, withDetail, type DetailRow } from "./shared";

interface ReaderState { sampler: BoardSampler; frame: GrayFrame | null; obs: SquareObs | null; corners: string; autoDone: boolean; lastT: number }
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

interface FuseState { fusion: Fusion; board: BoardBelief | null }
const fuse: NodeSpec<FuseState> = {
  type: "vision.fuse", title: "Multi-Camera Fusion", category: "Vision",
  inputs: ["o1", "o2", "o3", "o4"].map((id, i) => ({ id, type: "obs" as const, label: `cam ${i + 1}` })), outputs: [{ id: "board", type: "board" }],
  params: [{ id: "staleMs", kind: "number", label: "Drop feed after (ms)", min: 100, max: 3000, step: 50, value: 600 }, { id: "handMotion", kind: "number", label: "Hand motion gate", min: 0.02, max: 0.4, step: 0.01, value: 0.08 }],
  previewSize: [120, 120],
  init: () => ({ fusion: new Fusion(), board: null }),
  process(inputs, { now, params, state, setFidelity, span }) {
    const obs = (["o1", "o2", "o3", "o4"].map((k) => inputs[k]).filter(Boolean)) as SquareObs[];
    // timestamp with graph time: cameras that stop producing frames age out and drop from the vote
    const live = obs.map((o) => ({ ...o, t: o.t || now }));
    state.board = span("fuse", () => state.fusion.fuse(live, now, Number(params.staleMs), Number(params.handMotion)));
    bus.cameras = live.map((o) => ({ id: o.cam, online: true, quality: o.quality, reliability: state.fusion.reliability.get(o.cam) ?? 0.8 }));
    setFidelity(state.board.fidelity);
    return { board: state.board };
  },
  preview: (ctx, w, h, s) => withDetail(ctx, w, h, [120, 120], (pw, ph) => drawBoard(ctx, pw, ph, s.board, { fen: bus.game?.fen }), () => [
    ["cameras", String(s.board?.cams ?? 0)], ["fidelity", s.board ? brief(s.board.fidelity) : "—"], ["hand over", brief(s.board?.handOver)], ["settled", brief(s.board?.settled)],
    ["pieces seen", s.board ? String(Array.from(s.board.occ).filter((v) => v > 0.5).length) : "—"],
    ...(bus.cameras ?? []).map((c): DetailRow => [`cam ${c.id}`, `q ${brief(c.quality)} · rel ${brief(c.reliability)}`])]),
};

interface StabState { stab: Stabilizer; out: BoardBelief | null }
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
  init: () => ({ stab: new Stabilizer(), out: null }),
  process({ board }, { params, state, setFidelity, span }) {
    if (!board) return { board: null };
    const c = state.stab.cfg;
    c.decay = Number(params.memory); c.on = Number(params.hysteresis); c.off = -Number(params.hysteresis); c.settleMs = Number(params.settleMs); c.holdOnHand = !!params.holdOnHand;
    state.out = span("stabilize step", () => state.stab.step(board));
    bus.board = state.out;
    setFidelity(state.out.fidelity);
    return { board: state.out };
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
