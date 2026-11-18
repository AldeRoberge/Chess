import type { CueAction, SceneState } from "./types";
import { mixer, type MixState } from "./mixer";

/**
 * Synthesised soundscape (no sample files): looped filtered-noise beds for rain / wind,
 * stochastic crackle for fire, drips, plus one-shot thunder and stings. Beds follow SceneState.
 * Sinks route through per-bus gains (ambience, sfx, music) into a master gain, which the global mixer drives.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses!: Record<"ambience" | "sfx" | "music", GainNode>;
  private beds: Record<string, GainNode> = {};
  private noise!: AudioBuffer;
  private unsubscribe: (() => void) | null = null;
  enabled = true;

  /** Must be called from a user gesture. */
  start() {
    if (this.ctx) { void this.ctx.resume(); this.applyMix(mixer.get()); return; }
    const ctx = (this.ctx = new AudioContext());
    this.master = ctx.createGain(); this.master.connect(ctx.destination);
    this.buses = {
      ambience: ctx.createGain(), sfx: ctx.createGain(), music: ctx.createGain(),
    };
    for (const b of Object.values(this.buses)) b.connect(this.master);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    // soft, even noise (a little low-passed white) instead of a harsh hiss; kept well below full scale
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = last * 0.6 + w * 0.4; d[i] = last * 0.5; }
    this.bed("rain", "highpass", 1800, 0.6);
    this.bed("wind", "bandpass", 420, 0.9);
    this.bed("fire", "lowpass", 900, 0.5);
    // the drone pad (startMusic) is off: a constant hum was too annoying
    this.applyMix(mixer.get());
    this.unsubscribe ??= mixer.subscribe((s) => this.applyMix(s));
  }

  /** Pushes the mixer levels onto the audio graph, smoothly so changes do not click. */
  applyMix(s: Readonly<MixState>) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.muted ? 0 : s.master, t, 0.05);
    this.buses.ambience.gain.setTargetAtTime(s.ambience, t, 0.05);
    this.buses.sfx.gain.setTargetAtTime(s.sfx, t, 0.05);
    this.buses.music.gain.setTargetAtTime(s.music, t, 0.05);
  }

  /** A quiet, slowly moving drone pad: the music bus. */
  private startMusic() {
    const ctx = this.ctx!;
    const chord = [110, 165, 220, 277.2];
    for (const f of chord) {
      const o = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), depth = ctx.createGain();
      o.type = "sine"; o.frequency.value = f;
      lfo.frequency.value = 0.05 + Math.random() * 0.05; depth.gain.value = 0.02;
      lfo.connect(depth).connect(g.gain);
      g.gain.value = 0.04;
      o.connect(g).connect(this.buses.music);
      o.start(); lfo.start();
    }
  }

  private bed(name: string, type: BiquadFilterType, freq: number, q: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f).connect(g).connect(this.buses.ambience); src.start();
    this.beds[name] = g;
  }

  follow(s: SceneState) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.beds.rain.gain.setTargetAtTime(this.enabled ? s.rain * 0.06 : 0, t, 0.4); // quiet background bed whenever rain > 0
    this.beds.wind.gain.setTargetAtTime(this.enabled ? s.wind * s.ambience.wind * 0.1 : 0, t, 0.8);
    this.beds.fire.gain.setTargetAtTime(this.enabled ? s.fire * 0.05 : 0, t, 0.5);
    if (this.enabled && s.fire > 0.1 && Math.random() < 0.15) this.click(0.05 + Math.random() * 0.1);
    if (this.enabled && s.ambience.drip > 0 && Math.random() < 0.01 * s.ambience.drip) this.drip();
  }

  play(a: CueAction) {
    if (!this.ctx || !this.enabled) return;
    if (a.do === "thunder") this.thunder(a.strength);
    else if (a.do === "sfx") a.name === "sting" ? this.sting() : this.thud(a.gain ?? 0.5);
  }

  private env(g: GainNode, peak: number, attack: number, decay: number) {
    const t = this.ctx!.currentTime;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }
  private burst(freq: number, peak: number, attack: number, decay: number, sweep = 0) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.setValueAtTime(freq, ctx.currentTime);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), ctx.currentTime + attack + decay);
    const g = ctx.createGain(); this.env(g, peak, attack, decay);
    src.connect(f).connect(g).connect(this.buses.sfx); src.start(); src.stop(ctx.currentTime + attack + decay + 0.1);
  }
  thunder(strength: number) { this.burst(1400, 0.9 * strength, 0.02, 0.6, 0.05); this.burst(220, 1.0 * strength, 0.25, 2.6 + strength * 2, 0.2); }
  private thud(g: number) { this.burst(300, g, 0.005, 0.25, 0.2); }
  private click(g: number) { this.burst(3000, g, 0.001, 0.03); }
  private drip() { this.burst(2400, 0.08, 0.001, 0.12, 0.5); }
  private sting() {
    const ctx = this.ctx!, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sawtooth"; o.frequency.setValueAtTime(220, ctx.currentTime); o.frequency.exponentialRampToValueAtTime(110, ctx.currentTime + 0.5);
    this.env(g, 0.25, 0.01, 0.6); o.connect(g).connect(this.buses.sfx); o.start(); o.stop(ctx.currentTime + 0.8);
  }
}
