import { bus } from "../core/bus";
import type { ExperienceEvent } from "../core/events";
import type { NodeSpec, Plugin } from "../core/types";
import type { TipRow } from "../ui/tooltip";
import { AudioEngine } from "../scene/audio";
import { CueEngine, DEFAULT_RULES, type FiredAction } from "../scene/cues";
import { DmxSink } from "../scene/dmx";
import { SceneRenderer } from "../scene/renderer";
import { SCENES, type CueRule, type SceneId, type SceneState } from "../scene/types";
import { objRows, withDetail } from "./shared";
import { pct, visualSize } from "./hover";

interface CueState { cues: CueEngine; rulesJson: string; r: SceneRenderer; last: number; forced: string }
const cues: NodeSpec<CueState> = {
  type: "scene.cues", title: "Scene Cues", category: "Scene",
  inputs: [{ id: "events", type: "event" }, { id: "events2", type: "event" }, { id: "events3", type: "event" }, { id: "events4", type: "event" }],
  outputs: [{ id: "scene", type: "scene" }, { id: "fired", type: "any" }],
  params: [
    { id: "scene", kind: "select", label: "Force scene", options: ["(auto)", ...Object.keys(SCENES)], value: "(auto)" },
    { id: "hour", kind: "number", label: "Time of day", min: 0, max: 24, step: 0.5, value: -1 },
    { id: "rain", kind: "number", label: "Rain override", min: -1, max: 1, step: 0.05, value: -1 },
    { id: "snow", kind: "number", label: "Snow override", min: -1, max: 1, step: 0.05, value: -1 },
    { id: "thunder", kind: "bool", label: "Trigger thunder now", value: false, action: true },
    { id: "rules", kind: "text", label: "Scene rules", value: "" },
  ],
  previewSize: [200, 112],
  init: () => ({ cues: new CueEngine(), rulesJson: "", r: new SceneRenderer(), last: 0, forced: "(auto)" }),
  process(i, { params, state, now }) {
    const c = state.cues;
    if (state.rulesJson !== params.rules) {
      state.rulesJson = String(params.rules);
      try { c.rules = state.rulesJson ? (JSON.parse(state.rulesJson) as CueRule[]) : DEFAULT_RULES; } catch { /* keep previous rules while typing */ }
    }
    const evs = [...(i.events ?? []), ...(i.events2 ?? []), ...(i.events3 ?? []), ...(i.events4 ?? [])] as ExperienceEvent[];
    if (evs.length) c.fire(evs, now);
    const forced = String(params.scene);
    if (forced !== state.forced) { state.forced = forced; if (forced !== "(auto)") c.setScene(forced as SceneId); }
    if (params.thunder) { c.fire([{ type: "capture", t: now, data: { captured: "q" } }], now); params.thunder = false; }
    const fired = c.tick(now);
    if (Number(params.hour) >= 0) c.state.timeOfDay = Number(params.hour);
    if (Number(params.rain) >= 0) c.state.rain = Number(params.rain);
    if (Number(params.snow) >= 0) c.state.snow = Number(params.snow);
    bus.scene = c.state;
    return { scene: c.state, fired };
  },
  hover(p, w, h, s) {
    const v = visualSize(w, h, [200, 112]), st = s.cues.state, zone = p.y < v.h * 0.4 ? 0 : p.y < v.h * 0.75 ? 1 : 2;
    if (p.x > v.w || p.y > v.h) return null;
    const hh = Math.floor(st.timeOfDay), mm = Math.round((st.timeOfDay - hh) * 60), clock = `${String(hh).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}`;
    const lit = st.dmx.filter((x) => x > 0).length;
    const rows: TipRow[][] = [
      [{ label: "Time of day", value: clock, bar: st.timeOfDay / 24 }, { label: "Sky", value: st.timeOfDay >= 6 && st.timeOfDay < 18 ? "day" : "night" }, { label: "Lightning flash", value: pct(st.flash), bar: st.flash }],
      [{ label: "Rain", value: pct(st.rain), bar: st.rain }, { label: "Snow", value: pct(st.snow), bar: st.snow }, { label: "Fog", value: pct(st.fog), bar: st.fog }, { label: "Wind", value: pct(st.wind), bar: st.wind }],
      [{ label: "Fire glow", value: pct(st.fire), bar: st.fire }, { label: "Decor", value: st.decor.join(", ") || "none" }, { label: "Ambient audio", value: `rain ${pct(st.ambience.rain)} · wind ${pct(st.ambience.wind)} · drip ${pct(st.ambience.drip)}` }],
    ];
    const names = ["Sky", "Weather", "Ground & effects"], bodies = ["The sky colour follows the time of day; stars and the moon fade in at night.", "Particles and haze are drawn from the rain, snow, fog and wind levels.", "Decor and the fire glow, with the matching ambient audio levels."];
    return {
      title: names[zone], tag: `Scene · ${st.scene}`, color: "#c8a2ff", body: bodies[zone],
      rows: [...rows[zone], { label: "Scene", value: st.scene }, ...(st.banner ? [{ label: "Banner", value: st.banner }] : []), { label: "Rules", value: String(s.cues.rules.length) }, { label: "Lights on (DMX)", value: `${lit} of ${st.dmx.length} channels` }],
      mark: (ctx) => { const y0 = [0, v.h * 0.4, v.h * 0.75][zone], y1 = [v.h * 0.4, v.h * 0.75, v.h][zone]; ctx.save(); ctx.fillStyle = "rgba(255,228,92,.10)"; ctx.fillRect(0, y0, v.w, y1 - y0); ctx.strokeStyle = "#ffe45c"; ctx.lineWidth = 1; ctx.strokeRect(0.5, y0 + 0.5, v.w - 1, y1 - y0 - 1); ctx.restore(); },
    };
  },
  preview(ctx, w, h, s) {
    const now = performance.now();
    const dt = s.last ? Math.min(0.1, (now - s.last) / 1000) : 0.016; s.last = now;
    withDetail(ctx, w, h, [200, 112], (pw, ph) => s.r.draw(ctx, pw, ph, s.cues.state, now, dt), () => [...objRows(s.cues.state as unknown as Record<string, unknown>), ["rules", String(s.cues.rules.length)]]);
  },
};

interface OutState { audio: AudioEngine; dmx: DmxSink; dmxOn: boolean }
const sceneOut: NodeSpec<OutState> = {
  type: "scene.output", title: "Audio + DMX Out", category: "Output",
  inputs: [{ id: "scene", type: "scene" }, { id: "fired", type: "any" }], outputs: [],
  params: [
    { id: "audio", kind: "bool", label: "Ambient audio", value: true },
    { id: "dmx", kind: "bool", label: "DMX output", value: false },
    { id: "dmxUrl", kind: "text", label: "Bridge URL", value: "ws://127.0.0.1:8787" },
    { id: "universe", kind: "number", label: "Universe", min: 0, max: 15, step: 1, value: 0 },
  ],
  init: () => ({ audio: new AudioEngine(), dmx: new DmxSink(), dmxOn: false }),
  process({ scene, fired }, { params, state }) {
    const s = scene as SceneState | undefined;
    if (!s) return;
    state.audio.enabled = !!params.audio;
    state.audio.follow(s);
    for (const f of (fired as FiredAction[]) ?? []) state.audio.play(f.action);
    if (params.dmx && !state.dmxOn) { state.dmx.url = String(params.dmxUrl); state.dmx.connect(); state.dmxOn = true; }
    if (params.dmx) state.dmx.send(Number(params.universe), s.dmx);
  },
};

export const scenePlugin: Plugin = { id: "scene", name: "Scene", register: (r) => { r.register(cues); r.register(sceneOut); } };
export const startAudio = (graph: { states: Map<string, any>; nodes: Map<string, any> }) => {
  for (const [id, n] of graph.nodes) if (n.type === "scene.output") (graph.states.get(id) as OutState).audio.start();
};
