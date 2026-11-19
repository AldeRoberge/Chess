import { drawFrame, fmtCorners, parseCorners } from "../plugins/shared";
import { findBoardCorners, findCheckerCorners, orientBoardCorners } from "../vision/findBoard";
import type { GrayFrame, Pt } from "../vision/types";
import { AlignFollower, AutoAligner, rememberLayout, rememberedLayouts } from "./autoAlign";
import { squareToQuad } from "./quadMap";
import { AlignmentMeter, alignColor, drawEdgeIcons, drawMatrixGround, iconLevels, readPerspective, scoreAlignment } from "./boardGuide";
import { COACH_LABEL, drawPlacementMoves, placementMoves, type PieceMove } from "./pieceCoach";

export { squareToQuad };

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
  // alignment readout: a bar and a sentence that go from orange to green as the grid settles onto the squares
  const meterBox = document.createElement("div"); meterBox.className = "qe-meter"; meterBox.hidden = o.grid <= 1;
  const meterBar = document.createElement("div"); meterBar.className = "qe-meter-bar"; const meterFill = document.createElement("i"); meterBar.append(meterFill);
  const meterText = document.createElement("span"); meterText.setAttribute("role", "status"); meterBox.append(meterBar, meterText);
  const meter = new AlignmentMeter();
  // auto-align readout at the bottom: how far the search has got, and how sure we are of the result
  const mkRow = (name: string) => {
    const row = document.createElement("div"); row.className = "qe-auto-row";
    const lab = document.createElement("span"); lab.className = "qe-auto-name"; lab.textContent = name;
    const track = document.createElement("div"); track.className = "qe-auto-bar"; const fill = document.createElement("i"); track.append(fill);
    const val = document.createElement("span"); val.className = "qe-auto-val"; row.append(lab, track, val);
    return { row, fill, val };
  };
  const autoBox = document.createElement("div"); autoBox.className = "qe-auto"; autoBox.hidden = o.grid <= 1;
  const progRow = mkRow("Progress"), confRow = mkRow("Confidence"); autoBox.append(progRow.row, confRow.row);
  let follow = true; const followBtn = btn("Try following camera: on");
  followBtn.title = "When the camera is nudged, ease the grid so it stays on the board";
  followBtn.onclick = () => { follow = !follow; followBtn.textContent = `Try following camera: ${follow ? "on" : "off"}`; follower.unlock(); };
  let matrix = true; const matrixBtn = btn("Matrix: on");
  matrixBtn.title = "Show the detected perspective lines as a transparent ground";
  matrixBtn.onclick = () => { matrix = !matrix; matrixBtn.textContent = `Matrix: ${matrix ? "on" : "off"}`; };
  opts.append(followBtn, matrixBtn); followBtn.hidden = o.grid <= 1; matrixBtn.hidden = o.grid <= 1;
  const follower = new AlignFollower();
  let aligner: AutoAligner | null = null, doneConf = 0, progress = 0, status = "";
  box.append(head, hint, cv, meterBox, autoBox, bar, opts); back.append(box); document.body.append(back);

  const ctx = cv.getContext("2d")!;
  const sx = W / fw, sy = H / fh;
  let sel = 0, raf = 0, closed = false, levels: number[] | undefined, levelsAt = 0, ground: ReturnType<typeof readPerspective> = null, groundAt = 0;
  let coach: PieceMove[] = [], coachAt = 0;
  const emit = () => o.change(fmtCorners(pts));
  const paint = () => {
    if (closed) return;
    drawFrame(ctx, W, H, o.frame(), "no camera frame yet — connect a camera to this node");
    const m = squareToQuad(pts), P = (u: number, v: number) => { const p = m(u, v); return { x: p.x * sx, y: p.y * sy }; };
    // How well the grid sits on the squares decides its colour: orange while it is off, green once it fits.
    const fr = o.frame();
    if (o.grid > 1 && fr) meter.feed(scoreAlignment(fr, m));
    // Pieces off their home squares are a placement problem. Say so, and don't blame the square colours for it.
    const nowCoach = performance.now();
    if (o.grid > 1 && fr && nowCoach - coachAt > 350 && meter.contrast >= 8 && meter.q >= 0.35) {
      coachAt = nowCoach;
      try { const next = placementMoves(fr, pts); if (next) coach = next; } catch { /* keep the last reading */ }
    }
    if (!fr || o.grid <= 1) coach = [];
    // The auto-aligner works a few milliseconds per frame and shows each layout it tries; the follower re-fits after a camera nudge.
    if (aligner) {
      aligner.step(10);
      if (aligner.changed) { aligner.changed = false; pts = aligner.corners.map((p) => ({ ...p })); emit(); }
      progress = aligner.progress; status = aligner.label; doneConf = aligner.confidence;
      if (aligner.done) {
        if (aligner.phase === "done") {
          const pic = fr ?? o.frame();
          if (pic) { rememberLayout(pts, pic.width, pic.height); follower.lock(pic, pts); }
        }
        aligner = null; auto.textContent = "Auto detect";
      }
    } else if (o.grid > 1 && fr && follow) {
      if (!follower.locked) { if (meter.good) follower.lock(fr, pts); }
      else {
        const fixed = follower.tick(fr, pts);
        if (fixed) { pts = fixed; emit(); status = follower.status === "adjusting" ? "Following the camera…" : "Camera moved: grid adjusted"; }
        else if (follower.status === "adjusting") status = "Camera moved: re-fitting…";
        else if (follower.status === "lost") { follower.unlock(); startAuto(); }
      }
    }
    const live = o.grid > 1 && !!fr;
    if (!autoBox.hidden) {
      const running = !!aligner, conf = running ? doneConf : live ? Math.min(meter.q, doneConf || 1) : 0;
      progRow.fill.style.width = `${Math.round((running ? progress : progress || 0) * 100)}%`; progRow.val.textContent = status || "Idle";
      confRow.fill.style.width = `${Math.round(conf * 100)}%`; confRow.fill.style.background = alignColor(conf); confRow.val.textContent = `${Math.round(conf * 100)}%`;
    }
    const color = live ? alignColor(meter.q) : "#35e0b4";
    if (!meterBox.hidden) {
      meterFill.style.width = `${Math.round((live ? meter.q : 0) * 100)}%`; meterFill.style.background = color;
      const text = !live ? "No camera picture to check against." : coach.length ? COACH_LABEL : meter.label; if (meterText.textContent !== text) meterText.textContent = text;
      meterBox.classList.toggle("good", live && meter.good);
    }
    // The traced square edges, drawn as a transparent ground so the picture shows through them.
    const nowGround = performance.now();
    if (o.grid > 1 && fr && matrix && nowGround - groundAt > 180) { groundAt = nowGround; try { ground = readPerspective(fr, pts); } catch { ground = null; } }
    if (!fr || !matrix) ground = null;
    if (ground) drawMatrixGround(ctx, ground, (p) => ({ x: p.x * sx, y: p.y * sy }));
    // Casing first (the inverse of the picture, or dark), so the coloured line reads on light and dark squares alike.
    const lines = (draw: () => void) => { for (let i = 0; i <= o.grid && o.grid > 1; i++) { const t = i / o.grid; for (const [a, b] of [[P(t, 0), P(t, 1)], [P(0, t), P(1, t)]]) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); draw(); } } };
    const outline = () => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x * sx, p.y * sy) : ctx.moveTo(p.x * sx, p.y * sy))); ctx.closePath(); };
    ctx.save();
    if (negative) { ctx.globalCompositeOperation = "difference"; ctx.strokeStyle = "#fff"; } else ctx.strokeStyle = "rgba(0,0,0,.5)";
    ctx.lineWidth = 4; lines(() => ctx.stroke()); outline(); ctx.stroke();
    ctx.restore(); ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; lines(() => ctx.stroke());
    ctx.lineWidth = 3; outline(); ctx.stroke();
    ctx.restore();
    if (o.grid > 1) {
      // Read the pieces under the grid a few times a second; each icon's outline fills with how sure that piece is.
      const now = performance.now();
      if (fr && now - levelsAt > 250) { levelsAt = now; try { levels = iconLevels(fr, pts, meter.q); } catch { levels = undefined; } }
      drawEdgeIcons(ctx, P, color, fr ? levels : undefined);
      if (coach.length) drawPlacementMoves(ctx, P, coach, now);
    }
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
    aligner = null; auto.textContent = "Auto detect"; follower.unlock(); status = "";
    pts[sel] = clamp(p); emit();
    const move = (ev: PointerEvent) => { pts[sel] = clamp(at(ev)); emit(); };
    const up = () => { cv.removeEventListener("pointermove", move); cv.removeEventListener("pointerup", up); };
    cv.addEventListener("pointermove", move); cv.addEventListener("pointerup", up);
  });
  const close = (keep: boolean) => {
    if (closed) return;
    if (keep) { const pic = o.frame(); if (pic) rememberLayout(pts, pic.width, pic.height); }
    closed = true; cancelAnimationFrame(raf); back.remove(); document.removeEventListener("keydown", key, true); if (!keep) o.change(start); o.done();
  };
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
  const startAuto = () => {
    const fr = o.frame();
    if (fr && o.names.length === 4 && o.names[0] === "a8" && o.names[1] === "h8" && o.names[2] === "h1" && o.names[3] === "a1") {
      let seed: Pt[] | null = null;
      try { const q = findCheckerCorners(fr); seed = q ? orientBoardCorners(fr, q) : null; } catch { seed = null; }
      follower.unlock(); progress = 0; doneConf = 0;
      rememberLayout(pts, fr.width, fr.height);
      aligner = new AutoAligner(fr, seed ?? pts, 140, undefined, rememberedLayouts(fr.width, fr.height)); auto.textContent = "Stop";
      return;
    }
    legacyAuto();
  };
  auto.onclick = () => { if (aligner) { aligner = null; status = "Stopped"; auto.textContent = "Auto detect"; } else startAuto(); };
  const legacyAuto = () => {
    const fr = o.frame();
    // Board corners are a8, h8, h1, a1. A clock box is just a busy rectangle and keeps the older finder.
    const chess = o.names.length === 4 && o.names[0] === "a8" && o.names[1] === "h8" && o.names[2] === "h1" && o.names[3] === "a1";
    let found: Pt[] | null = null;
    if (fr && chess) { const q = findCheckerCorners(fr); found = q ? orientBoardCorners(fr, q) : null; }
    else if (fr) found = findBoardCorners(fr);
    if (found) { pts = found; emit(); auto.textContent = "Auto detect"; return; }
    auto.textContent = fr ? "No board found" : "No camera frame";
    clearTimeout(autoTimer); autoTimer = window.setTimeout(() => { auto.textContent = "Auto detect"; }, 2000);
  };
  reset.onclick = () => { pts = parseCorners(start) ?? pts; emit(); };
  paint(); cv.focus();
}
