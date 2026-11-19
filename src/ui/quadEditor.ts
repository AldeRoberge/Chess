import { drawFrame, fmtCorners, parseCorners } from "../plugins/shared";
import type { GrayFrame, Pt } from "../vision/types";
import { findBoardCorners } from "../vision/findBoard";

/** Projective map of the unit square onto a quad (Heckbert), so the board grid is drawn in true perspective. */
export function squareToQuad(q: Pt[]): (u: number, v: number) => Pt {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dy1 = p1.y - p2.y, dy2 = p3.y - p2.y;
  const sx = p0.x - p1.x + p2.x - p3.x, sy = p0.y - p1.y + p2.y - p3.y;
  const det = dx1 * dy2 - dx2 * dy1;
  const g = Math.abs(det) < 1e-9 ? 0 : (sx * dy2 - dx2 * sy) / det, hh = Math.abs(det) < 1e-9 ? 0 : (dx1 * sy - sx * dy1) / det;
  const a = p1.x - p0.x + g * p1.x, b = p3.x - p0.x + hh * p3.x, c = p0.x, d = p1.y - p0.y + g * p1.y, e = p3.y - p0.y + hh * p3.y, f = p0.y;
  return (u, v) => { const w = g * u + hh * v + 1; return { x: (a * u + b * v + c) / w, y: (d * u + e * v + f) / w }; };
}

export interface QuadEditorOpts {
  title: string;
  value: string;
  /** Corner names in order, e.g. a8,h8,h1,a1. */
  names: string[];
  /** 8 draws a chessboard grid in perspective; 1 just outlines the box. */
  grid: number;
  /** Latest camera frame (called every repaint so the picture stays live). */
  frame: () => GrayFrame | null;
  /** Called on every change while dragging. */
  change: (v: string) => void;
  done: () => void;
}

const COL = ["#ffd35a", "#35e0b4", "#7fd4ff", "#ff8a5a"];

/** Modal with the camera picture and four draggable corner handles. Cancel restores the value it opened with. */
export function openQuadEditor(o: QuadEditorOpts) {
  const start = o.value;
  const f0 = o.frame();
  const fw = f0?.width ?? 320, fh = f0?.height ?? 240;
  let pts = parseCorners(o.value) ?? [{ x: fw * 0.25, y: fh * 0.2 }, { x: fw * 0.75, y: fh * 0.2 }, { x: fw * 0.75, y: fh * 0.8 }, { x: fw * 0.25, y: fh * 0.8 }];

  const back = document.createElement("div"); back.className = "qe-back";
  const box = document.createElement("div"); box.className = "qe";
  const head = document.createElement("div"); head.className = "qe-head"; head.textContent = o.title;
  const hint = document.createElement("div"); hint.className = "qe-hint"; hint.textContent = "Drag the four handles onto the corners. Arrow keys nudge the selected one (Shift = 10 px).";
  const cv = document.createElement("canvas"); cv.className = "qe-cv"; cv.tabIndex = 0;
  const W = 720, H = Math.round((W * fh) / fw); cv.width = W; cv.height = H; cv.style.aspectRatio = `${fw} / ${fh}`;
  const bar = document.createElement("div"); bar.className = "qe-bar";
  const btn = (t: string, cls = "") => { const b = document.createElement("button"); b.className = "qe-btn " + cls; b.textContent = t; return b; };
  const auto = btn("Auto detect"), reset = btn("Reset"), cancel = btn("Cancel"), ok = btn("Done", "primary");
  let negative = true;
  const neg = btn("Negative grid: on");
  neg.title = "Draw the grid as the inverse of the camera picture so it stays visible on light and dark squares";
  neg.onclick = () => { negative = !negative; neg.textContent = `Negative grid: ${negative ? "on" : "off"}`; };
  bar.append(auto, reset, cancel, ok);
  const opts = document.createElement("div"); opts.className = "qe-bar"; opts.append(neg);
  box.append(head, hint, cv, bar, opts); back.append(box); document.body.append(back);

  const ctx = cv.getContext("2d")!;
  const sx = W / fw, sy = H / fh;
  let sel = 0, raf = 0, closed = false;
  const emit = () => o.change(fmtCorners(pts));
  const paint = () => {
    if (closed) return;
    drawFrame(ctx, W, H, o.frame(), "no camera frame yet — connect a camera to this node");
    const m = squareToQuad(pts), P = (u: number, v: number) => { const p = m(u, v); return { x: p.x * sx, y: p.y * sy }; };
    // Negative mode: white lines under "difference" blending give the inverse of the picture beneath them.
    ctx.save();
    if (negative) { ctx.globalCompositeOperation = "difference"; ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; }
    else { ctx.lineWidth = 1; ctx.strokeStyle = "rgba(53,224,180,.55)"; }
    for (let i = 0; i <= o.grid && o.grid > 1; i++) {
      const t = i / o.grid;
      for (const [a, b] of [[P(t, 0), P(t, 1)], [P(0, t), P(1, t)]]) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    }
    ctx.lineWidth = 2; ctx.strokeStyle = negative ? "#fff" : "#35e0b4"; ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x * sx, p.y * sy) : ctx.moveTo(p.x * sx, p.y * sy))); ctx.closePath(); ctx.stroke();
    ctx.restore();
    ctx.font = '600 12px "IBM Plex Mono",ui-monospace,monospace'; ctx.textBaseline = "middle";
    pts.forEach((p, i) => {
      const x = p.x * sx, y = p.y * sy;
      ctx.fillStyle = COL[i]; ctx.beginPath(); ctx.arc(x, y, i === sel ? 9 : 7, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = "#07090d"; ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.strokeStyle = "#07090d"; ctx.lineWidth = 3; ctx.strokeText(o.names[i], x + 12, y - 10); ctx.fillText(o.names[i], x + 12, y - 10);
    });
    raf = requestAnimationFrame(paint);
  };

  const at = (e: PointerEvent) => { const r = cv.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * fw, y: ((e.clientY - r.top) / r.height) * fh }; };
  const clamp = (p: Pt): Pt => ({ x: Math.min(fw, Math.max(0, p.x)), y: Math.min(fh, Math.max(0, p.y)) });
  cv.addEventListener("pointerdown", (e) => {
    const p = at(e); let best = 0, bd = Infinity;
    pts.forEach((q, i) => { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; best = i; } });
    sel = best; cv.setPointerCapture(e.pointerId); cv.focus();
    pts[sel] = clamp(p); emit();
    const move = (ev: PointerEvent) => { pts[sel] = clamp(at(ev)); emit(); };
    const up = () => { cv.removeEventListener("pointermove", move); cv.removeEventListener("pointerup", up); };
    cv.addEventListener("pointermove", move); cv.addEventListener("pointerup", up);
  });
  const close = (keep: boolean) => { if (closed) return; closed = true; cancelAnimationFrame(raf); back.remove(); document.removeEventListener("keydown", key, true); if (!keep) o.change(start); o.done(); };
  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); close(false); return; }
    if (e.key === "Enter") { e.preventDefault(); close(true); return; }
    const step = e.shiftKey ? 10 : 1, d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (d[e.key]) { e.preventDefault(); pts[sel] = clamp({ x: pts[sel].x + d[e.key][0], y: pts[sel].y + d[e.key][1] }); emit(); }
    else if (e.key >= "1" && e.key <= "4") sel = Number(e.key) - 1;
  };
  document.addEventListener("keydown", key, true);
  back.addEventListener("pointerdown", (e) => { if (e.target === back) close(false); });
  ok.onclick = () => close(true); cancel.onclick = () => close(false);
  let autoTimer = 0;
  auto.onclick = () => {
    const fr = o.frame(), found = fr ? findBoardCorners(fr) : null;
    if (found) { pts = found; emit(); auto.textContent = "Auto detect"; return; }
    auto.textContent = fr ? "No board found" : "No camera frame";
    clearTimeout(autoTimer); autoTimer = window.setTimeout(() => { auto.textContent = "Auto detect"; }, 2000);
  };
  reset.onclick = () => { pts = parseCorners(start) ?? pts; emit(); };
  paint(); cv.focus();
}
