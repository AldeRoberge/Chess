import type { FxCue, FxRGB } from "./types";

/** Everything a painter needs. Units: pixels relative to the board's top-left corner, seconds. */
export interface FxGeom {
  ctx: CanvasRenderingContext2D;
  /** Pixels per board square. */
  px: number;
  /** Effect centre in pixels. */
  cx: number; cy: number;
  /** Seconds since start, and 0..1 progress through the effect's duration. */
  age: number; life: number;
  rgb: FxRGB;
  /** How far it reaches, in squares. */
  reach: number;
  intensity: number;
  count: number;
  cue: FxCue;
  /** Stable random numbers for this instance: call rand() in the same order every frame. */
  rand: () => number;
}

export interface EffectDef { id: string; label: string; desc: string; duration: number; draw(g: FxGeom): void }

const ease = (t: number) => 1 - (1 - t) ** 3;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const col = (rgb: FxRGB, a: number) => `rgba(${Math.round(rgb[0])},${Math.round(rgb[1])},${Math.round(rgb[2])},${clamp01(a).toFixed(3)})`;
/** Brightened towards white, for hot cores. */
const hot = (rgb: FxRGB, a: number, k = 0.6): string => col([rgb[0] + (255 - rgb[0]) * k, rgb[1] + (255 - rgb[1]) * k, rgb[2] + (255 - rgb[2]) * k], a);

export function mulberry(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** A soft ring of light: a radial gradient that peaks on radius r. */
function ring(g: FxGeom, r: number, width: number, a: number) {
  if (r <= 0.5 || a <= 0.002) return;
  const { ctx, cx, cy, rgb } = g, o = r + width, i = Math.max(0, r - width);
  const gr = ctx.createRadialGradient(cx, cy, i, cx, cy, o);
  gr.addColorStop(0, col(rgb, 0)); gr.addColorStop(0.5, col(rgb, a)); gr.addColorStop(1, col(rgb, 0));
  ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(cx, cy, o, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = hot(rgb, a * 0.9); ctx.lineWidth = Math.max(1, width * 0.12); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
}

function glow(g: FxGeom, r: number, a: number) {
  if (r <= 0.5 || a <= 0.002) return;
  const { ctx, cx, cy, rgb } = g, gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  gr.addColorStop(0, hot(rgb, a, 0.75)); gr.addColorStop(0.35, col(rgb, a * 0.55)); gr.addColorStop(1, col(rgb, 0));
  ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
}

const ripple: EffectDef = {
  id: "ripple", label: "Ripple", desc: "Soft concentric rings of light spreading across the table, like a stone dropped in water.", duration: 2.2,
  draw(g) {
    const R = g.reach * g.px, n = Math.max(1, Math.round(g.count));
    for (let i = 0; i < n; i++) {
      const p = g.life * 1.25 - i * 0.14;
      if (p < 0 || p > 1) continue;
      ring(g, ease(p) * R, g.px * (0.22 - 0.1 * p), (1 - p) ** 1.6 * g.intensity * 0.9);
    }
    glow(g, g.px * 0.9 * (1 - g.life), (1 - g.life) ** 2 * g.intensity);
  },
};

const shockwave: EffectDef = {
  id: "shockwave", label: "Shockwave", desc: "One heavy ring that punches outward fast, then slows, with a bright flash at the centre.", duration: 1.2,
  draw(g) {
    const R = g.reach * g.px, p = g.life;
    ring(g, ease(ease(p)) * R, g.px * (0.55 - 0.4 * p), (1 - p) ** 1.3 * g.intensity);
    if (p < 0.3) glow(g, g.px * (1 + 2.2 * p), (1 - p / 0.3) * g.intensity);
  },
};

const gridPulse: EffectDef = {
  id: "grid-pulse", label: "Grid pulse", desc: "A wave that lights each board square as it passes, so the whole checkerboard ripples.", duration: 1.8,
  draw(g) {
    const { ctx, px } = g, front = ease(g.life) * (g.reach + 1.5), c = g.cue;
    for (let i = 0; i < 64; i++) {
      const x = i % 8, y = Math.floor(i / 8), d = Math.hypot(x + 0.5 - c.col, y + 0.5 - c.row);
      const k = Math.exp(-((d - front) ** 2) / 0.9) * (1 - g.life) ** 0.8 * g.intensity;
      if (k < 0.02) continue;
      ctx.fillStyle = col(g.rgb, k * 0.5); ctx.fillRect(x * px + 2, y * px + 2, px - 4, px - 4);
      ctx.strokeStyle = hot(g.rgb, k, 0.5); ctx.lineWidth = 1.5; ctx.strokeRect(x * px + 2.5, y * px + 2.5, px - 5, px - 5);
    }
  },
};

const sparks: EffectDef = {
  id: "sparks", label: "Sparks", desc: "A burst of glowing streaks flying outward from the captured square.", duration: 1.1,
  draw(g) {
    const { ctx } = g, n = Math.round(g.count * 8), R = g.reach * g.px;
    ctx.lineCap = "round";
    for (let i = 0; i < n; i++) {
      const a = g.rand() * Math.PI * 2, v = 0.45 + g.rand() * 0.75, w = 1 + g.rand() * 2.2;
      const d = ease(g.life) * R * v, tail = Math.min(d, g.px * (0.25 + 0.5 * (1 - g.life)));
      const x = g.cx + Math.cos(a) * d, y = g.cy + Math.sin(a) * d, al = (1 - g.life) ** 1.2 * g.intensity;
      ctx.strokeStyle = col(g.rgb, al); ctx.lineWidth = w + 2;
      ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * tail, y - Math.sin(a) * tail); ctx.lineTo(x, y); ctx.stroke();
      ctx.strokeStyle = hot(g.rgb, al, 0.8); ctx.lineWidth = w * 0.6; ctx.stroke();
    }
    if (g.life < 0.25) glow(g, g.px * 1.4, (1 - g.life / 0.25) * g.intensity);
  },
};

const lasers: EffectDef = {
  id: "lasers", label: "Laser cross", desc: "Beams shoot along the rank and file (and diagonals) through the square, like a rook and bishop at once.", duration: 1.0,
  draw(g) {
    const { ctx } = g, R = g.reach * g.px, grow = ease(clamp01(g.life * 3.2)), fade = (1 - clamp01((g.life - 0.25) / 0.75)) ** 1.5 * g.intensity;
    const dirs = g.count >= 4 ? 8 : 4;
    ctx.lineCap = "round";
    for (let k = 0; k < dirs; k++) {
      const a = (k * Math.PI * 2) / dirs, diag = k % 2 === 1, len = R * grow * (diag ? 0.8 : 1.15);
      const ex = g.cx + Math.cos(a) * len, ey = g.cy + Math.sin(a) * len;
      const gr = ctx.createLinearGradient(g.cx, g.cy, ex, ey);
      gr.addColorStop(0, hot(g.rgb, fade, 0.7)); gr.addColorStop(1, col(g.rgb, 0));
      ctx.strokeStyle = gr; ctx.lineWidth = g.px * (diag ? 0.16 : 0.26) * (1 - g.life * 0.6);
      ctx.beginPath(); ctx.moveTo(g.cx, g.cy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.lineWidth = 2; ctx.strokeStyle = `rgba(255,255,255,${clamp01(fade * 0.8).toFixed(3)})`; ctx.stroke();
    }
    glow(g, g.px * 0.9, fade);
  },
};

const bloom: EffectDef = {
  id: "bloom", label: "Bloom", desc: "A warm pool of light that swells over the square and fades, lighting its neighbours.", duration: 1.5,
  draw(g) {
    const swell = Math.sin(Math.PI * g.life) ** 0.8, r = g.px * (0.7 + g.reach * 0.35 * ease(g.life));
    glow(g, r, swell * g.intensity);
    g.ctx.strokeStyle = hot(g.rgb, swell * g.intensity * 0.8, 0.5); g.ctx.lineWidth = 2;
    g.ctx.strokeRect(Math.floor(g.cue.col) * g.px + 2, Math.floor(g.cue.row) * g.px + 2, g.px - 4, g.px - 4);
  },
};

const confetti: EffectDef = {
  id: "confetti", label: "Confetti", desc: "Tumbling flakes of light thrown outward that flip and drift as they fade.", duration: 2.0,
  draw(g) {
    const { ctx } = g, n = Math.round(g.count * 7), R = g.reach * g.px, p = ease(Math.min(1, g.life * 1.3));
    const tints: FxRGB[] = [g.rgb, [255, 255, 255], [Math.min(255, g.rgb[2] + 40), g.rgb[0], g.rgb[1]]];
    for (let i = 0; i < n; i++) {
      const a = g.rand() * Math.PI * 2, v = 0.3 + g.rand() * 0.9, spin = (g.rand() - 0.5) * 10, ph = g.rand() * 6.28, size = g.px * (0.07 + g.rand() * 0.1), tint = tints[i % 3];
      const x = g.cx + Math.cos(a) * R * v * p, y = g.cy + Math.sin(a) * R * v * p + g.life * g.life * g.px * 0.6;
      const flip = Math.cos(g.age * 7 + ph), al = (1 - g.life) ** 0.9 * g.intensity;
      ctx.save(); ctx.translate(x, y); ctx.rotate(spin * g.age); ctx.scale(1, 0.25 + Math.abs(flip) * 0.75);
      ctx.fillStyle = col(tint, al); ctx.fillRect(-size, -size * 0.6, size * 2, size * 1.2); ctx.restore();
    }
  },
};

const glitch: EffectDef = {
  id: "glitch", label: "Glitch scan", desc: "Digital interference: stuttering color-split bars tear across the rows near the capture.", duration: 1.0,
  draw(g) {
    const { ctx, px } = g, step = Math.floor(g.age * 22), r = mulberry(step * 7919 + g.cue.id), W = px * 8;
    const bars = Math.round(4 + g.count * 2), fade = (1 - g.life) ** 0.8 * g.intensity;
    for (let i = 0; i < bars; i++) {
      const row = g.cue.row + (r() - 0.5) * g.reach * 1.4, y = row * px, h = px * (0.06 + r() * 0.22), x0 = r() * W * 0.7, w = W * (0.15 + r() * 0.6), s = (r() - 0.5) * px * 0.7;
      ctx.fillStyle = col([255, 40, 90], fade * 0.55); ctx.fillRect(x0 + s, y, w, h);
      ctx.fillStyle = col([40, 230, 255], fade * 0.55); ctx.fillRect(x0 - s, y + h * 0.3, w, h);
      ctx.fillStyle = col(g.rgb, fade * 0.7); ctx.fillRect(x0, y + h * 0.15, w * 0.6, Math.max(1, h * 0.25));
    }
    const sweepY = (g.cue.row - g.reach * 0.7 + g.life * g.reach * 1.4) * px;
    ctx.fillStyle = hot(g.rgb, fade * 0.5, 0.5); ctx.fillRect(0, sweepY, W, 2);
  },
};

const spiral: EffectDef = {
  id: "spiral", label: "Spiral", desc: "A swirl of glowing motes winding outward from the square like a small galaxy.", duration: 1.8,
  draw(g) {
    const { ctx } = g, arms = Math.max(1, Math.round(g.count)), R = g.reach * g.px, p = ease(g.life), steps = 26;
    for (let a = 0; a < arms; a++) {
      for (let j = 1; j <= steps; j++) {
        const f = j / steps, r = f * p * R, ang = (a * Math.PI * 2) / arms + f * 5 + g.age * 2.6;
        const al = (1 - g.life) ** 1.2 * (1 - f * 0.7) * g.intensity, s = g.px * 0.09 * (1 - f * 0.6);
        ctx.fillStyle = col(g.rgb, al); ctx.beginPath(); ctx.arc(g.cx + Math.cos(ang) * r, g.cy + Math.sin(ang) * r, s + 1, 0, Math.PI * 2); ctx.fill();
        if (j % 4 === 0) { ctx.fillStyle = `rgba(255,255,255,${clamp01(al * 0.8).toFixed(3)})`; ctx.fillRect(g.cx + Math.cos(ang) * r - 1, g.cy + Math.sin(ang) * r - 1, 2, 2); }
      }
    }
    glow(g, g.px * 0.8, (1 - g.life) * g.intensity);
  },
};

const sunburst: EffectDef = {
  id: "sunburst", label: "Sunburst", desc: "Slowly turning rays of light fan out from the square, like a crown being raised.", duration: 1.4,
  draw(g) {
    const { ctx } = g, n = Math.max(6, Math.round(g.count * 4)), R = g.reach * g.px * ease(clamp01(g.life * 2)), al = Math.sin(Math.PI * Math.min(1, g.life * 1.1)) * g.intensity;
    if (R < 1) return;
    // every ray shares the same gradient (same centre, radius and colours), so it is made once per frame
    const gr = ctx.createRadialGradient(g.cx, g.cy, 0, g.cx, g.cy, R);
    gr.addColorStop(0, hot(g.rgb, al * 0.9, 0.6)); gr.addColorStop(1, col(g.rgb, 0));
    ctx.fillStyle = gr;
    for (let i = 0; i < n; i++) {
      const a = (i * Math.PI * 2) / n + g.age * 0.7, w = (Math.PI / n) * 0.55;
      ctx.beginPath(); ctx.moveTo(g.cx, g.cy);
      ctx.lineTo(g.cx + Math.cos(a - w) * R, g.cy + Math.sin(a - w) * R); ctx.lineTo(g.cx + Math.cos(a + w) * R, g.cy + Math.sin(a + w) * R); ctx.closePath(); ctx.fill();
    }
    glow(g, g.px * 1.1, al);
  },
};

const lightning: EffectDef = {
  id: "lightning", label: "Lightning", desc: "Jagged bolts crackle out from the square and flicker, then die away.", duration: 0.8,
  draw(g) {
    const { ctx } = g, step = Math.floor(g.age * 20), r = mulberry(step * 104729 + g.cue.id), R = g.reach * g.px, al = (1 - g.life) ** 1.4 * g.intensity;
    const bolts = Math.max(2, Math.round(g.count)), base = mulberry(g.cue.id * 31 + 5);
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    for (let b = 0; b < bolts; b++) {
      const a = base() * Math.PI * 2, len = R * (0.55 + base() * 0.45), segs = 9;
      ctx.beginPath(); ctx.moveTo(g.cx, g.cy);
      for (let s = 1; s <= segs; s++) {
        const d = (s / segs) * len, j = (r() - 0.5) * g.px * 0.5 * (s / segs + 0.3);
        ctx.lineTo(g.cx + Math.cos(a) * d - Math.sin(a) * j, g.cy + Math.sin(a) * d + Math.cos(a) * j);
      }
      ctx.strokeStyle = col(g.rgb, al * 0.55); ctx.lineWidth = g.px * 0.14; ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${clamp01(al).toFixed(3)})`; ctx.lineWidth = 1.6; ctx.stroke();
    }
    glow(g, g.px * 1.2, al);
  },
};

export const EFFECTS: Record<string, EffectDef> = Object.fromEntries([ripple, shockwave, gridPulse, sparks, lasers, bloom, confetti, glitch, spiral, sunburst, lightning].map((e) => [e.id, e]));
