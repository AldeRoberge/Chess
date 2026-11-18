export type SceneId = "cavern" | "winter-forest" | "fire-watchtower" | "christmas-forest";

export interface SceneDef {
  id: SceneId;
  name: string;
  timeOfDay: number; // 0..24h
  rain: number; // 0..1
  snow: number;
  fog: number;
  wind: number;
  decor: ("christmas" | "fire" | "stars" | "crystals")[];
  ambience: { rain: number; fire: number; wind: number; drip: number };
}

export const SCENES: Record<SceneId, SceneDef> = {
  cavern: { id: "cavern", name: "Caverne", timeOfDay: 0, rain: 0, snow: 0, fog: 0.5, wind: 0.1, decor: ["crystals"], ambience: { rain: 0, fire: 0.1, wind: 0.2, drip: 0.6 } },
  "winter-forest": { id: "winter-forest", name: "Forêt d'hiver", timeOfDay: 21, rain: 0, snow: 0.7, fog: 0.25, wind: 0.4, decor: ["stars"], ambience: { rain: 0, fire: 0, wind: 0.5, drip: 0 } },
  "fire-watchtower": { id: "fire-watchtower", name: "Tour de guet", timeOfDay: 22, rain: 0.5, snow: 0, fog: 0.2, wind: 0.5, decor: ["fire", "stars"], ambience: { rain: 0.6, fire: 0.5, wind: 0.3, drip: 0 } },
  "christmas-forest": { id: "christmas-forest", name: "Forêt de Noël", timeOfDay: 19, rain: 0, snow: 0.5, fog: 0.15, wind: 0.2, decor: ["christmas", "stars"], ambience: { rain: 0, fire: 0.2, wind: 0.2, drip: 0 } },
};

export interface SceneState {
  scene: SceneId;
  timeOfDay: number;
  rain: number;
  snow: number;
  fog: number;
  wind: number;
  flash: number; // lightning intensity 0..1 (decays)
  fire: number; // 0..1 fire glow
  dmx: number[]; // 512 channel universe snapshot
  decor: SceneDef["decor"];
  /** ambient bed levels for audio */
  ambience: SceneDef["ambience"];
  banner: string; // text/video cue label for UI
}

export const initialSceneState = (id: SceneId = "cavern"): SceneState => {
  const d = SCENES[id];
  return { scene: id, timeOfDay: d.timeOfDay, rain: d.rain, snow: d.snow, fog: d.fog, wind: d.wind, flash: 0, fire: d.decor.includes("fire") ? 0.6 : 0, dmx: new Array(512).fill(0), decor: d.decor, ambience: { ...d.ambience }, banner: "" };
};

export type CueAction =
  | { do: "scene"; id: SceneId }
  | { do: "weather"; rain?: number; snow?: number; fog?: number; wind?: number }
  | { do: "time"; hour: number }
  | { do: "lightning"; strength: number; bolts?: number }
  | { do: "thunder"; strength: number; delayMs?: number }
  | { do: "dmx"; channel: number; value: number; strobe?: { count: number; onMs: number; offMs: number } }
  | { do: "video"; clip: string }
  | { do: "sfx"; name: string; gain?: number }
  | { do: "fire"; level: number };

export interface CueRule {
  id: string;
  on: string; // event type
  when?: Record<string, string | number | boolean>; // shallow match on event.data
  actions: CueAction[];
}
