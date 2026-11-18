import type { ExperienceEvent } from "../core/events";
import { SCENES, initialSceneState, type CueAction, type CueRule, type SceneId, type SceneState } from "./types";

export const DEFAULT_RULES: CueRule[] = [
  { id: "queen-lost", on: "capture", when: { captured: "q" }, actions: [
    { do: "lightning", strength: 1, bolts: 3 }, { do: "thunder", strength: 1, delayMs: 350 },
    { do: "dmx", channel: 1, value: 255, strobe: { count: 5, onMs: 40, offMs: 70 } }, { do: "video", clip: "queen-fall" },
  ] },
  { id: "capture", on: "capture", actions: [{ do: "lightning", strength: 0.25 }, { do: "sfx", name: "thud", gain: 0.5 }] },
  { id: "check", on: "check", actions: [{ do: "dmx", channel: 1, value: 180, strobe: { count: 2, onMs: 60, offMs: 90 } }, { do: "sfx", name: "sting" }] },
  { id: "mate", on: "mate", actions: [{ do: "lightning", strength: 1, bolts: 4 }, { do: "thunder", strength: 1, delayMs: 200 }, { do: "fire", level: 1 }, { do: "video", clip: "checkmate" }] },
  { id: "clock-low", on: "clock-low", actions: [{ do: "dmx", channel: 1, value: 120, strobe: { count: 2, onMs: 80, offMs: 120 } }, { do: "sfx", name: "sting", gain: 0.6 }] },
  { id: "clock-critical", on: "clock-critical", actions: [{ do: "lightning", strength: 0.5 }, { do: "sfx", name: "thud", gain: 0.8 }] },
  { id: "clock-flag", on: "clock-flag", actions: [{ do: "lightning", strength: 1, bolts: 2 }, { do: "thunder", strength: 1, delayMs: 250 }] },
  { id: "intro", on: "phase", when: { phase: "intro" }, actions: [{ do: "scene", id: "winter-forest" }, { do: "video", clip: "intro" }] },
  { id: "game", on: "phase", when: { phase: "game" }, actions: [{ do: "scene", id: "fire-watchtower" }] },
  { id: "outro", on: "phase", when: { phase: "outro" }, actions: [{ do: "scene", id: "christmas-forest" }, { do: "video", clip: "outro" }] },
  { id: "idle", on: "phase", when: { phase: "idle" }, actions: [{ do: "scene", id: "cavern" }] },
];

interface Timed { at: number; action: CueAction }
export interface FiredAction { action: CueAction; at: number }

/**
 * Maps experience events to scene actions through editable rules, owns the time-ordered cue
 * queue (strobes, delayed thunder), and folds actions into a SceneState that renderers,
 * the audio engine and the DMX sink all read.
 */
export class CueEngine {
  rules: CueRule[] = DEFAULT_RULES;
  state: SceneState = initialSceneState();
  private queue: Timed[] = [];
  private last: number | null = null;

  fire(events: ExperienceEvent[], now: number) {
    for (const e of events) {
      for (const r of this.rules) {
        if (r.on !== e.type) continue;
        if (r.when && !Object.entries(r.when).every(([k, v]) => e.data?.[k] === v)) continue;
        // a specific rule shadows the generic one of the same event type that follows it
        for (const a of r.actions) this.queue.push({ at: now, action: a });
        if (r.when) break;
      }
    }
  }

  setScene(id: SceneId) { this.apply({ do: "scene", id }, 0, []); }

  /** Advance time; returns actions that became due (for audio / UI), updates state. */
  tick(now: number): FiredAction[] {
    const dt = this.last === null ? 0 : Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    const s = this.state;
    const fired: FiredAction[] = [];
    for (let again = true; again; ) {
      again = false;
      const rest: Timed[] = [];
      for (const q of this.queue) {
        if (q.at > now) { rest.push(q); continue; }
        fired.push({ action: q.action, at: now });
        this.apply(q.action, now, rest);
        again = true;
      }
      this.queue = rest;
    }
    s.flash = Math.max(0, s.flash - dt * 4);
    s.fire += ((s.decor.includes("fire") ? 0.6 : 0) - s.fire) * Math.min(1, dt * 0.3);
    return fired;
  }

  private apply(a: CueAction, now: number, q: Timed[]) {
    const s = this.state;
    switch (a.do) {
      case "scene": {
        const d = SCENES[a.id];
        Object.assign(s, { scene: a.id, timeOfDay: d.timeOfDay, rain: d.rain, snow: d.snow, fog: d.fog, wind: d.wind, decor: d.decor, ambience: { ...d.ambience } });
        break;
      }
      case "weather":
        if (a.rain !== undefined) s.rain = a.rain;
        if (a.snow !== undefined) s.snow = a.snow;
        if (a.fog !== undefined) s.fog = a.fog;
        if (a.wind !== undefined) s.wind = a.wind;
        break;
      case "time": s.timeOfDay = a.hour; break;
      case "fire": s.fire = a.level; break;
      case "video": s.banner = a.clip; break;
      case "lightning": {
        const bolts = a.bolts ?? 1;
        s.flash = Math.max(s.flash, a.strength);
        for (let i = 1; i < bolts; i++) q.push({ at: now + i * 140, action: { do: "lightning", strength: a.strength * (1 - i * 0.15) } });
        break;
      }
      case "dmx":
        if (a.strobe) {
          let t = now;
          for (let i = 0; i < a.strobe.count; i++) {
            q.push({ at: t, action: { do: "dmx", channel: a.channel, value: a.value } });
            t += a.strobe.onMs;
            q.push({ at: t, action: { do: "dmx", channel: a.channel, value: 0 } });
            t += a.strobe.offMs;
          }
        } else s.dmx[a.channel - 1] = a.value;
        break;
      case "thunder":
      case "sfx":
        break; // consumed by the audio engine via the fired list
    }
  }
}
