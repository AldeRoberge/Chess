import { withIcon, setLabel, setPressed } from "./icons";
import { drawFrame, fmtCorners, parseCorners } from "../plugins/shared";
import { findBoardCorners, findCheckerCorners, orientBoardCorners } from "../vision/findBoard";
import type { GrayFrame, Pt } from "../vision/types";
import { labelHints, ocrReportOf } from "../vision/boardLabels";
import { alignPrefs, setAlignPref } from "./alignPrefs";
import { AlignFollower, AutoAligner, rememberLayout, rememberedLayouts } from "./autoAlign";
import { quadToSquare, squareToQuad } from "./quadMap";
import { pickTurnBase, turnQuad, turnQuadPlane } from "./quadTurn";
export { turnQuad };
import { dragCorner, quadUpright } from "./quadRules";
import { AlignmentMeter, alignColor, drawDirection, drawEdgeIcons, drawMatrixGround, iconLevels, readPerspective, scoreAlignment, startOrientation, type Orientation } from "./boardGuide";
import { BoardSampler } from "../vision/sampler";
import { loadBoardCnn } from "../vision/boardModel";
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

/** The rotate handle sits at the bottom middle of the camera view, always in the same place; dragging it turns the grid about its centre. */
/** Shown when the cursor nears the handle. */
const FLIP_TEXT = "FLIP: drag sideways to turn the board until white is at the bottom";
const ROT_NEAR = 70, ROT_R = 18, ROT_COL = "#ff3b3b";

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
  // Two extra guesses auto-detect may use, off until switched on: either can be wrong.
  const prefs = alignPrefs();
  const centreBtn = btn(`Centre guess: ${prefs.centre ? "on" : "off"}`), ocrBtn = btn(`Read letters (OCR): ${prefs.ocr ? "on" : "off"}`);
  centreBtn.title = "Start the search from the crossings in the empty middle of the board. Quick, but wrong when the middle is not clear."; ocrBtn.title = "Read the letters a-h and digits 1-8 printed round the board and use them as a guide. Slow, and can misread; needs the board's labels to be visible.";
  setPressed(centreBtn, prefs.centre); setPressed(ocrBtn, prefs.ocr);
  centreBtn.onclick = () => { const on = !alignPrefs().centre; setAlignPref("centre", on); setPressed(centreBtn, on); setLabel(centreBtn, `Centre guess: ${on ? "on" : "off"}`); if (!on) scan.centre = null; };
  ocrBtn.onclick = () => { const on = !alignPrefs().ocr; setAlignPref("ocr", on); setPressed(ocrBtn, on); setLabel(ocrBtn, `Read letters (OCR): ${on ? "on" : "off"}`); if (!on) { scan.ocrState = ""; } };
  opts.append(followBtn, matrixBtn, centreBtn, ocrBtn); followBtn.hidden = o.grid <= 1; matrixBtn.hidden = o.grid <= 1; centreBtn.hidden = o.grid <= 1; ocrBtn.hidden = o.grid <= 1;
  const follower = new AlignFollower();
  let aligner: AutoAligner | null = null, doneConf = 0, progress = 0, status = "";
  /** What auto-detect has found so far, shown blinking so it can be seen working: the crossing of the empty middle, and the letters and digits the OCR read. */
  const scan: { frame: GrayFrame | null; centre: { x: number; y: number; quad: Pt[] } | null; centreAt: number; ocrState: string; ocrAt: number } = { frame: null, centre: null, centreAt: 0, ocrState: "", ocrAt: 0 };
  // Shown when the grid fits but white pieces stand where black ones should: one click turns the corner order half way.
  const turnBtn = btn("White is on the other side: flip the corners"); turnBtn.hidden = true; setLabel(turnBtn, "White is on the other side: flip the corners");
  turnBtn.title = "Read with the corners turned half way, the board is exactly the start position; read as they are, it is not. Turn the corners half way (a8↔h1, h8↔a1).";
  let orient: Orientation = { verdict: "unknown", here: 0, turned: 0 };
  let turnVotes = 0;
  turnBtn.onclick = () => { pts = [pts[2], pts[3], pts[0], pts[1]]; turnVotes = 0; turnBtn.hidden = true; emit(); };
  const side = document.createElement("div"); side.className = "qe-side"; const turnBox = document.createElement("div"); turnBox.append(turnBtn); side.append(meterBox, turnBox, autoBox, bar, opts);
  box.append(head, hint, stage, side); back.append(box); document.body.append(back);

  const ctx = cv.getContext("2d")!;
  const sx = W / fw, sy = H / fh;
  let sel = 0, raf = 0, closed = false, levels: number[] | undefined, levelsAt = 0, ground: ReturnType<typeof readPerspective> = null, groundAt = 0;
  let coach: PieceMove[] = [], coachAt = 0;
  let cursor: { x: number; y: number } | null = null; // the pointer on the canvas, to show the FLIP label only when it comes near the handle
  let turning: { from: number; shown: number; mode: "3d" | "flat" } | null = null; // the rotate handle is being dragged: the angle turned so far (radians)
  /** Where the rotate handle is on the canvas: bottom middle of the picture. `c` is the grid's centre, which the turn is about. */
  const rotHandle = () => {
    const c = pts.reduce((a, p) => ({ x: a.x + (p.x * sx) / 4, y: a.y + (p.y * sy) / 4 }), { x: 0, y: 0 });
    return { c, h: { x: W / 2, y: H - ROT_R - 12 } };
  };
  const emit = () => o.change(fmtCorners(pts));
  /** Blinks what the search has found (the middle's crossing, the OCR's letters and digits) and says in words what the OCR is doing. */
  const drawFinds = (now: number) => {
    const pulse = (t0: number) => 0.3 + 0.7 * Math.abs(Math.sin(((now - t0) / 1000) * Math.PI * 3)), live4 = (t0: number) => now - t0 < 4000;
    ctx.save(); ctx.lineJoin = "round"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    const tag = (t: string, x: number, y: number, col: string) => { ctx.font = '700 12px "IBM Plex Mono",ui-monospace,monospace'; ctx.lineWidth = 3; ctx.strokeStyle = "#07090d"; ctx.strokeText(t, x, y); ctx.fillStyle = col; ctx.fillText(t, x, y); };
    if (scan.centre && alignPrefs().centre && live4(scan.centreAt)) {
      const a = pulse(scan.centreAt), c = scan.centre, x = c.x * sx, y = c.y * sy;
      ctx.globalAlpha = a; ctx.strokeStyle = "#2de2e6"; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
      ctx.beginPath(); c.quad.forEach((p, i) => (i ? ctx.lineTo(p.x * sx, p.y * sy) : ctx.moveTo(p.x * sx, p.y * sy))); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
      ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI * 2); ctx.moveTo(x - 26, y); ctx.lineTo(x + 26, y); ctx.moveTo(x, y - 26); ctx.lineTo(x, y + 26); ctx.stroke();
      ctx.globalAlpha = 1; tag("CENTRE FOUND", x + 22, y - 22, "#2de2e6");
    }
    const rep = scan.frame && alignPrefs().ocr ? ocrReportOf(scan.frame) : null;
    if (rep) {
      if (rep.state !== scan.ocrState) { scan.ocrState = rep.state; scan.ocrAt = now; }
      if (rep.hits.length && live4(Math.max(scan.ocrAt, rep.t))) {
        ctx.globalAlpha = pulse(scan.ocrAt); ctx.strokeStyle = "#ff4fd8"; ctx.lineWidth = 2;
        for (const h of rep.hits) { const x = h.x * sx, y = h.y * sy; ctx.strokeRect(x - 11, y - 11, 22, 22); ctx.globalAlpha = 1; tag(h.ch, x - 4, y - 18, "#ff4fd8"); ctx.globalAlpha = pulse(scan.ocrAt); }
        ctx.globalAlpha = 1;
      }
      if (aligner || live4(scan.ocrAt) || rep.state === "unavailable") {
        const msg = rep.state === "reading" ? `OCR: reading the letters and digits${rep.hits.length ? ` (${rep.hits.length} so far)` : ""}…`
          : rep.state === "found" ? `OCR: ${rep.hits.length} board letters/digits lined up, ${rep.guesses} board guess${rep.guesses === 1 ? "" : "es"}`
          : rep.state === "none" ? (rep.seen ? `OCR: saw ${rep.seen} marks, but none lined up as the board's letters` : "OCR: no letters or digits could be read")
          : `OCR unavailable${rep.reason ? `: ${rep.reason.slice(0, 60)}` : ""}`;
        tag(msg, 10, 16, rep.state === "found" ? "#ff4fd8" : rep.state === "reading" ? "#fff" : "#ffb347");
      }
    }
    ctx.restore();
  };
  const paint = () => {
    if (closed) return;
    const fr = o.frame(); // one read per repaint: the picture is drawn and measured from the same frame
    drawFrame(ctx, W, H, fr, "no camera frame yet — connect a camera to this node");
    const m = squareToQuad(pts), P = (u: number, v: number) => { const p = m(u, v); return { x: p.x * sx, y: p.y * sy }; };
    // How well the grid sits on the squares decides its colour: orange while it is off, green once it fits.
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
    if (aligner?.found.centre && !scan.centre) { const c = aligner.found.centre; scan.centre = { x: c.center.x, y: c.center.y, quad: c.corners }; scan.centreAt = performance.now(); }
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
        // The neural reader reads the board in both corner orders; the flip is offered only when exactly one of them is the start position, and only after a few reads in a row, so a passing hand or a game under way never triggers it.
        const net = BoardSampler.boardNet;
        if (!net) void loadBoardCnn();
        orient = { verdict: "unknown", here: 0, turned: 0 };
        if (board && net && !aligner) { try { orient = startOrientation(net, fr, pts); } catch { /* keep unknown */ } }
        turnVotes = meter.good && orient.verdict === "turned" ? Math.min(turnVotes + 1, 6) : Math.max(turnVotes - 2, 0);
        turnBtn.hidden = turnVotes < 3;
      }
      drawEdgeIcons(ctx, P, color, fr ? levels : undefined);
      if (o.names[0] === "a8" && o.names[2] === "h1") drawDirection(ctx, P, turnVotes >= 3 ? "turned" : orient.verdict === "right" ? "right" : "unknown");
      if (coach.length) drawPlacementMoves(ctx, P, coach, now);
    }
    if (o.grid > 1) { // rotate handle
      const { h } = rotHandle();
      ctx.save(); ctx.lineCap = "round";
      ctx.shadowColor = ROT_COL; ctx.shadowBlur = turning ? 18 : 12;
      ctx.fillStyle = ROT_COL; ctx.strokeStyle = "#fff"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(h.x, h.y, ROT_R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      const ir = ROT_R * 0.55, a0 = -Math.PI * 0.2;
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.arc(h.x, h.y, ir, a0, Math.PI * 1.35); ctx.stroke();
      const ax = h.x + Math.cos(a0) * ir, ay = h.y + Math.sin(a0) * ir;
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.moveTo(ax - 5, ay - 1); ctx.lineTo(ax + 5, ay - 1); ctx.lineTo(ax + 0.5, ay + 6); ctx.closePath(); ctx.fill();
      if (!turning && cursor && Math.hypot(cursor.x - h.x, cursor.y - h.y) <= ROT_R + ROT_NEAR) { ctx.font = '700 12px "IBM Plex Mono",ui-monospace,monospace'; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = "#fff"; ctx.strokeStyle = "#07090d"; ctx.lineWidth = 3; ctx.lineJoin = "round"; ctx.strokeText(FLIP_TEXT, h.x, h.y - ROT_R - 10); ctx.fillText(FLIP_TEXT, h.x, h.y - ROT_R - 10); }
      if (turning) { const deg = Math.round((turning.shown * 180) / Math.PI), t = `${deg > 0 ? "+" : ""}${deg}° ${turning.mode === "3d" ? "3D" : "flat"}`; ctx.font = '600 12px "IBM Plex Mono",ui-monospace,monospace'; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = "#fff"; ctx.strokeStyle = "#07090d"; ctx.lineWidth = 3; ctx.strokeText(t, h.x, h.y - ROT_R - 10); ctx.fillText(t, h.x, h.y - ROT_R - 10); }
      ctx.restore();
    }
    drawFinds(performance.now());
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
  const isBoard = o.grid > 1 && o.names[0] === "a8" && o.names[2] === "h1";
  const clamp = (p: Pt): Pt => ({ x: Math.min(fw, Math.max(0, p.x)), y: Math.min(fh, Math.max(0, p.y)) });
  cv.addEventListener("pointermove", (e) => { const r = cv.getBoundingClientRect(); cursor = { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }; });
  cv.addEventListener("pointerleave", () => { cursor = null; });
  cv.addEventListener("pointerdown", (e) => {
    if (o.grid > 1) { // the rotate handle turns the whole grid about its centre
      const r = cv.getBoundingClientRect(), cx = ((e.clientX - r.left) / r.width) * W, cy = ((e.clientY - r.top) / r.height) * H, { c, h } = rotHandle();
      if (Math.hypot(cx - h.x, cy - h.y) <= ROT_R + 5) {
        cv.setPointerCapture(e.pointerId); cv.focus(); e.preventDefault();
        aligner = null; setLabel(auto, "Auto detect"); follower.unlock(); status = "";
        // Turn the board as it lies on the table when the picture backs up its perspective; otherwise turn the grid flat in the picture.
        const pick = pickTurnBase(o.frame(), pts), base = pick.base.map((q) => ({ ...q })), inv = pick.mode === "3d" ? quadToSquare(base) : null;
        const boardAngle = (ev: { clientX: number; clientY: number }) => {
          const p = inv?.(((ev.clientX - r.left) / r.width) * fw, ((ev.clientY - r.top) / r.height) * fh);
          return p ? Math.atan2(p.v - 0.5, p.u - 0.5) : null;
        };
        const flatAngle = (ev: { clientX: number; clientY: number }) => Math.atan2(((ev.clientY - r.top) / r.height) * H - c.y, ((ev.clientX - r.left) / r.width) * W - c.x);
        const a3 = boardAngle(e), mode: "3d" | "flat" = a3 === null ? "flat" : "3d", a0 = mode === "3d" ? a3! : flatAngle(e);
        if (mode === "flat" && pick.mode === "3d") base.splice(0, 4, ...pts.map((q) => ({ ...q })));
        turning = { from: a0, shown: 0, mode };
        const move = (ev: PointerEvent) => {
          let d = (mode === "3d" ? boardAngle(ev) ?? a0 : flatAngle(ev)) - a0;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          if (ev.shiftKey) d = Math.round(d / (Math.PI / 12)) * (Math.PI / 12);
          // the box may be turned, but never criss-crossed or upside down: past that it stops at the limit
          const make = (a: number) => (mode === "3d" ? turnQuadPlane(base, a) : null) ?? turnQuad(base, { x: c.x / sx, y: c.y / sy }, a, sx, sy);
          if (!quadUpright(make(d), isBoard)) { let lo = 0, hi = d; for (let k = 0; k < 14; k++) { const mid = (lo + hi) / 2; if (quadUpright(make(mid), isBoard)) lo = mid; else hi = mid; } d = lo; }
          const turned = mode === "3d" ? turnQuadPlane(base, d) : null;
          turning = { from: a0, shown: d, mode: turned || mode === "flat" ? mode : "flat" };
          pts = turned ?? turnQuad(base, { x: c.x / sx, y: c.y / sy }, d, sx, sy); emit();
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
    // A corner never criss-crosses the box or turns it upside down: past that point it turns the whole box instead.
    let last = clamp(p); pts = dragCorner(pts, sel, pts[sel], last, isBoard); emit();
    const move = (ev: PointerEvent) => { const to = clamp(at(ev)); pts = dragCorner(pts, sel, last, to, isBoard); last = to; emit(); };
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
    if (d[e.key]) { e.preventDefault(); const next = pts.map((p, k) => (k === sel ? clamp({ x: p.x + d[e.key][0], y: p.y + d[e.key][1] }) : p)); if (quadUpright(next, isBoard) || !quadUpright(pts, isBoard)) { pts = next; emit(); } }
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
      aligner = new AutoAligner(fr, seed ?? pts, 140, undefined, rememberedLayouts(fr.width, fr.height)); if (alignPrefs().ocr) aligner.expectLabels(labelHints(fr)); setLabel(auto, "Stop");
      scan.frame = fr; scan.centre = null; scan.ocrState = ""; scan.ocrAt = 0;
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
