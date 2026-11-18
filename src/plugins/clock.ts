import { bus, pushLog } from "../core/bus";
import type { ExperienceEvent } from "../core/events";
import type { NodeSpec, Plugin } from "../core/types";
import { ClockModel, parseControl } from "../clock/model";
import { fmtClock, type ClockEstimate, type Side } from "../clock/types";
import { readClock, type ClockKind, type ClockRead } from "../vision/clockReader";
import type { GrayFrame, Pt } from "../vision/types";
import { brief, drawFrame, fmtCorners, parseCorners, withDetail, type DetailRow } from "./shared";

const rect = (x: number, y: number, w: number, h: number): Pt[] => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const SIDES: Side[] = ["w", "b"];

interface ClockState {
  model: ClockModel; control: string; frame: GrayFrame | null; lastT: number; lastPly: number; started: boolean;
  reads: Record<Side, ClockRead | null>; est: ClockEstimate | null;
  low: Record<Side, number>; /** 0 none, 1 below low-time line, 2 below critical line */
  lostFired: boolean; flagFired: boolean; quads: Record<Side, Pt[] | null>; quadKey: Record<Side, string>;
}

const reader: NodeSpec<ClockState> = {
  type: "clock.reader", title: "Chess Clock", category: "Vision",
  desc: "Time left on each side. Reads the clock from the camera (LCD, phone app or analog dial) and, where it can't, estimates it from real time and the moves. Every estimate carries a certainty.",
  inputs: [{ id: "frame", type: "frame" }, { id: "game", type: "game" }],
  outputs: [{ id: "clock", type: "clock" }, { id: "events", type: "event" }],
  params: [
    { id: "kind", kind: "select", label: "Clock type", options: ["manual", "lcd", "phone", "analog"], value: "manual" },
    { id: "control", kind: "text", label: "Time control", value: "10+0" },
    { id: "whiteBox", kind: "text", label: "White display", value: fmtCorners(rect(20, 20, 130, 44)), quad: { names: ["tl", "tr", "br", "bl"], grid: 1 } },
    { id: "blackBox", kind: "text", label: "Black display", value: fmtCorners(rect(170, 20, 130, 44)), quad: { names: ["tl", "tr", "br", "bl"], grid: 1 } },
    { id: "flagHour", kind: "number", label: "Flag position", min: 1, max: 12, step: 1, value: 12 },
    { id: "lowSec", kind: "number", label: "Low time (s)", min: 5, max: 600, step: 5, value: 60 },
    { id: "critSec", kind: "number", label: "Critical time (s)", min: 3, max: 120, step: 1, value: 15 },
    { id: "minConf", kind: "number", label: "Min certainty", min: 0.1, max: 0.95, step: 0.05, value: 0.5 },
    { id: "start", kind: "bool", label: "Start white's clock now", value: false, action: true },
    { id: "reset", kind: "bool", label: "Reset clocks", value: false, action: true },
  ],
  previewSize: [160, 100],
  frameOf: (s) => s.frame,
  init: () => ({ model: new ClockModel(), control: "", frame: null, lastT: -1, lastPly: 0, started: false, reads: { w: null, b: null }, est: null, low: { w: 0, b: 0 }, lostFired: false, flagFired: false, quads: { w: null, b: null }, quadKey: { w: "", b: "" } }),
  process({ frame, game }, { now, params, state: s, setFidelity, span }) {
    const m = s.model, events: ExperienceEvent[] = [];
    const ctl = String(params.control);
    if (ctl !== s.control) { s.control = ctl; m.reset(now, parseControl(ctl)); s.started = false; s.lastPly = 0; s.low = { w: 0, b: 0 }; s.flagFired = false; }
    if (params.reset) { m.reset(now); s.started = false; s.lastPly = 0; s.low = { w: 0, b: 0 }; s.flagFired = s.lostFired = false; params.reset = false; }
    if (params.start && !s.started) { m.start(now); s.started = true; }
    params.start = false;
    const ev = (type: string, side: Side, extra: Record<string, unknown> = {}) => { const e = s.est!; const c = side === "w" ? e.white : e.black; events.push({ type, t: now, data: { side, ms: c.ms, conf: c.conf, src: c.src, ...extra } }); };

    // moves from the game tracker press the clock. A rewound game (fewer moves than before) restarts it.
    const ply = (game as { ply?: number } | undefined)?.ply ?? 0;
    if (ply < s.lastPly) { m.reset(now); s.started = false; s.low = { w: 0, b: 0 }; s.flagFired = false; }
    if (ply > s.lastPly) {
      const mover: Side = ply % 2 === 1 ? "w" : "b";
      if (ply - s.lastPly > 1) m.advance(now); // missed moves: the model just gets less certain
      m.press(mover, now); s.started = true; s.est = m.estimate(now); ev("clock-press", mover);
    }
    s.lastPly = ply;

    // camera readings, one per camera frame
    const kind = String(params.kind) as "manual" | ClockKind;
    s.frame = frame ?? null;
    if (kind !== "manual" && frame && frame.t !== s.lastT) {
      s.lastT = frame.t;
      for (const side of SIDES) {
        const key = String(side === "w" ? params.whiteBox : params.blackBox);
        if (key !== s.quadKey[side]) { s.quadKey[side] = key; s.quads[side] = parseCorners(key); }
        const q = s.quads[side];
        if (!q) { s.reads[side] = null; continue; }
        const r = span(`read clock ${side}`, () => readClock(kind, frame, q, Number(params.flagHour)));
        s.reads[side] = r;
        if (r.ms !== null && r.conf >= 0.2) { m.observe(side, { ms: r.ms, conf: r.conf, sigmaMs: r.sigmaMs }, now); s.lostFired = false; }
      }
    }

    s.est = m.estimate(now);
    const e = s.est, minConf = Number(params.minConf), lowMs = Number(params.lowSec) * 1000, critMs = Number(params.critSec) * 1000;
    for (const side of SIDES) {
      const c = side === "w" ? e.white : e.black, level = c.ms <= critMs ? 2 : c.ms <= lowMs ? 1 : 0;
      if (c.conf >= minConf && c.ms > 0 && level > s.low[side]) ev(level === 2 ? "clock-critical" : "clock-low", side);
      if (c.conf >= minConf || level === 0) s.low[side] = Math.max(level === 0 ? 0 : s.low[side], c.conf >= minConf ? level : 0);
    }
    if (e.flagged && !s.flagFired) { s.flagFired = true; ev("clock-flag", e.flagged); } else if (!e.flagged) s.flagFired = false;
    if (kind !== "manual" && e.lastRead !== null && now - e.lastRead > 20000 && !s.lostFired) { s.lostFired = true; ev("clock-lost", e.running ?? "w"); } // camera lost the display: we are on estimates

    bus.clock = e;
    if (events.length) pushLog(bus.events, events);
    setFidelity(Math.min(e.white.conf, e.black.conf));
    return { clock: e, events };
  },
  preview(ctx, w, h, s) {
    withDetail(ctx, w, h, [160, 100], (pw, ph) => {
      drawFrame(ctx, pw, ph, s.frame, "manual clock");
      ctx.fillStyle = "rgba(5,10,20,.72)"; ctx.fillRect(0, 0, pw, ph);
      if (s.frame) for (const side of SIDES) { const q = s.quads[side]; if (!q) continue; ctx.strokeStyle = side === "w" ? "#ffd35a" : "#7fd4ff"; ctx.beginPath(); q.forEach((p, i) => { const x = (p.x / s.frame!.width) * pw, y = (p.y / s.frame!.height) * ph; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); ctx.stroke(); }
      const e = s.est; if (!e) return;
      ctx.textBaseline = "middle"; ctx.textAlign = "center";
      SIDES.forEach((side, i) => {
        const c = side === "w" ? e.white : e.black, x = pw * (0.25 + 0.5 * i);
        ctx.fillStyle = e.running === side ? "#fff" : "#8aa6c4"; ctx.font = `600 ${Math.round(pw / 9)}px "IBM Plex Mono",ui-monospace,monospace`; ctx.fillText(`${c.conf < 0.4 ? "?" : c.conf < 0.7 ? "~" : ""}${fmtClock(c.ms)}`, x, ph * 0.4);
        ctx.fillStyle = "#1f3a5a"; ctx.fillRect(x - pw * 0.2, ph * 0.66, pw * 0.4, 5);
        ctx.fillStyle = c.conf > 0.7 ? "#62e3a4" : c.conf > 0.4 ? "#f2b84b" : "#ff8585"; ctx.fillRect(x - pw * 0.2, ph * 0.66, pw * 0.4 * c.conf, 5);
        ctx.fillStyle = "#bdd1e8"; ctx.font = `${Math.round(pw / 14)}px "IBM Plex Mono",ui-monospace,monospace`; ctx.fillText(`${Math.round(c.conf * 100)}% · ${c.src}`, x, ph * 0.85);
      });
    }, (): DetailRow[] => {
      const e = s.est; if (!e) return [["state", "no estimate yet"]];
      const row = (n: string, c: ClockEstimate["white"]): DetailRow => [n, `${fmtClock(c.ms)}  ±${brief(c.sigmaMs / 1000)}s  ${Math.round(c.conf * 100)}%  (${c.src})`, c.conf > 0.7 ? "#62e3a4" : c.conf > 0.4 ? "#f2b84b" : "#ff8585"];
      return [row("white", e.white), row("black", e.black), ["running", e.running === "w" ? "white" : e.running === "b" ? "black" : "none"], ["control", `${brief(e.control.baseMs / 60000)} min +${brief(e.control.incMs / 1000)}s ${e.control.mode}`],
        ["last read", e.lastRead === null ? "never" : `${brief((e.t - e.lastRead) / 1000)}s ago`], ["flagged", e.flagged ?? "no"],
        ...SIDES.map((side): DetailRow => [`read ${side === "w" ? "white" : "black"}`, s.reads[side]?.text ? `${s.reads[side]!.text} (${Math.round(s.reads[side]!.conf * 100)}%)` : "—"])];
    });
  },
};

interface OverlayState { shown: boolean }
const overlay: NodeSpec<OverlayState> = {
  type: "clock.overlay", title: "Clock Projection", category: "Output",
  desc: "Projects the time left onto the table: digits, a depleting circle, or a square outline around the board. Uncertain estimates are drawn dashed and faded.",
  inputs: [{ id: "clock", type: "clock" }], outputs: [],
  params: [
    { id: "mode", kind: "select", label: "Show as", options: ["digits", "circle", "square", "off"], value: "digits" },
    { id: "showCert", kind: "bool", label: "Show certainty", value: true },
  ],
  init: () => ({ shown: false }),
  process({ clock }, { params, state, setFidelity }) {
    const mode = String(params.mode);
    if (!clock || mode === "off") { bus.clockView = null; state.shown = false; setFidelity(null); return; }
    bus.clockView = { mode: mode as "digits", showCert: !!params.showCert, clock: clock as ClockEstimate };
    state.shown = true;
    setFidelity(Math.min((clock as ClockEstimate).white.conf, (clock as ClockEstimate).black.conf));
  },
  dispose() { bus.clockView = null; },
};

export const clockPlugin: Plugin = { id: "clock", name: "Chess Clock", register: (r) => { r.register(reader); r.register(overlay); } };
