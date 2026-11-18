import { mixer } from "../scene/mixer";

/** What a sound recipe gets: its start time, loudness, a pitch ratio and how dramatic the moment was (0..1). */
interface Play { t: number; vol: number; pitch: number; strength: number }
export interface SoundDef { id: string; label: string; desc: string }

export const SOUNDS: SoundDef[] = [
  { id: "ripple", label: "Sonar ripple", desc: "Falling pings that echo outward, matching a ripple on the table." },
  { id: "chime", label: "Chime arpeggio", desc: "A bright bell arpeggio. Bigger captures ring higher." },
  { id: "sub-drop", label: "Sub drop", desc: "A deep falling thump you feel more than hear." },
  { id: "zap", label: "Zap", desc: "A quick electric discharge." },
  { id: "sparkle", label: "Sparkle", desc: "A shower of tiny high glints." },
  { id: "swoosh", label: "Swoosh", desc: "A rising air sweep." },
  { id: "glass", label: "Glass", desc: "A clear struck-glass tone." },
  { id: "pulse", label: "Pulse", desc: "Two soft low heartbeats." },
];
export const SOUND_IDS = SOUNDS.map((s) => s.id);

/** Synthesised sound effects (no sample files) on the global mixer's "sfx" bus. Needs a user gesture to start. */
export class FxAudio {
  private ctx: AudioContext | null = null;
  private out!: GainNode;
  private noise!: AudioBuffer;
  private send!: GainNode;
  /** Ids of the sounds played so far (kept short), mostly for tests and the node's status. */
  played: string[] = [];

  get ready() { return !!this.ctx; }

  start() {
    if (this.ctx) { void this.ctx.resume(); return; }
    if (typeof AudioContext === "undefined") return;
    const ctx = (this.ctx = new AudioContext());
    const comp = ctx.createDynamicsCompressor(); comp.connect(ctx.destination);
    this.out = ctx.createGain(); this.out.connect(comp);
    // a little echo "space" every sound is sent into
    const delay = ctx.createDelay(1), fb = ctx.createGain(), lp = ctx.createBiquadFilter(), wet = ctx.createGain();
    delay.delayTime.value = 0.21; fb.gain.value = 0.38; lp.type = "lowpass"; lp.frequency.value = 2400; wet.gain.value = 0.5;
    this.send = ctx.createGain(); this.send.gain.value = 0.35;
    this.send.connect(delay); delay.connect(lp); lp.connect(fb); fb.connect(delay); lp.connect(wet); wet.connect(this.out);
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  /** Play a recipe. `pitch` is in semitones; `delay` in seconds. Silent (but recorded) when audio has not started. */
  play(id: string, o: { volume?: number; pitch?: number; strength?: number; delay?: number } = {}) {
    this.played.push(id); if (this.played.length > 20) this.played.shift();
    const ctx = this.ctx;
    if (!ctx || !SOUND_IDS.includes(id)) return;
    const level = mixer.gain("sfx");
    if (level <= 0) return;
    const p: Play = { t: ctx.currentTime + 0.02 + Math.max(0, o.delay ?? 0), vol: Math.max(0, o.volume ?? 0.7) * level, pitch: 2 ** ((o.pitch ?? 0) / 12), strength: Math.min(1, Math.max(0, o.strength ?? 0.5)) };
    (this as unknown as Record<string, (p: Play) => void>)[`s_${id.replace("-", "_")}`](p);
  }

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number) {
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }
  private tone(type: OscillatorType, f0: number, f1: number, t: number, attack: number, decay: number, vol: number, wet = 1) {
    const ctx = this.ctx!, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + decay);
    this.env(g, t, vol, attack, decay);
    o.connect(g); g.connect(this.out); if (wet > 0) { const w = ctx.createGain(); w.gain.value = wet; g.connect(w); w.connect(this.send); }
    o.start(t); o.stop(t + attack + decay + 0.05);
  }
  private hiss(type: BiquadFilterType, f0: number, f1: number, q: number, t: number, attack: number, decay: number, vol: number) {
    const ctx = this.ctx!, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = this.noise; s.loop = true; f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + attack + decay);
    this.env(g, t, vol, attack, decay);
    s.connect(f); f.connect(g); g.connect(this.out); g.connect(this.send);
    s.start(t); s.stop(t + attack + decay + 0.05);
  }
  private bell(f: number, t: number, vol: number, decay: number, partials: number[] = [1, 2.76, 5.4, 8.9]) {
    partials.forEach((m, i) => this.tone("sine", f * m, f * m, t, 0.003, decay / (1 + i * 0.9), vol / (1 + i * 1.4)));
  }

  private s_ripple(p: Play) {
    for (let i = 0; i < 4; i++) this.tone("sine", 660 * p.pitch * (1 - 0.1 * i), 520 * p.pitch * (1 - 0.1 * i), p.t + i * 0.12, 0.006, 0.55, p.vol * 0.5 * 0.6 ** i);
  }
  private s_chime(p: Play) {
    const root = 392 * p.pitch * 2 ** (p.strength * 0.5);
    [1, 1.26, 1.5, 2].forEach((r, i) => this.bell(root * r, p.t + i * 0.07, p.vol * 0.35, 1.2));
  }
  private s_sub_drop(p: Play) {
    this.tone("sine", 130 * p.pitch, 38 * p.pitch, p.t, 0.004, 0.7 + p.strength * 0.5, p.vol * 0.9, 0);
    this.hiss("lowpass", 700, 90, 0.7, p.t, 0.004, 0.35, p.vol * 0.5);
  }
  private s_zap(p: Play) {
    this.tone("sawtooth", 2400 * p.pitch, 90 * p.pitch, p.t, 0.002, 0.22, p.vol * 0.35);
    this.hiss("bandpass", 5000, 400, 3, p.t, 0.001, 0.12, p.vol * 0.4);
  }
  private s_sparkle(p: Play) {
    for (let i = 0; i < 14; i++) this.tone("sine", (2200 + Math.random() * 3800) * p.pitch, (2000 + Math.random() * 3000) * p.pitch, p.t + Math.random() * 0.55, 0.002, 0.06 + Math.random() * 0.08, p.vol * 0.18);
  }
  private s_swoosh(p: Play) {
    this.hiss("bandpass", 250 * p.pitch, 4200 * p.pitch, 2, p.t, 0.28, 0.25, p.vol * 0.9);
  }
  private s_glass(p: Play) {
    this.bell(880 * p.pitch, p.t, p.vol * 0.5, 0.9, [1, 1.504, 2.0, 2.74, 3.9]);
  }
  private s_pulse(p: Play) {
    for (let i = 0; i < 2; i++) { this.tone("sine", 150 * p.pitch, 48 * p.pitch, p.t + i * 0.2, 0.003, 0.28, p.vol * 0.85 * (1 - i * 0.3), 0); this.hiss("lowpass", 900, 150, 0.7, p.t + i * 0.2, 0.002, 0.05, p.vol * 0.25); }
  }
}
