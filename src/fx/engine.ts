import { EFFECTS, mulberry } from "./effects";
import { resolveColor, type FxCall } from "./types";

interface Item { call: FxCall; t0: number; dur: number; seed: number }

const MAX_ITEMS = 24;

/** Runs the visual effects that are alive right now and paints them in board coordinates (1 square = `px` pixels). */
export class FxEngine {
  items: Item[] = [];

  /** Start a visual call at `now` ms (plus its own delay). Unknown effects are ignored. */
  spawn(call: FxCall, now: number) {
    if (call.kind !== "visual") return;
    const def = EFFECTS[call.id];
    if (!def) return;
    const speed = Math.max(0.1, Number(call.opts.speed) || 1);
    this.items.push({ call, t0: now + call.delay * 1000, dur: def.duration / speed, seed: call.cue.id * 2654435761 + call.id.length });
    if (this.items.length > MAX_ITEMS) this.items.splice(0, this.items.length - MAX_ITEMS);
  }

  /** True while anything is waiting or playing. */
  active(now: number) { return this.items.some((i) => now < i.t0 + i.dur * 1000); }

  /** 0..1 loudest current effect, used to pulse the projector beam. */
  level(now: number) {
    let m = 0;
    for (const i of this.items) { const a = (now - i.t0) / (i.dur * 1000); if (a >= 0 && a < 1) m = Math.max(m, (1 - a) * Math.min(1.2, Number(i.call.opts.intensity) || 0.9)); }
    return Math.min(1, m);
  }

  clear() { this.items.length = 0; }

  draw(ctx: CanvasRenderingContext2D, px: number, now: number) {
    // drop the finished items in place (no new array every frame)
    const items = this.items;
    let kept = 0;
    for (let n = 0; n < items.length; n++) if (now < items[n].t0 + items[n].dur * 1000) items[kept++] = items[n];
    items.length = kept;
    if (!kept) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const i of this.items) {
      const age = (now - i.t0) / 1000;
      if (age < 0) continue;
      const def = EFFECTS[i.call.id], o = i.call.opts, cue = i.call.cue;
      ctx.save();
      def.draw({
        ctx, px, cx: cue.col * px, cy: cue.row * px, age, life: Math.min(1, age / i.dur),
        rgb: resolveColor(String(o.color ?? "auto"), cue), reach: Number(o.reach) || 6, intensity: Number(o.intensity) || 0.9,
        count: Number(o.count) || 4, cue, rand: mulberry(i.seed),
      });
      ctx.restore();
    }
    ctx.restore();
  }
}

/** The table's own effects: the 3D view and the app preview read this; the projector windows keep their own copy. */
export const fxEngine = new FxEngine();
