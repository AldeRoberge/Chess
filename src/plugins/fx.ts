import { bus } from "../core/bus";
import type { ExperienceEvent } from "../core/events";
import type { NodeSpec, ParamValues, Plugin } from "../core/types";
import { EFFECTS } from "../fx/effects";
import { FxEngine, fxEngine } from "../fx/engine";
import { FxAudio, SOUNDS } from "../fx/sounds";
import { COLOR_NAMES, PIECE_VALUE, type FxCall, type FxCue } from "../fx/types";
import { sqIndex } from "../vision/types";
import { drawBoard } from "./shared";

/**
 * Board effects as a small event-driven node system:
 *   events -> Trigger (decides what counts) -> cues -> Effect / Sound nodes (decide how it looks and sounds)
 *   -> calls -> Projector (paints the table, plays the sound)
 * Effect and Sound nodes also take a "chain" input, so any number of them can be stacked onto one trigger.
 */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const WHEN = ["higher", "capture", "check", "mate", "castle", "promotion", "move"];
const WHEN_LABELS = ["Capture of higher value", "Any capture", "Check", "Checkmate", "Castling", "Promotion", "Every move"];
const EVENT_OF: Record<string, string> = { higher: "capture", capture: "capture", check: "check", mate: "mate", castle: "castle", promotion: "promotion", move: "move" };

/** Turns one game event into a cue, or null when it is not what the trigger is waiting for. */
export function cueFor(e: ExperienceEvent, when: string, minGap: number, id: number): FxCue | null {
  if (e.type !== (EVENT_OF[when] ?? "capture")) return null;
  const d = (e.data ?? {}) as { to?: string; piece?: string; captured?: string; color?: string; promotion?: string };
  if (!d.to || !/^[a-h][1-8]$/.test(d.to)) return null;
  const piece = d.piece ?? "", captured = d.captured ?? "";
  const gap = captured ? (PIECE_VALUE[captured] ?? 0) - (PIECE_VALUE[piece] ?? 0) : 0;
  if (when === "higher" && gap < Math.max(1, minGap)) return null;
  const cv = PIECE_VALUE[captured] ?? 0;
  const strength = e.type === "capture" ? clamp01(0.15 + (cv / 9) * 0.45 + (Math.max(0, gap) / 8) * 0.4)
    : e.type === "mate" ? 1 : e.type === "promotion" ? 0.75 : e.type === "check" ? 0.6 : e.type === "castle" ? 0.45 : 0.3;
  const i = sqIndex(d.to);
  return { id, kind: e.type, col: (i % 8) + 0.5, row: Math.floor(i / 8) + 0.5, piece, captured, gap, strength, side: d.color === "b" ? "b" : "w" };
}

interface TrigState { seq: number; last: number; seen: string[]; lastCue: FxCue | null }
const trigger: NodeSpec<TrigState> = {
  type: "fx.trigger", title: "Board FX Trigger", category: "Effects",
  desc: "Watches the game and sends a cue when something worth celebrating happens, such as taking a more valuable piece. Wire it to Effect and Sound nodes.",
  inputs: [{ id: "events", type: "event" }, { id: "events2", type: "event" }],
  outputs: [{ id: "cues", type: "fx" }],
  params: [
    { id: "when", kind: "select", label: "Fire on", options: WHEN, labels: WHEN_LABELS, value: "higher" },
    { id: "minGap", kind: "number", label: "Min. value won", min: 1, max: 8, step: 1, value: 1 },
    { id: "cooldown", kind: "number", label: "Cooldown (s)", min: 0, max: 5, step: 0.1, value: 0 },
    { id: "test", kind: "bool", label: "Fire a test cue", value: false, action: true },
  ],
  init: () => ({ seq: 1, last: -1e9, seen: [], lastCue: null }),
  process(i, { params, state, now }) {
    const cues: FxCue[] = [];
    const evs = [...(i.events ?? []), ...(i.events2 ?? [])] as ExperienceEvent[];
    for (const e of evs) {
      const d = (e.data ?? {}) as { from?: string; to?: string; ply?: number };
      const key = `${e.type}|${e.t}|${d.from}${d.to}|${d.ply}`;
      if (state.seen.includes(key)) continue;
      state.seen.push(key); if (state.seen.length > 12) state.seen.shift();
      if (now - state.last < Number(params.cooldown) * 1000) continue;
      const c = cueFor(e, String(params.when), Number(params.minGap), state.seq);
      if (!c) continue;
      state.seq++; state.last = now; cues.push(c);
    }
    if (params.test) {
      params.test = false;
      const k = Math.floor(Math.random() * 64);
      cues.push({ id: state.seq++, kind: "test", col: (k % 8) + 0.5, row: Math.floor(k / 8) + 0.5, piece: "p", captured: "q", gap: 8, strength: 1, side: "w" });
    }
    if (cues.length) state.lastCue = cues[cues.length - 1];
    return { cues };
  },
};

const effectIds = Object.keys(EFFECTS);
const visualCall = (cue: FxCue, id: string, p: ParamValues): FxCall => {
  const k = p.byValue ? 1 : 0, s = cue.strength;
  return {
    kind: "visual", id, cue, delay: Number(p.delay) || 0,
    opts: { color: String(p.color), reach: Number(p.size) * (k ? 0.6 + 0.8 * s : 1), intensity: Number(p.intensity) * (k ? 0.55 + 0.45 * s : 1), speed: Number(p.speed), count: Number(p.count) },
  };
};

interface EffState { demo: FxEngine; next: number; n: number; params: ParamValues }
const effect: NodeSpec<EffState> = {
  type: "fx.effect", title: "Board FX Effect", category: "Effects",
  desc: "A projected light effect on the table: ripples, shockwaves, sparks, lasers and more. Pick the look, color, size and speed. Chain several together.",
  inputs: [{ id: "cues", type: "fx", label: "Cues" }, { id: "chain", type: "fx", label: "Chain" }],
  outputs: [{ id: "calls", type: "fx", label: "Effects" }],
  params: [
    { id: "effect", kind: "select", label: "Effect", options: effectIds, labels: effectIds.map((k) => EFFECTS[k].label), value: "ripple" },
    { id: "color", kind: "select", label: "Color", options: COLOR_NAMES, labels: COLOR_NAMES.map((c) => (c === "auto" ? "Auto (by piece)" : c[0].toUpperCase() + c.slice(1))), value: "auto" },
    { id: "size", kind: "number", label: "Reach (squares)", min: 1, max: 14, step: 0.5, value: 6 },
    { id: "intensity", kind: "number", label: "Brightness", min: 0.1, max: 1.5, step: 0.05, value: 0.9 },
    { id: "speed", kind: "number", label: "Speed", min: 0.3, max: 3, step: 0.1, value: 1 },
    { id: "count", kind: "number", label: "Rings / particles", min: 1, max: 12, step: 1, value: 4 },
    { id: "delay", kind: "number", label: "Delay (s)", min: 0, max: 3, step: 0.05, value: 0 },
    { id: "byValue", kind: "bool", label: "Bigger for bigger captures", value: true },
  ],
  previewSize: [160, 160],
  init: () => ({ demo: new FxEngine(), next: 0, n: 1, params: {} }),
  process(i, { params, state }) {
    state.params = { ...params }; // the preview loops a demo with these settings
    const calls: FxCall[] = [...((i.chain as FxCall[] | undefined) ?? [])];
    for (const cue of (i.cues as FxCue[] | undefined) ?? []) calls.push(visualCall(cue, String(params.effect), params));
    return { calls };
  },
  preview(ctx, w, h, s) {
    const now = performance.now(), px = Math.min(w, h) / 8, id = String(s.params.effect ?? "ripple");
    if (now > s.next && EFFECTS[id]) { // a looping demo on a small board, so tuning a knob shows its effect straight away
      s.next = now + (EFFECTS[id].duration / (Number(s.params.speed) || 1)) * 1000 + 500;
      s.demo.spawn(visualCall({ id: s.n++, kind: "test", col: 4, row: 4, piece: "p", captured: "q", gap: 8, strength: 0.8, side: "w" }, id, s.params), now);
    }
    ctx.fillStyle = "#0a0e17"; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(120,140,180,.14)"; ctx.lineWidth = 1;
    for (let k = 0; k <= 8; k++) { ctx.beginPath(); ctx.moveTo(k * px, 0); ctx.lineTo(k * px, 8 * px); ctx.moveTo(0, k * px); ctx.lineTo(8 * px, k * px); ctx.stroke(); }
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip(); s.demo.draw(ctx, px, now); ctx.restore();
  },
};

const soundIds = SOUNDS.map((s) => s.id);
const sound: NodeSpec<{ audio: FxAudio }> = {
  type: "fx.sound", title: "Board FX Sound", category: "Effects",
  desc: "A synthesised sound that plays with the effects. Bigger captures can sound higher. Chain several for layered sound.",
  inputs: [{ id: "cues", type: "fx", label: "Cues" }, { id: "chain", type: "fx", label: "Chain" }],
  outputs: [{ id: "calls", type: "fx", label: "Sounds" }],
  params: [
    { id: "sound", kind: "select", label: "Sound", options: soundIds, labels: SOUNDS.map((s) => s.label), value: "ripple" },
    { id: "volume", kind: "number", label: "Volume", min: 0, max: 1, step: 0.05, value: 0.7 },
    { id: "pitch", kind: "number", label: "Pitch (semitones)", min: -12, max: 12, step: 1, value: 0 },
    { id: "byValue", kind: "bool", label: "Higher pitch for bigger captures", value: true },
    { id: "delay", kind: "number", label: "Delay (s)", min: 0, max: 3, step: 0.05, value: 0 },
    { id: "test", kind: "bool", label: "Play it now", value: false, action: true },
  ],
  init: () => ({ audio: new FxAudio() }),
  process(i, { params, state }) {
    const calls: FxCall[] = [...((i.chain as FxCall[] | undefined) ?? [])];
    for (const cue of (i.cues as FxCue[] | undefined) ?? []) {
      calls.push({ kind: "sound", id: String(params.sound), cue, delay: Number(params.delay) || 0, opts: { volume: Number(params.volume), pitch: Number(params.pitch) + (params.byValue ? Math.round(cue.strength * 7) : 0) } });
    }
    if (params.test) { params.test = false; state.audio.start(); state.audio.play(String(params.sound), { volume: Number(params.volume), pitch: Number(params.pitch), strength: 0.8 }); }
    return { calls };
  },
};

interface OutState { audio: FxAudio; spawned: number }
const projector: NodeSpec<OutState> = {
  type: "fx.output", title: "Board FX Projector", category: "Output",
  desc: "Projects the effects onto the table and plays their sound. The 3D view and every projector window show the same light.",
  inputs: [{ id: "calls", type: "fx", label: "Effects" }, { id: "calls2", type: "fx", label: "More" }],
  outputs: [],
  params: [
    { id: "project", kind: "bool", label: "Project on table", value: true },
    { id: "sound", kind: "bool", label: "Play sounds", value: true },
  ],
  previewSize: [160, 160],
  init: () => ({ audio: new FxAudio(), spawned: 0 }),
  process(i, { params, state, now }) {
    for (const c of [...((i.calls as FxCall[] | undefined) ?? []), ...((i.calls2 as FxCall[] | undefined) ?? [])]) {
      if (c.kind === "visual") {
        if (!params.project) continue;
        fxEngine.spawn(c, now); state.spawned++;
        bus.fxSpawns.push(c); if (bus.fxSpawns.length > 40) bus.fxSpawns.shift();
      } else if (params.sound) {
        state.audio.play(c.id, { volume: Number(c.opts.volume), pitch: Number(c.opts.pitch), strength: c.cue.strength, delay: c.delay });
      }
    }
  },
  preview(ctx, w, h) {
    const s = Math.min(w, h), px = s / 8;
    drawBoard(ctx, w, h, null, { fen: bus.game?.fen });
    ctx.fillStyle = "rgba(4,6,12,.55)"; ctx.fillRect(0, 0, w, h);
    ctx.save(); ctx.translate((w - s) / 2, 0); fxEngine.draw(ctx, px, performance.now()); ctx.restore();
  },
};

export const fxPlugin: Plugin = { id: "fx", name: "Board Effects", register: (r) => { r.register(trigger); r.register(effect); r.register(sound); r.register(projector); } };

/** Unlocks the Web Audio context of every effects projector (call from a user gesture). */
export const startFxAudio = (graph: { states: Map<string, any>; nodes: Map<string, any> }) => {
  for (const [id, n] of graph.nodes) if (n.type === "fx.output") (graph.states.get(id) as OutState).audio.start();
};
