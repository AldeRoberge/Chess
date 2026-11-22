export interface P2 { x: number; y: number }

/**
 * Animated marching chevrons (>>>) from `a` to `b`, in whatever pixel space the context uses.
 * `unit` is roughly one board square in that space; `t` is seconds (drives the march + pulse).
 * Used for "move this physical piece" guidance (bot move, chess.com opponent) on the table
 * overlay, the projector and the camera preview.
 */
export function drawChevrons(ctx: CanvasRenderingContext2D, a: P2, b: P2, unit: number, t: number, color = "60,255,160") {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  if (len < 1e-3) return;
  const ux = dx / len, uy = dy / len, ang = Math.atan2(dy, dx);
  const gap = unit * 0.38, size = unit * 0.2, margin = unit * 0.35;
  const pulse = 0.5 + 0.5 * Math.sin(t * 4);
  ctx.save();
  ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.lineWidth = Math.max(1.5, unit * 0.08);
  // "pick up here" / "put down here" rings
  ctx.strokeStyle = `rgba(${color},${0.5 + 0.4 * pulse})`;
  ctx.beginPath(); ctx.arc(a.x, a.y, unit * (0.32 + 0.06 * pulse), 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([unit * 0.1, unit * 0.1]);
  ctx.beginPath(); ctx.arc(b.x, b.y, unit * (0.34 + 0.06 * pulse), 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  // marching chevrons between the two squares
  const span = len - margin * 2;
  if (span > gap * 0.5) {
    const phase = (t * 1.2) % 1;
    // the chevron's corners are computed directly (same geometry as translate + rotate, without a save/restore per chevron)
    const cs = Math.cos(ang), sn = Math.sin(ang), hx = size * 0.6;
    for (let d = margin + phase * gap; d < len - margin; d += gap) {
      const k = (d - margin) / span; // fade in at the source, out at the target
      const alpha = Math.sin(Math.min(1, Math.max(0, k)) * Math.PI) * 0.9 + 0.1;
      const ox = a.x + ux * d, oy = a.y + uy * d;
      ctx.strokeStyle = `rgba(${color},${alpha})`;
      ctx.beginPath();
      ctx.moveTo(ox - hx * cs + size * sn, oy - hx * sn - size * cs);
      ctx.lineTo(ox + hx * cs, oy + hx * sn);
      ctx.lineTo(ox - hx * cs - size * sn, oy - hx * sn + size * cs);
      ctx.stroke();
    }
  }
  ctx.restore();
}
