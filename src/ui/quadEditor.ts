import { withIcon, setLabel, setPressed } from "./icons";
import { drawFrame, fmtCorners, parseCorners } from "../plugins/shared";
import { findBoardCorners, findCheckerCorners, orientBoardCorners } from "../vision/findBoard";
import type { GrayFrame, Pt } from "../vision/types";
import { labelHints } from "../vision/boardLabels";
import { AlignFollower, AutoAligner, rememberLayout, rememberedLayouts } from "./autoAlign";
import { squareToQuad } from "./quadMap";
import { AlignmentMeter, alignColor, drawEdgeIcons, drawMatrixGround, iconLevels, piecesLookTurned, readPerspective, scoreAlignment } from "./boardGuide";
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

/** The rotate handle sits this far (canvas pixels) outside the middle of the a8-h8 edge, like the one on an image in Canva. */
const ROT_OFF = 40, ROT_R = 11;

/** Corner marker colours: one scheme for all four corners (their labels tell them apart). */
const CORNER_GOOD = "#35e07a", CORNER_WARN = "#ff9a3c", CORNER_IDLE = "#cfd8e3";

/** Modal with the camera picture and four draggable corner handles. Cancel restores the value it opened with. */
export function openQuadEditor(o: QuadEditorOpts) {
  const start = o.value;
  const f0 = o.frame();
  const fw = f0?.width ?? 320, fh = f0?.height ?? 240;
  let pts = parseCorners(o.value) ?? [{ x: fw * 0.25, y: fh * 0.2 }, { x: fw * 0.75, y: fh * 0.2 }, { x: fw * 0.75, y: fh * 0.8 }, { x: fw * 0.25, y: fh * 0.8 }];

  const back = document.createElement("div"); back.className = "qe-back";
  const box = document.createElement("div"); box.className = "qe";
  const head = document.createElement("div"); head.className = "qe-head"; head.textContent = o.title;
  const hint = document.createElement("div"); hint.className = "qe-hint"; hint.textContent = "Drag the four handles onto the corners, or turn the whole grid with the round handle above it (Shift = 15° steps). Arrow keys nudge the selected corner (Shift = 10 px).";
  const cv = document.createElement("canvas"); cv.className = "qe-cv"; cv.tabIndex = 0;
  const W = 720, H = Math.round((W * fh) / fw); cv.width = W; cv.height = H; cv.style.aspectRatio = `${fw} / ${fh}`;
  // The picture sits in a stage that shrinks to whatever height is left, so the dialog fits short and odd-shaped screens without scrolling.
  const stage = document.createElement("div"); stage.className = "qe-stage"; stage.append(cv);
  box.style.setProperty("--qe-ar", String(fw / fh));
  const bar = document.createElement("div"); bar.className = "qe-bar";
  const btn = (t: string, cls = "") => { const b = document.createElement("button"); b.className = "qe-btn " + cls; b.textContent = t; return withIcon(b, ({ "Auto detect": "scan", Reset: "undo", Cancel: "x", Done: "check", "Negative grid: on": "contrast", "Try following camera: on": "camera", "Matrix: on": "grid" } as Record<string, string>)[t] ?? "scan"); };
  const auto = btn("Auto detect"), reset = btn("Reset"), cancel = btn("Cancel"), ok = btn("Done", "primary");
  let negative = true;
  const neg = btn("Negative grid: on");
  neg.title = "Draw the grid as the inverse of the camera picture so it stays visible on light and dark squares";
  setPressed(neg, negative);
  neg.onclick = () => { negative = !negative; setPressed(neg, negative); setLabel(neg, `Negative grid: ${negative ? "on" : "off"}`); };
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
  let follow = false; const followBtn = btn("Try following camera: off");
  followBtn.title = "When the camera is nudged, ease the grid so it stays on the board";
  setPressed(followBtn, follow);
  followBtn.onclick = () => { follow = !follow; setPressed(followBtn, follow); setLabel(followBtn, `Try following camera: ${follow ? "on" : "off"}`); follower.unlock(); };
  let matrix = true; const matrixBtn = btn("Matrix: on");
  matrixBtn.title = "Show the detected perspective lines as a transparent ground";
  setPressed(matrixBtn, matrix);
  matrixBtn.onclick = () => { matrix = !matrix; setPressed(matrixBtn, matrix); setLabel(matrixBtn, `Matrix: ${matrix ? "on" : "off"}`); };
  opts.append(followBtn, matrixBtn); followBtn.hidden = o.grid <= 1; matrixBtn.hidden = o.grid <= 1;
  const follower = new AlignFollower();
  let aligner: AutoAligner | null = null, doneConf = 0, progress = 0, status = "";
  // Shown when the grid fits but white pieces stand where black ones should: one click turns the corner order half way.
  const turnBtn = btn("Pieces look turned: flip the corners"); turnBtn.hidden = true; setLabel(turnBtn, "Pieces look turned: flip the corners");
  turnBtn.title = "The grid sits on the board, but the white pieces are where the black ones should be. Turn the corners half way (a8↔h1, h8↔a1).";
  let turnVotes = 0;
  turnBtn.onclick = () => { pts = [pts[2], pts[3], pts[0], pts[1]]; turnVotes = 0; turnBtn.hidden = true; emit(); };
  const side = document.createElement("div"); side.className = "qe-side"; meterBox.append(turnBtn); side.append(meterBox, autoBox, bar, opts);
  box.append(head, hint, stage, side); back.append(box); document.body.append(back);

  const ctx = cv.getContext("2d")!;
  const sx = W / fw, sy = H / fh;
  let sel = 0, raf = 0, closed = false, levels: number[] | undefined, levelsAt = 0, ground: ReturnType<typeof readPerspective> = null, groundAt = 0;
  let coach: PieceMove[] = [], coachAt = 0;
  let turning: { from: number; shown: number } | null = null; // the rotate handle is being dragged: the angle turned so far (radians)
  /** Where the rotate handle is on the canvas: outside the middle of the first edge, away from the centre. */
  const rotHandle = () => {
    const c = pts.reduce((a, p) => ({ x: a.x + (p.x * sx) / 4, y: a.y + (p.y * sy) / 4 }), { x: 0, y: 0 });
    const m = { x: ((pts[0].x + pts[1].x) / 2) * sx, y: ((pts[0].y + pts[1].y) / 2) * sy };
    const dx = m.x - c.x, dy = m.y - c.y, d = Math.hypot(dx, dy) || 1;
    return { c, m, h: { x: m.x + (dx / d) * ROT_OFF, y: m.y + (dy / d) * ROT_OFF } };
  };
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
        aligner = null; setLabel(auto, "Auto detect");
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
      if (fr && now - levelsAt > 250) {
        levelsAt = now; try { levels = iconLevels(fr, pts, meter.q); } catch { levels = undefined; }
        // A few reads in a row, on a grid that fits, before suggesting the flip, so a passing hand does not trigger it.
        const board = o.names[0] === "a8" && o.names[2] === "h1";
        turnVotes = board && meter.good && !aligner && piecesLookTurned(fr, pts) ? Math.min(turnVotes + 1, 6) : Math.max(turnVotes - 2, 0);
        turnBtn.hidden = turnVotes < 3;
      }
      drawEdgeIcons(ctx, P, color, fr ? levels : undefined);
      if (coach.length) drawPlacementMoves(ctx, P, coach, now);
    }
    if (o.grid > 1) { // rotate handle
      const { m, h } = rotHandle();
      ctx.save(); ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(h.x, h.y); ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.strokeStyle = "#07090d"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(h.x, h.y, ROT_R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = "#07090d"; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(h.x, h.y, ROT_R * 0.5, -Math.PI * 0.2, Math.PI * 1.35); ctx.stroke();
      const ax = h.x + Math.cos(-Math.PI * 0.2) * ROT_R * 0.5, ay = h.y + Math.sin(-Math.PI * 0.2) * ROT_R * 0.5;
      ctx.fillStyle = "#07090d"; ctx.beginPath(); ctx.moveTo(ax - 3.5, ay - 1); ctx.lineTo(ax + 3.5, ay - 1); ctx.lineTo(ax + 0.5, ay + 4); ctx.closePath(); ctx.fill();
      if (turning) { const deg = Math.round((turning.shown * 180) / Math.PI), t = `${deg > 0 ? "+" : ""}${deg}°`; ctx.font = '600 12px "IBM Plex Mono",ui-monospace,monospace'; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillStyle = "#fff"; ctx.strokeStyle = "#07090d"; ctx.lineWidth = 3; ctx.strokeText(t, h.x + 16, h.y); ctx.fillText(t, h.x + 16, h.y); }
      ctx.restore();
    }
    ctx.font = '600 12px "IBM Plex Mono",ui-monospace,monospace'; ctx.textBaseline = "middle";
    // Green once the grid fits (or the camera follower has it locked), orange while it still needs work, grey with no picture.
    const cornerCol = !live ? CORNER_IDLE : meter.good || follower.locked ? CORNER_GOOD : CORNER_WARN;
    pts.forEach((p, i) => {
      const x = p.x * sx, y = p.y * sy, r = i === sel ? 9 : 7;
      ctx.fillStyle = cornerCol; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = "#07090d"; ctx.stroke();
      if (i === sel) { ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.beginPath(); ctx.arc(x, y, r + 3, 0, Math.PI * 2); ctx.stroke(); }
      ctx.fillStyle = "#fff"; ctx.strokeStyle = "#07090d"; ctx.lineWidth = 3; ctx.strokeText(o.names[i], x + 12, y - 10); ctx.fillText(o.names[i], x + 12, y - 10);
    });
    raf = requestAnimationFrame(paint);
  };

  const at = (e: PointerEvent) => { const r = cv.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * fw, y: ((e.clientY - r.top) / r.height) * fh }; };
  const clamp = (p: Pt): Pt => ({ x: Math.min(fw, Math.max(0, p.x)), y: Math.min(fh, Math.max(0, p.y)) });
  cv.addEventListener("pointerdown", (e) => {
    if (o.grid > 1) { // the rotate handle turns the whole grid about its centre
      const r = cv.getBoundingClientRect(), cx = ((e.clientX - r.left) / r.width) * W, cy = ((e.clientY - r.top) / r.height) * H, { c, h } = rotHandle();
      if (Math.hypot(cx - h.x, cy - h.y) <= ROT_R + 5) {
        cv.setPointerCapture(e.pointerId); cv.focus(); e.preventDefault();
        aligner = null; setLabel(auto, "Auto detect"); follower.unlock(); status = "";
        const base = pts.map((q) => ({ ...q })), a0 = Math.atan2(cy - c.y, cx - c.x);
        turning = { from: a0, shown: 0 };
        const move = (ev: PointerEvent) => {
          const mx = ((ev.clientX - r.left) / r.width) * W, my = ((ev.clientY - r.top) / r.height) * H;
          let d = Math.atan2(my - c.y, mx - c.x) - a0;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          if (ev.shiftKey) d = Math.round(d / (Math.PI / 12)) * (Math.PI / 12);
          turning = { from: a0, shown: d };
          pts = turnQuad(base, { x: c.x / sx, y: c.y / sy }, d, sx, sy); emit();
        };
        const up = () => { turning = null; cv.removeEventListener("pointermove", move); cv.removeEventListener("pointerup", up); cv.removeEventListener("pointercancel", up); };
        cv.addEventListener("pointermove", move); cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
        return;
      }
    }
    const p = at(e); let best = 0, bd = Infinity;
    pts.forEach((q, i) => { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; best = i; } });
    sel = best; cv.setPointerCapture(e.pointerId); cv.focus();
    aligner = null; setLabel(auto, "Auto detect"); follower.unlock(); status = "";
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
      aligner = new AutoAligner(fr, seed ?? pts, 140, undefined, rememberedLayouts(fr.width, fr.height)); aligner.expectLabels(labelHints(fr)); setLabel(auto, "Stop");
      return;
    }
    legacyAuto();
  };
  auto.onclick = () => { if (aligner) { aligner = null; status = "Stopped"; setLabel(auto, "Auto detect"); } else startAuto(); };
  const legacyAuto = () => {
    const fr = o.frame();
    // Board corners are a8, h8, h1, a1. A clock box is just a busy rectangle and keeps the older finder.
    const chess = o.names.length === 4 && o.names[0] === "a8" && o.names[1] === "h8" && o.names[2] === "h1" && o.names[3] === "a1";
    let found: Pt[] | null = null;
    if (fr && chess) { const q = findCheckerCorners(fr); found = q ? orientBoardCorners(fr, q) : null; }
    else if (fr) found = findBoardCorners(fr);
    if (found) { pts = found; emit(); setLabel(auto, "Auto detect"); return; }
    setLabel(auto, fr ? "No board found" : "No camera frame");
    clearTimeout(autoTimer); autoTimer = window.setTimeout(() => { setLabel(auto, "Auto detect"); }, 2000);
  };
  reset.onclick = () => { pts = parseCorners(start) ?? pts; emit(); };
  paint(); cv.focus();
}

/** The quad turned by `angle` (radians, clockwise on screen) about `c` (frame pixels). The turn is done in canvas pixels (`sx`, `sy` per frame pixel) so the grid does not shear. */
export function turnQuad(q: Pt[], c: Pt, angle: number, sx = 1, sy = 1): Pt[] {
  const cs = Math.cos(angle), sn = Math.sin(angle);
  return q.map((p) => { const dx = (p.x - c.x) * sx, dy = (p.y - c.y) * sy; return { x: c.x + (dx * cs - dy * sn) / sx, y: c.y + (dx * sn + dy * cs) / sy }; });
}
