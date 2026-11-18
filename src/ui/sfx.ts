export type SfxKind = "tick" | "ok" | "back" | "deny" | "launch";

/** Menu sounds synthesised on the fly: short sine / square blips, console style. Silent until the first user gesture. */
export class Sfx {
  private ctx: AudioContext | null = null;
  muted = false;

  private ensure(): AudioContext | null {
    if (typeof AudioContext === "undefined") return null;
    this.ctx ??= new AudioContext();
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  private blip(freq: number, dur: number, type: OscillatorType, gain: number, delay = 0, slideTo?: number) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + dur + 0.02);
  }

  play(kind: SfxKind) {
    if (this.muted) return;
    switch (kind) {
      case "tick": this.blip(1320, 0.04, "sine", 0.05); break;
      case "ok": this.blip(660, 0.07, "square", 0.05); this.blip(990, 0.1, "square", 0.05, 0.07); break;
      case "back": this.blip(520, 0.09, "sine", 0.06, 0, 300); break;
      case "deny": this.blip(150, 0.16, "sawtooth", 0.06); break;
      case "launch": [440, 660, 880, 1320].forEach((f, i) => this.blip(f, 0.16, "square", 0.05, i * 0.08)); break;
    }
  }
}
