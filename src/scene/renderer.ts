import type { SceneState } from "./types";

interface P { x: number; y: number; vx: number; vy: number; s: number }

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const rgb = (c: number[]) => `rgb(${c[0]},${c[1]},${c[2]})`;
function mulberry(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * Procedural Canvas2D scenes (no assets, no WebGL: cheap enough for a GTX 1060 mobile while the
 * 3D view and vision run). Particle counts are capped and scale with the intensity sliders.
 */
export class SceneRenderer {
  private rain: P[] = [];
  private snow: P[] = [];
  private embers: P[] = [];
  private bolt: { x: number; y: number }[] = [];
  private prevFlash = 0;
  private rnd = mulberry(42);
  private trees = Array.from({ length: 3 }, (_, l) => Array.from({ length: 16 }, (_, i) => ({ x: (i + this.r(0.1, 0.9)) / 16, h: 0.25 + l * 0.08 + this.r(0, 0.12), w: 0.05 + this.r(0, 0.03), lights: Array.from({ length: 9 }, () => ({ a: this.r(0, 1), b: this.r(0, 1), c: Math.floor(this.r(0, 4)) })) })));
  private stars = Array.from({ length: 140 }, () => ({ x: this.r(0, 1), y: this.r(0, 0.6), s: this.r(0.4, 1.6), p: this.r(0, 6) }));
  private spikes = Array.from({ length: 22 }, () => ({ x: this.r(0, 1), h: this.r(0.08, 0.3), w: this.r(0.02, 0.06) }));
  private crystals = Array.from({ length: 9 }, () => ({ x: this.r(0.05, 0.95), h: this.r(0.08, 0.22), hue: this.r(190, 280), p: this.r(0, 6) }));

  private r(a: number, b: number) { return a + this.rnd() * (b - a); }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, s: SceneState, tMs: number, dt: number) {
    const t = tMs / 1000;
    const day = clamp(Math.sin(((s.timeOfDay - 6) / 12) * Math.PI)); // 0 night .. 1 noon
    const top = mix([4, 8, 24], [90, 150, 220], day), bot = mix([16, 28, 60], [200, 220, 240], day);
    const cav = s.scene === "cavern";
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, rgb(cav ? [6, 6, 14] : top));
    g.addColorStop(1, rgb(cav ? [24, 18, 36] : bot));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    if (!cav && day < 0.6) {
      ctx.fillStyle = "#fff";
      for (const st of this.stars) { ctx.globalAlpha = (1 - day) * (0.5 + 0.5 * Math.sin(t * 2 + st.p)); ctx.fillRect(st.x * w, st.y * h, st.s, st.s); }
      ctx.globalAlpha = 1;
      if (day < 0.3) { ctx.fillStyle = "#dfe8ff"; ctx.beginPath(); ctx.arc(w * 0.78, h * 0.18, h * 0.045, 0, 7); ctx.fill(); }
    }

    if (cav) this.cavern(ctx, w, h, t, s);
    else this.forest(ctx, w, h, t, s, day);

    if (s.fire > 0.05 && s.decor.includes("fire")) this.fire(ctx, w, h, t, s, dt);
    this.weather(ctx, w, h, s, dt);

    if (s.fog > 0.02) {
      const f = ctx.createLinearGradient(0, h * 0.4, 0, h);
      f.addColorStop(0, "rgba(180,200,230,0)");
      f.addColorStop(1, `rgba(180,200,230,${s.fog * 0.45})`);
      ctx.fillStyle = f; ctx.fillRect(0, 0, w, h);
    }

    // lightning: new bolt on each rising edge
    if (s.flash > this.prevFlash + 0.2) this.newBolt(w, h);
    this.prevFlash = s.flash;
    if (s.flash > 0.05) {
      ctx.fillStyle = `rgba(220,230,255,${s.flash * s.flash * 0.7})`;
      ctx.fillRect(0, 0, w, h);
      if (s.flash > 0.4 && this.bolt.length) {
        ctx.strokeStyle = `rgba(255,255,255,${s.flash})`; ctx.lineWidth = Math.max(1.5, w / 400); ctx.shadowColor = "#9cf"; ctx.shadowBlur = 18;
        ctx.beginPath(); ctx.moveTo(this.bolt[0].x, this.bolt[0].y);
        for (const p of this.bolt) ctx.lineTo(p.x, p.y);
        ctx.stroke(); ctx.shadowBlur = 0;
      }
    }
    if (s.banner) { ctx.fillStyle = "rgba(255,255,255,.55)"; ctx.font = `${Math.round(h / 28)}px system-ui`; ctx.fillText(`▶ ${s.banner}`, w * 0.02, h * 0.96); }
  }

  private newBolt(w: number, h: number) {
    let x = w * (0.2 + Math.random() * 0.6), y = 0;
    this.bolt = [{ x, y }];
    while (y < h * 0.75) { y += h * 0.05 + Math.random() * h * 0.05; x += (Math.random() - 0.5) * w * 0.08; this.bolt.push({ x, y }); }
  }

  private forest(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, s: SceneState, day: number) {
    const snowy = s.snow > 0.05 || s.scene !== "fire-watchtower";
    for (let l = 0; l < 3; l++) {
      const shade = 10 + l * 14 + day * 40;
      // far rows are hazier and bluer: a little more sky mixed in each step back
      const haze = (2 - l) * 0.12;
      const lit = mix([shade * 0.55, shade * 0.95, shade * 0.75], [120, 150, 190], haze);
      const dark = lit.map((v) => v * 0.6);
      const litCss = rgb(lit), darkCss = rgb(dark); // one colour string per layer, not per tier
      for (const tr of this.trees[l]) {
        const sway = Math.sin(t * (0.6 + s.wind) + tr.x * 9) * s.wind * 6;
        const bx = tr.x * w, by = h * (0.78 + l * 0.05), th = tr.h * h * 1.4, tw = tr.w * w;
        this.spruce(ctx, bx, by, th, tw, sway, litCss, darkCss, snowy);
        if (s.decor.includes("christmas") && l === 2) {
          for (const li of tr.lights) {
            const on = Math.sin(t * 3 + li.a * 20 + li.c) > -0.2;
            if (!on) continue;
            const yy = by - th * (0.15 + li.a * 0.75), xx = bx + (li.b - 0.5) * tw * (1.6 * (1 - (by - yy) / th)) + sway * (1 - (by - yy) / th);
            ctx.fillStyle = ["#ff4040", "#ffd34d", "#4de0ff", "#7dff6a"][li.c]; ctx.beginPath(); ctx.arc(xx, yy, Math.max(2, w / 300), 0, 7); ctx.fill();
          }
        }
      }
    }
    ctx.fillStyle = snowy ? "#cfd9ee" : "#1c2a22";
    ctx.fillRect(0, h * 0.86, w, h * 0.14);
    if (s.decor.includes("fire")) { // watchtower
      ctx.fillStyle = "#120d0a";
      const x = w * 0.14, base = h * 0.9;
      ctx.fillRect(x - w * 0.02, base - h * 0.5, w * 0.012, h * 0.5); ctx.fillRect(x + w * 0.02, base - h * 0.5, w * 0.012, h * 0.5);
      ctx.fillRect(x - w * 0.035, base - h * 0.56, w * 0.085, h * 0.07);
      ctx.beginPath(); ctx.moveTo(x - w * 0.045, base - h * 0.56); ctx.lineTo(x + w * 0.0075, base - h * 0.66); ctx.lineTo(x + w * 0.06, base - h * 0.56); ctx.fill();
    }
  }

  /**
   * A conifer: a short trunk, three stacked tiers that get narrower toward the top, each split into a lit
   * side and a shaded side, with snow on the upper edge of every tier when it is winter.
   */
  private spruce(ctx: CanvasRenderingContext2D, bx: number, by: number, th: number, tw: number, sway: number, litCss: string, darkCss: string, snowy: boolean) {
    // ground shadow
    ctx.fillStyle = "rgba(0,0,0,.22)"; ctx.beginPath(); ctx.ellipse(bx, by + th * 0.02, tw * 1.3, tw * 0.28, 0, 0, 7); ctx.fill();
    // trunk
    ctx.fillStyle = darkCss; ctx.fillRect(bx - tw * 0.1, by - th * 0.1, tw * 0.2, th * 0.12);
    const tiers = 3, step = th * 0.3, tierH = th * 0.36;
    for (let i = 0; i < tiers; i++) {
      const yb = by - th * 0.02 - i * step;               // tier base
      const ya = yb - tierH - (i === tiers - 1 ? th * 0.02 : 0); // tier apex
      const hw = tw * (1 - i * 0.26);                        // half width
      const ax = bx + sway * (1 - i * 0.25);                 // branches sway more toward the top
      // lit side (left) and shaded side (right)
      ctx.fillStyle = litCss; ctx.beginPath(); ctx.moveTo(ax, ya); ctx.lineTo(bx - hw, yb); ctx.lineTo(ax, yb); ctx.closePath(); ctx.fill();
      ctx.fillStyle = darkCss; ctx.beginPath(); ctx.moveTo(ax, ya); ctx.lineTo(ax, yb); ctx.lineTo(bx + hw, yb); ctx.closePath(); ctx.fill();
      if (snowy) { // snow settles on the upper part of each tier
        const f = 0.4, sy = ya + (yb - ya) * f; // snow reaches 40% down the tier
        const xl = ax + (bx - hw - ax) * f, xr = ax + (bx + hw - ax) * f;
        ctx.fillStyle = "rgba(236,243,255,.75)";
        ctx.beginPath(); ctx.moveTo(ax, ya); ctx.lineTo(xl, sy); ctx.lineTo(ax, sy + tierH * 0.04); ctx.lineTo(xr, sy); ctx.closePath(); ctx.fill();
      }
    }
  }

  private cavern(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, s: SceneState) {
    ctx.fillStyle = "#0b0912";
    for (const sp of this.spikes) { ctx.beginPath(); ctx.moveTo(sp.x * w - sp.w * w, 0); ctx.lineTo(sp.x * w + sp.w * w, 0); ctx.lineTo(sp.x * w, sp.h * h); ctx.fill(); }
    ctx.fillStyle = "#0e0b16"; ctx.fillRect(0, h * 0.88, w, h * 0.12);
    for (const c of this.crystals) {
      const glow = 0.5 + 0.5 * Math.sin(t * 1.3 + c.p);
      const x = c.x * w, y = h * 0.88, ch = c.h * h;
      const rg = ctx.createRadialGradient(x, y - ch * 0.5, 2, x, y - ch * 0.5, ch * 1.6);
      rg.addColorStop(0, `hsla(${c.hue},90%,65%,${0.35 * glow + 0.1})`); rg.addColorStop(1, "hsla(0,0%,0%,0)");
      ctx.fillStyle = rg; ctx.fillRect(x - ch * 2, y - ch * 2, ch * 4, ch * 2.2);
      ctx.fillStyle = `hsl(${c.hue},80%,${45 + glow * 20}%)`;
      ctx.beginPath(); ctx.moveTo(x - ch * 0.12, y); ctx.lineTo(x, y - ch); ctx.lineTo(x + ch * 0.12, y); ctx.fill();
    }
  }

  private fire(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, s: SceneState, dt: number) {
    const x = w * 0.14 + w * 0.0075, y = h * 0.9 - h * 0.58;
    const flick = 0.8 + 0.2 * Math.sin(t * 17) * Math.sin(t * 5.3) + 0.1 * Math.sin(t * 31);
    const r = h * 0.35 * s.fire * flick;
    const g = ctx.createRadialGradient(x, y, 2, x, y, r);
    g.addColorStop(0, "rgba(255,200,90,.9)"); g.addColorStop(0.3, "rgba(255,110,30,.45)"); g.addColorStop(1, "rgba(255,60,0,0)");
    ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); ctx.globalCompositeOperation = "source-over";
    if (this.embers.length < 40 * s.fire && Math.random() < 0.5) this.embers.push({ x: x + (Math.random() - 0.5) * w * 0.02, y, vx: (Math.random() - 0.3) * 20, vy: -30 - Math.random() * 50, s: 1 + Math.random() * 2 });
    ctx.fillStyle = "#ffb347";
    this.embers = this.embers.filter((e) => e.y > 0 && e.s > 0.1);
    for (const e of this.embers) { e.x += (e.vx + s.wind * 40) * dt; e.y += e.vy * dt; e.s -= dt * 0.5; ctx.globalAlpha = clamp(e.s); ctx.fillRect(e.x, e.y, 2, 2); }
    ctx.globalAlpha = 1;
  }

  private weather(ctx: CanvasRenderingContext2D, w: number, h: number, s: SceneState, dt: number) {
    const wantRain = Math.round(s.rain * 320), wantSnow = Math.round(s.snow * 220);
    while (this.rain.length < wantRain) this.rain.push({ x: Math.random() * w * 1.2, y: Math.random() * h, vx: -80 - s.wind * 180, vy: 700 + Math.random() * 300, s: 8 + Math.random() * 10 });
    if (this.rain.length > wantRain) this.rain.length = wantRain;
    while (this.snow.length < wantSnow) this.snow.push({ x: Math.random() * w, y: Math.random() * h, vx: 0, vy: 30 + Math.random() * 50, s: 1 + Math.random() * 2.5 });
    if (this.snow.length > wantSnow) this.snow.length = wantSnow;
    if (this.rain.length) {
      ctx.strokeStyle = "rgba(170,200,255,.45)"; ctx.lineWidth = 1; ctx.beginPath();
      for (const p of this.rain) {
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.y > h) { p.y = -10; p.x = Math.random() * w * 1.2; }
        ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + p.vx * 0.012, p.y - p.s);
      }
      ctx.stroke();
    }
    if (this.snow.length) {
      ctx.fillStyle = "rgba(255,255,255,.85)";
      for (const p of this.snow) {
        p.x += (Math.sin(p.y * 0.02 + p.s) * 14 + s.wind * 60) * dt; p.y += p.vy * dt;
        if (p.y > h) { p.y = -4; p.x = Math.random() * w; }
        if (p.x > w) p.x = 0;
        ctx.fillRect(p.x, p.y, p.s, p.s);
      }
    }
  }
}
