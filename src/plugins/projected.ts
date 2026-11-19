import { bus, pushLog } from "../core/bus";
import type { ExperienceEvent } from "../core/events";
import type { NodeSpec, Plugin } from "../core/types";
import { PositionTracker, type TrackResult } from "../chess/tracker";
import { clearSavedGame, newGameGeneration } from "../chess/savedGame";
import { persistGame, resumeSaved } from "./game";
import type { DirectorOut, PointerSample } from "../experience/director";
import { DragDrop, type DragState } from "../experience/dragdrop";
import { virtualTable } from "../sim/virtualTable";
import { cameraMatrix, triangulate, type ProjMat } from "../vision/triangulate";
import type { GrayFrame, Pt } from "../vision/types";
import { TABLE_Y, worldToBoard } from "../world/coords";
import { parseCam } from "./tracking";

/* ───────── Hands (fingertips → 3D) ───────── */

const HAND_MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task";
const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm";
const INDEX_TIP = 8, THUMB_TIP = 4;
/** A camera's last fingertip reading counts for this long (ms); after that it is a stale view and is ignored. */
const FRESH_MS = 500;

export interface Tips { index: Pt; thumb: Pt; t: number }
interface HandsState { lm: any; loading: boolean; canvas: HTMLCanvasElement | null; last: number; rr: number; tips: (Tips | null)[]; pointers: PointerSample[]; err: string; failedAt: number }

/** Fingertip positions from 2+ calibrated cameras: pixels in each view → one 3D point → board coordinates, height and pinch. */
export function triangulateHand(mats: (ProjMat | null)[], tips: (Tips | null)[], now: number): PointerSample | null {
  const Ps: ProjMat[] = [], idx: Pt[] = [], th: Pt[] = [];
  tips.forEach((t, k) => { if (t && mats[k] && now - t.t <= FRESH_MS) { Ps.push(mats[k]!); idx.push(t.index); th.push(t.thumb); } });
  if (Ps.length < 2) return null;
  const i = triangulate(Ps, idx), t = triangulate(Ps, th);
  if (!i) return null;
  return { id: "index", ...worldToBoard(i[0], i[2]), z: i[1] - TABLE_Y, ...(t ? { pinch: Math.hypot(i[0] - t[0], i[1] - t[1], i[2] - t[2]) } : {}) };
}

const hands: NodeSpec<HandsState> = {
  type: "tracking.hands", title: "Hands (Fingertips → 3D)", category: "Tracking",
  desc: "Finds the index fingertip and thumb of one hand in each camera and triangulates them: where the fingertip is on the table, how high above it, and how far apart finger and thumb are.",
  inputs: [{ id: "f1", type: "frame" }, { id: "f2", type: "frame" }, { id: "f3", type: "frame" }],
  outputs: [{ id: "pointers", type: "pointer" }],
  params: [
    { id: "enabled", kind: "bool", label: "Run hand model", value: false },
    { id: "cam1", kind: "text", label: "Camera 1 placement", value: "-1.6,2.2,1.6;0,0.75,0;60" },
    { id: "cam2", kind: "text", label: "Camera 2 placement", value: "1.6,2.2,1.6;0,0.75,0;60" },
    { id: "cam3", kind: "text", label: "Camera 3 placement", value: "0,2.3,-1.8;0,0.75,0;60" },
    { id: "fps", kind: "number", label: "Hand FPS", min: 1, max: 30, step: 1, value: 12 },
  ],
  init: () => ({ lm: null, loading: false, canvas: null, last: 0, rr: 0, tips: [null, null, null], pointers: [], err: "", failedAt: -1e9 }),
  process(inputs, { params, state, now, setFidelity, span }) {
    if (!params.enabled) { state.pointers = []; setFidelity(null); return { pointers: [] }; }
    if (!state.lm && !state.loading && now - state.failedAt > 30000) {
      state.loading = true;
      void (async () => {
        try {
          const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
          const fs = await FilesetResolver.forVisionTasks(WASM);
          state.lm = await HandLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: HAND_MODEL, delegate: "GPU" }, runningMode: "IMAGE", numHands: 1 });
        } catch (e) { state.err = String(e); state.loading = false; state.failedAt = now; }
      })();
    }
    const frames = [inputs.f1, inputs.f2, inputs.f3] as (GrayFrame | undefined)[];
    if (state.lm && now - state.last >= 1000 / Number(params.fps) / 3) {
      state.last = now;
      const k = state.rr++ % 3, f = frames[k];
      if (!f) state.tips[k] = null;
      else {
        const c = (state.canvas ??= document.createElement("canvas"));
        c.width = f.width; c.height = f.height;
        const ctx = c.getContext("2d")!;
        span("upload frame", () => {
          const img = ctx.createImageData(f.width, f.height);
          for (let i = 0; i < f.data.length; i++) img.data.fill(f.data[i], i * 4, i * 4 + 3), (img.data[i * 4 + 3] = 255);
          ctx.putImageData(img, 0, 0);
        });
        const r = span("hand detect (MediaPipe)", () => state.lm.detect(c));
        const lm = r.landmarks?.[0];
        state.tips[k] = lm ? { index: { x: lm[INDEX_TIP].x * f.width, y: lm[INDEX_TIP].y * f.height }, thumb: { x: lm[THUMB_TIP].x * f.width, y: lm[THUMB_TIP].y * f.height }, t: now } : null;
      }
    }
    const mats: (ProjMat | null)[] = ["cam1", "cam2", "cam3"].map((n) => { const c = parseCam(String(params[n])); return c ? cameraMatrix(c[0], c[1], c[2], 480, 360) : null; });
    const p = span("triangulate fingertip", () => triangulateHand(mats, state.tips, now));
    state.pointers = p ? [p] : [];
    setFidelity(p ? 1 : 0);
    return { pointers: state.pointers };
  },
  dispose: (s) => s.lm?.close?.(),
};

/* ───────── Touch detector ───────── */

interface TouchState { down: Map<string, boolean> }
const touch: NodeSpec<TouchState> = {
  type: "tracking.touch", title: "Touch Detector", category: "Tracking",
  desc: "Decides when a fingertip is touching the table: low enough (or pinching) to count as down, with a gap between touching and letting go so a shaky reading does not flicker.",
  inputs: [{ id: "pointers", type: "pointer" }, { id: "pointers2", type: "pointer", label: "pointers (2nd source)" }],
  outputs: [{ id: "pointers", type: "pointer" }],
  params: [
    { id: "touchMm", kind: "number", label: "Touch below (mm)", min: 2, max: 200, step: 1, value: 15 },
    { id: "releaseMm", kind: "number", label: "Let go above (mm)", min: 3, max: 250, step: 1, value: 30 },
    { id: "usePinch", kind: "bool", label: "Pinch also grabs", value: true },
    { id: "pinchMm", kind: "number", label: "Pinch closer than (mm)", min: 5, max: 80, step: 1, value: 25 },
    { id: "pinchReleaseMm", kind: "number", label: "Pinch opens past (mm)", min: 8, max: 120, step: 1, value: 40 },
  ],
  init: () => ({ down: new Map() }),
  process({ pointers, pointers2 }, { params, state, setFidelity }) {
    const out: PointerSample[] = [], seen = new Set<string>();
    const lo = Number(params.touchMm) / 1000, hi = Math.max(lo, Number(params.releaseMm) / 1000);
    const plo = Number(params.pinchMm) / 1000, phi = Math.max(plo, Number(params.pinchReleaseMm) / 1000);
    for (const p of [...((pointers as PointerSample[] | undefined) ?? []), ...((pointers2 as PointerSample[] | undefined) ?? [])]) {
      seen.add(p.id);
      const was = state.down.get(p.id) ?? false;
      let down: boolean;
      if (params.usePinch && p.pinch !== undefined) down = p.pinch < (was ? phi : plo);
      else if (p.z !== undefined) down = p.z < (was ? hi : lo);
      else down = !!p.down; // a source that already says (the mouse): pass it through
      state.down.set(p.id, down);
      out.push({ ...p, down });
    }
    for (const id of [...state.down.keys()]) if (!seen.has(id)) state.down.delete(id);
    setFidelity(null);
    return { pointers: out };
  },
};

/* ───────── Virtual position ───────── */

interface VirtState { tracker: PositionTracker; res: TrackResult | null; pending: { at: number; ev: ExperienceEvent }[]; prevPhase: string; gen: number; resumed: ExperienceEvent | null }
const virtual: NodeSpec<VirtState> = {
  type: "game.virtual", title: "Virtual Position", category: "Game",
  desc: "The game for a table with no pieces on it: it holds the position itself and moves only when told to, by a finger dropping a piece or by the engine. Illegal moves are refused.",
  inputs: [{ id: "drops", type: "event", label: "Finger moves" }, { id: "engine", type: "event", label: "Engine moves" }, { id: "director", type: "any" }, { id: "control", type: "event" }],
  outputs: [{ id: "game", type: "game" }, { id: "events", type: "event" }],
  params: [
    { id: "engineDelayMs", kind: "number", label: "Engine waits (ms)", min: 0, max: 5000, step: 100, value: 700 },
    { id: "resync", kind: "bool", label: "Reset to start position", value: false, action: true },
  ],
  previewSize: [140, 40],
  init: () => { const tracker = new PositionTracker(); return { tracker, res: null, pending: [], prevPhase: "idle", gen: newGameGeneration(), resumed: resumeSaved(tracker) }; },
  process({ drops, engine, director, control }, { params, state, now, setFidelity }) {
    const t = state.tracker, events: ExperienceEvent[] = [];
    const phase = (director as DirectorOut | undefined)?.phase ?? "idle";
    const restart = ((control as ExperienceEvent[] | undefined) ?? []).some((e) => e.type === "scenario-start");
    const fresh = restart || !!params.resync || state.gen !== newGameGeneration() || (phase === "idle" && state.prevPhase !== "idle");
    if (fresh) { t.reset(); state.pending = []; params.resync = false; clearSavedGame(); state.resumed = null; state.gen = newGameGeneration(); }
    state.prevPhase = phase;
    if (state.resumed) { events.push({ ...state.resumed, t: now }); state.resumed = null; } // a stored game was picked up: the director goes straight back into it
    let moved: TrackResult | null = null;
    const apply = (from: string, to: string, promotion: string | undefined) => {
      const r = t.play(from, to, promotion, now);
      if (r) { moved = r; events.push(...r.events); }
    };
    for (const e of (drops as ExperienceEvent[] | undefined) ?? []) if (e.type === "piece-drop" && e.data) apply(e.data.from, e.data.to, e.data.promotion);
    for (const e of (engine as ExperienceEvent[] | undefined) ?? []) if (e.type === "engine-move" && e.data) state.pending.push({ at: now + Number(params.engineDelayMs), ev: e });
    for (const p of state.pending.filter((q) => q.at <= now)) { const d = p.ev.data!; apply(d.from, d.to, typeof d.uci === "string" ? d.uci.slice(4) || undefined : undefined); }
    state.pending = state.pending.filter((q) => q.at > now);
    // a move is announced for one tick ("moved"); after that the position just stands ("synced")
    const res: TrackResult = moved ?? t.snapshot();
    state.res = res;
    bus.game = res; pushLog(bus.events, events);
    persistGame(res, director as DirectorOut | undefined);
    setFidelity(1);
    return { game: res, events };
  },
  preview(ctx, w, h, s) {
    ctx.fillStyle = "#04101c"; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#b9c6e4"; ctx.font = `500 12px "Chakra Petch",system-ui,sans-serif`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const r = s.res;
    ctx.fillText(`${r?.last?.san ?? "—"}   ply ${r?.ply ?? 0}   ${r ? (r.turn === "w" ? "white" : "black") + " to move" : ""}`, 6, h / 2 + 4);
  },
};

/* ───────── Drag & drop ───────── */

interface DragNodeState { dd: DragDrop; drag: DragState | null }
const dragDrop: NodeSpec<DragNodeState> = {
  type: "game.dragDrop", title: "Drag & Drop Pieces", category: "Game",
  desc: "Lets a fingertip pick up a piece, carry it and drop it. Touch a piece of the side to move, slide it to a square it can go to and lift your finger: that is the move. Anywhere else, it goes back.",
  inputs: [{ id: "game", type: "game" }, { id: "pointers", type: "pointer" }, { id: "director", type: "any" }],
  outputs: [{ id: "drag", type: "any" }, { id: "events", type: "event" }],
  params: [
    { id: "grabRadius", kind: "number", label: "Grab radius (squares)", min: 0.2, max: 0.75, step: 0.05, value: 0.6 },
    { id: "graceMs", kind: "number", label: "Keep hold through gaps (ms)", min: 0, max: 1000, step: 25, value: 250 },
    { id: "promotion", kind: "select", label: "Promote to", options: ["q", "r", "b", "n"], value: "q" },
  ],
  previewSize: [140, 40],
  init: () => ({ dd: new DragDrop(), drag: null }),
  process({ game, pointers, director }, { params, state, now, setFidelity }) {
    const c = state.dd.cfg;
    c.grabRadius = Number(params.grabRadius); c.graceMs = Number(params.graceMs); c.promotion = params.promotion as "q";
    const d = director as DirectorOut | undefined;
    const open = !d || d.phase === "game"; // no pieces to move during the intro, the menu or after the game
    const g = game as TrackResult | undefined;
    const r = state.dd.step(now, open && g ? g.fen : null, open ? ((pointers as PointerSample[] | undefined) ?? []) : []);
    state.drag = r.drag;
    pushLog(bus.events, r.events);
    setFidelity(null);
    return { drag: r.drag, events: r.events };
  },
  preview(ctx, w, h, s) {
    ctx.fillStyle = "#04101c"; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = s.drag ? "#ffd36b" : "#b9c6e4"; ctx.font = `500 12px "Chakra Petch",system-ui,sans-serif`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.fillText(s.drag ? `holding ${s.drag.from} → ${s.drag.hover ?? "off board"}` : "touch a piece to pick it up", 6, h / 2 + 4);
  },
};

/* ───────── Pieces projection ───────── */

const pieces: NodeSpec = {
  type: "projection.pieces", title: "Pieces projection", category: "Output",
  desc: "Paints the pieces onto the table with the projector, instead of there being real ones. The piece being dragged follows the fingertip, and the squares it can go to light up.",
  inputs: [{ id: "game", type: "game" }, { id: "drag", type: "any" }],
  outputs: [],
  params: [
    { id: "scale", kind: "number", label: "Piece size", min: 0.4, max: 1.1, step: 0.05, value: 0.85 },
    { id: "legalDots", kind: "bool", label: "Show where it can go", value: true },
    { id: "shadow", kind: "bool", label: "Shadows", value: true },
    { id: "rotate", kind: "bool", label: "Face the seated player", value: false },
  ],
  process({ game, drag }, { params }) {
    const g = game as TrackResult | undefined;
    if (!g) { bus.pieceView = null; virtualTable.piecesVisible = true; return; }
    bus.pieceView = { fen: g.fen, drag: (drag as DragState | null | undefined) ?? null, legalDots: !!params.legalDots, shadow: !!params.shadow, scale: Number(params.scale), rotate: !!params.rotate };
    virtualTable.piecesVisible = false; // the cameras and the 3D view see a bare board
  },
  dispose() { bus.pieceView = null; virtualTable.piecesVisible = true; },
};

export const projectedPlugin: Plugin = { id: "projected", name: "Projected pieces", register: (r) => { r.register(hands); r.register(touch); r.register(virtual); r.register(dragDrop); r.register(pieces); } };
