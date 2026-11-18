import { fmtClock, type ClockEstimate, type SideClock } from "../clock/types";

export interface ClockOverlay { mode: "digits" | "circle" | "square"; showCert: boolean; clock: ClockEstimate }

/** Dash and alpha follow certainty: a solid bright stroke means "believe it", a faint dashed one means "roughly". */
const style = (conf: number) => ({ alpha: 0.35 + 0.65 * Math.min(1, conf / 0.7), dash: conf >= 0.7 ? [] : conf >= 0.4 ? [10, 6] : [4, 8] });
const urgency = (c: SideClock, t: number, lowMs: number, critMs: number) => {
  if (c.conf < 0.5) return "#9fb4cc"; // not sure enough to raise the alarm
  if (c.ms <= critMs) return Math.sin(t * 8) > 0 ? "#ff5a6e" : "#ff9aa6";
  return c.ms <= lowMs ? "#ffb347" : "#9fe8ff";
};
const label = (c: SideClock) => `${c.conf < 0.3 ? "?" : c.conf < 0.7 ? "~" : ""}${fmtClock(c.ms, c.conf >= 0.7)}`;
const fraction = (c: SideClock, e: ClockEstimate) => (e.control.baseMs > 0 ? Math.min(1, Math.max(0, c.ms / e.control.baseMs)) : 1);
/** The seat each colour sits at: white plays from the bottom (+y), black from the top. */
const SEAT = { w: { y: 9.6, rot: 0 }, b: { y: -1.6, rot: 180 } } as const;

/**
 * Draws the clock onto the projected table overlay, in board units (board = 0..8, ctx already translated by the margin).
 * `px` is pixels per board unit. Black's side is rotated so each player reads it the right way up.
 */
export function drawClockOverlay(ctx: CanvasRenderingContext2D, px: number, o: ClockOverlay, t: number, lowMs = 60000, critMs = 15000) {
  const e = o.clock;
  const sides = [["w", e.white], ["b", e.black]] as const;
  ctx.save();
  ctx.lineCap = "round"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  if (o.mode === "square") {
    // an outline just outside the board; each player's half is their own time, draining toward their right-hand corner
    const x0 = -0.35 * px, y0 = -0.35 * px, s = 8.7 * px, perimHalf = s * 2;
    for (const [side, c] of sides) {
      const st = style(c.conf), f = fraction(c, e);
      ctx.strokeStyle = urgency(c, t, lowMs, critMs); ctx.globalAlpha = o.showCert ? st.alpha : 1; ctx.lineWidth = px * 0.14; ctx.setLineDash(o.showCert ? st.dash.map((d) => d * px * 0.05) : []);
      ctx.beginPath();
      const pts = side === "w" ? [[x0, y0 + s], [x0 + s, y0 + s], [x0 + s, y0]] : [[x0 + s, y0], [x0, y0], [x0, y0 + s]]; // bottom + right edge, top + left edge
      let left = perimHalf * f; ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length && left > 0; i++) {
        const [ax, ay] = pts[i - 1], [bx, by] = pts[i], len = Math.hypot(bx - ax, by - ay), k = Math.min(1, left / len);
        ctx.lineTo(ax + (bx - ax) * k, ay + (by - ay) * k); left -= len;
      }
      ctx.stroke();
      if (o.showCert || o.mode === "square") { const [, py] = side === "w" ? [0, y0 + s + px * 0.55] : [0, y0 - px * 0.55]; ctx.globalAlpha = 1; ctx.setLineDash([]); ctx.save(); ctx.translate(4 * px, py); ctx.rotate((SEAT[side].rot * Math.PI) / 180); ctx.fillStyle = urgency(c, t, lowMs, critMs); ctx.font = `700 ${px * 0.42}px ui-monospace,monospace`; ctx.fillText(label(c), 0, 0); ctx.restore(); }
    }
  } else {
    for (const [side, c] of sides) {
      const st = style(c.conf), cx = 4 * px, cy = (SEAT[side].y - 0.4 * (side === "w" ? 1 : -1) * 0) * px, col = urgency(c, t, lowMs, critMs);
      ctx.save(); ctx.translate(cx, cy); ctx.rotate((SEAT[side].rot * Math.PI) / 180);
      ctx.globalAlpha = o.showCert ? Math.max(0.5, st.alpha) : 1;
      if (o.mode === "circle") {
        const r = px * 0.75, f = fraction(c, e), run = e.running === side;
        ctx.strokeStyle = "rgba(160,190,230,.25)"; ctx.lineWidth = px * 0.14; ctx.setLineDash([]); ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = col; ctx.setLineDash(o.showCert ? st.dash.map((d) => d * px * 0.04) : []); ctx.beginPath(); ctx.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        if (run) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, -r, px * 0.1, 0, 7); ctx.fill(); }
        ctx.fillStyle = col; ctx.globalAlpha = 1; ctx.font = `700 ${px * 0.36}px ui-monospace,monospace`; ctx.fillText(label(c), 0, 0);
      } else {
        ctx.fillStyle = col; ctx.font = `700 ${px * 0.78}px ui-monospace,monospace`; ctx.shadowColor = "rgba(0,0,0,.6)"; ctx.shadowBlur = px * 0.1;
        ctx.fillText(label(c), 0, 0);
        if (e.running === side) { ctx.shadowBlur = 0; ctx.fillRect(-px * 1.2, px * 0.55, px * 2.4, px * 0.07); }
      }
      if (o.showCert) {
        ctx.shadowBlur = 0; ctx.globalAlpha = 0.9; ctx.fillStyle = "#bdd1e8"; ctx.font = `${px * 0.2}px system-ui`;
        const pct = `${Math.round(c.conf * 100)}%`, range = c.conf < 0.7 ? ` ±${Math.max(1, Math.round(c.sigmaMs / 1000))}s` : "";
        ctx.fillText(`${pct}${range}`, 0, o.mode === "circle" ? px * 1.05 : px * 0.88);
      }
      ctx.restore();
    }
  }
  ctx.restore();
}
