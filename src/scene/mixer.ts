/** Global mixer: one volume per bus plus a master mute. Persisted, and every audio sink reads it. */
export type Bus = "ambience" | "sfx" | "music" | "narration";
export interface MixState {
  master: number;
  muted: boolean;
  ambience: number;
  sfx: number;
  music: number;
  narration: number;
}

const KEY = "cx.mixer.v1";
export const BUSES: Bus[] = ["ambience", "sfx", "music", "narration"];
const DEFAULTS: MixState = { master: 1, muted: false, ambience: 0.8, sfx: 1, music: 0.5, narration: 1 };

const clamp = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

function load(): MixState {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* corrupt entry: use defaults */ }
  return { ...DEFAULTS };
}

class Mixer {
  private state: MixState = load();
  private listeners = new Set<(s: MixState) => void>();

  get(): Readonly<MixState> { return this.state; }

  /** Effective gain for a bus: its own level times the master, or 0 when muted. */
  gain(bus: Bus): number {
    return this.state.muted ? 0 : this.state.master * this.state[bus];
  }

  set(key: "master" | Bus, value: number) {
    this.state = { ...this.state, [key]: clamp(value) };
    this.commit();
  }

  setMuted(muted: boolean) {
    this.state = { ...this.state, muted };
    this.commit();
  }

  toggleMuted(): boolean {
    this.setMuted(!this.state.muted);
    return this.state.muted;
  }

  subscribe(fn: (s: MixState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private commit() {
    try { if (typeof localStorage !== "undefined") localStorage.setItem(KEY, JSON.stringify(this.state)); } catch { /* storage full or blocked */ }
    for (const fn of this.listeners) fn(this.state);
  }
}

export const mixer = new Mixer();
