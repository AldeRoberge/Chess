import { bus } from "../core/bus";
import type { ExperienceEvent } from "../core/events";
import type { NodeSpec, Plugin } from "../core/types";
import { AudioEngine } from "../scene/audio";
import { CueEngine, DEFAULT_RULES, type FiredAction } from "../scene/cues";
import { DmxSink } from "../scene/dmx";
import { SceneRenderer } from "../scene/renderer";
import { SCENES, type CueRule, type SceneId, type SceneState } from "../scene/types";
import { objRows, withDetail } from "./shared";

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
