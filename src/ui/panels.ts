import type { Graph } from "../core/graph";
import { bus } from "../core/bus";
import { extractSurfaces } from "../mapping/planes";
import { runCalibration } from "../mapping/calibrator";
import { loadMapping, saveMapping, defaultMapping, type MappingConfig } from "../mapping/store";
import { virtualTable } from "../sim/virtualTable";
import { SQUARE } from "../world/coords";
import { sqIndex, sqName } from "../vision/types";
import { WorldView } from "../world/view";
import { drawTableOverlay } from "../world/overlay";
import { registerContextMenu } from "./contextMenu";
import { viewMenu } from "./menus/viewMenu";
import { dueFrame, pixelRatio, setDisplay, viewSettings } from "./viewSettings";
import { PIECE_SETS, pieceColors, pieceImage, pieceSet, setPieceColors, setPieceSet } from "./pieceSets";
import { BOARD_THEMES, boardTheme, setBoardTheme } from "./boardThemes";
import { openChannel, type InMsg } from "./channel";
import { drawBotAvatar, drawGrabHand } from "./botAvatar";
import type { Tip, TipRow } from "./tooltip";
import { fenPieces } from "../plugins/shared";
import { isLightSquare, pct, pieceLabel, tone } from "../plugins/hover";

const o2 = (n: string) => sqIndex(n);
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
const GLYPH: Record<string, string> = { wp: "♙", wn: "♘", wb: "♗", wr: "♖", wq: "♕", wk: "♔", bp: "♟", bn: "♞", bb: "♝", br: "♜", bq: "♛", bk: "♚" };

/** The virtual table: play moves with the mouse (a simulated hand carries the piece past the cameras), hover menu buttons to test dwell selection. */
export class TablePanel {
  root = el("div", "panel table");
  private cv = el("canvas"); private info = el("div", "muted");
  private px = 44; private margin = 3; private sel: number | null = null;
  /** A piece being dragged with the mouse (square index), and whether it was already selected when grabbed. */
  private drag: { from: number; was: boolean } | null = null; private suppressClick = false;
  /** Square (0 = a8) under the mouse, or null; the margin ring counts as off the board. */
  private over: number | null = null; private overMargin: { x: number; y: number } | null = null;

  constructor() {
    this.cv.width = this.cv.height = (8 + this.margin * 2) * this.px;
    this.cv.className = "table-cv"; this.cv.dataset.tipLive = "1";
    const bar = el("div", "bar");
    const reset = el("button", "", "Reset table"); reset.dataset.tip = "Reset table"; reset.dataset.tipBody = "Puts every piece back on its starting square."; reset.onclick = () => virtualTable.reset();
    const seat = el("button", "", "Sit / stand"); seat.dataset.tip = "Sit / stand"; seat.dataset.tipBody = "Seats or removes the virtual player, so the cameras and tracking see a person at the table."; seat.onclick = () => { virtualTable.seated = !virtualTable.seated; this.seatCb(virtualTable.seated); };
    const look = el("select", "board-look"); look.title = "Board look";
    for (const t of BOARD_THEMES) { const o = el("option", "", t.name); o.value = t.id; look.append(o); }
    look.value = boardTheme().id; look.onchange = () => setBoardTheme(look.value);
    const hover = el("button", "", "Hover hand"); hover.title = "Hold a simulated hand over the board under your mouse, to test what the cameras do when squares are covered";
    hover.onclick = () => { virtualTable.hoverHand = !virtualTable.hoverHand; hover.classList.toggle("on", virtualTable.hoverHand); if (!virtualTable.hoverHand && !virtualTable.busy) virtualTable.hand = null; };
    bar.append(seat, reset, hover, look);
    this.root.append(bar, this.cv, this.info);
    this.info.textContent = "Click a piece, then a square. Hover a menu button to test dwell selection.";
    const pos = (e: MouseEvent) => { const r = this.cv.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * (8 + 2 * this.margin) - this.margin, y: ((e.clientY - r.top) / r.height) * (8 + 2 * this.margin) - this.margin }; };
    this.cv.onmousemove = (e) => {
      const q = pos(e); virtualTable.pointer = q;
      const c = Math.floor(q.x), r = Math.floor(q.y); this.over = c >= 0 && c < 8 && r >= 0 && r < 8 ? r * 8 + c : null; this.overMargin = this.over === null ? q : null;
      if (virtualTable.hoverHand && !virtualTable.busy) { virtualTable.hand = { ...virtualTable.pointer }; virtualTable.carried = null; virtualTable.setHoverHand(); }
    };
    this.cv.onmousedown = (e) => {
      this.suppressClick = false;
      if (this.takeover()) { this.suppressClick = true; return; } // two bots are playing: the click asks to take control instead of moving a piece
      virtualTable.pointerDown = true;
      const p = pos(e), c = Math.floor(p.x), r = Math.floor(p.y), pc = c >= 0 && c < 8 && r >= 0 && r < 8 ? virtualTable.game.board()[r][c] : null;
      if (pc && !virtualTable.busy && pc.color === virtualTable.game.turn() && bus.botColor !== pc.color) { this.drag = { from: r * 8 + c, was: this.sel === r * 8 + c }; this.sel = r * 8 + c; } // grab: drag it to a square, or release to keep it selected
    };
    this.cv.onmouseup = (e) => {
      virtualTable.pointerDown = false;
      const d = this.drag; this.drag = null;
      if (!d) return;
      const p = pos(e), c = Math.floor(p.x), r = Math.floor(p.y), to = c >= 0 && c < 8 && r >= 0 && r < 8 ? r * 8 + c : null;
      this.suppressClick = true; // the mouseup handled it; the click that follows must not act again
      if (to === null) { this.sel = null; return; }
      if (to === d.from) { this.sel = d.was ? null : to; return; } // released where it started: a plain click toggles the selection
      const from = sqName(d.from), tn = sqName(to);
      const m = virtualTable.game.moves({ verbose: true }).find((x) => x.from === from && x.to === tn && (x.promotion ?? "q") === "q"); // a pawn dropped on the last rank queens
      if (m) virtualTable.play(m.from + m.to + (m.promotion ?? ""), performance.now());
      this.sel = null;
    };
    this.cv.onmouseleave = () => { virtualTable.pointer = null; virtualTable.pointerDown = false; this.drag = null; this.over = null; this.overMargin = null; if (virtualTable.hoverHand && !virtualTable.busy) virtualTable.hand = null; };
    this.cv.onclick = (e) => {
      if (this.suppressClick) { this.suppressClick = false; return; }
      const p = pos(e); const c = Math.floor(p.x), r = Math.floor(p.y);
      if (c < 0 || c > 7 || r < 0 || r > 7) return;
      const i = r * 8 + c;
      if (this.sel === null) { if (virtualTable.game.board()[r][c]) this.sel = i; return; }
      const from = sqName(this.sel), to = sqName(i);
      const m = virtualTable.game.moves({ verbose: true }).find((x) => x.from === from && x.to === to);
      if (m) virtualTable.play(m.from + m.to + (m.promotion ?? ""), performance.now());
      this.sel = null;
    };
  }
  seatCb: (seated: boolean) => void = () => {};
  /** Called on every press on the table; return true when it was used up (e.g. to offer taking over from the AI players), so no piece is grabbed. */
  takeover: () => boolean = () => false;

  /** Hover card for the virtual table: what is on the square, what the cameras and tracker think, and what every colour on it means. */
  tips = (e: Element): Tip | null => {
    if (e !== this.cv) return null;
    const g = bus.game, d = bus.director, b = bus.board;
    if (this.over === null) {
      const m = this.overMargin, btn = d?.phase === "menu" && m ? d.menu.find((x) => Math.hypot(x.x - (m.x + 0), x.y - m.y) <= x.r) : null;
      if (btn) return { title: btn.label, tag: "menu button", color: "#8caaff", body: "A projected button. Hold a hand over it until the ring fills to select it.", rows: [{ label: "Dwell progress", value: pct(d!.progress[btn.id] ?? 0), bar: d!.progress[btn.id] ?? 0 }] };
      return { title: "Table edge", tag: "virtual table", color: "#8caaff", body: "Outside the board. Menu buttons and the simulated arms appear here.", rows: [{ label: "Phase", value: d?.phase ?? "idle" }, ...(virtualTable.hand ? [{ label: "Hand", value: virtualTable.carried !== null ? "carrying a piece" : "over the table" }] : [])] };
    }
    const sq = this.over, name = sqName(sq), r = Math.floor(sq / 8), c = sq % 8;
    const real = virtualTable.game.board()[r][c], realCh = real ? (real.color === "w" ? real.type.toUpperCase() : real.type) : null;
    const tracked = fenPieces(g?.fen)[sq] ?? null;
    const rows: TipRow[] = [{ label: "On the table", value: pieceLabel(realCh) }];
    if (g) rows.push({ label: "Tracker thinks", value: pieceLabel(tracked), tone: (tracked ?? null) === realCh ? "ok" : "bad" });
    if (b) {
      const occ = b.occ[sq], seen = occ > 0.5, white = b.white[sq];
      rows.push({ label: "Cameras see", value: seen ? `a ${white > 0.5 ? "white" : "black"} piece` : "empty", bar: b.conf[sq], tone: tone(b.conf[sq]) });
    } else rows.push({ label: "Cameras see", value: "no reading yet", tone: "warn" });
    // Every colour on this square, with its reason.
    const why: string[] = [];
    const mark = (label: string, value: string, t?: TipRow["tone"]) => rows.push({ label, value, tone: t });
    if (this.sel === sq) { mark("Yellow", "your selected piece", "warn"); why.push("Yellow: the piece you clicked; click a highlighted square to move it."); }
    if (g?.lifted === name) { mark("Amber", "piece picked up", "warn"); why.push("Amber: the tracker saw this piece leave its square."); }
    if (g?.last && o2(g.last.from) === sq) { mark("Blue", "last move started here", "ok"); why.push("Blue: the last move the tracker confirmed."); }
    if (g?.last && o2(g.last.to) === sq) { mark("Blue", "last move ended here", "ok"); }
    if (g?.status === "illegal" && g.diff.includes(sq)) { mark("Red outline", "cameras ≠ expected", "bad"); why.push(`Red outline: the cameras disagree with the position the tracker expects here, so it flags the position illegal (${g.diff.length} squares disagree). Usually the cameras are not calibrated or are not seeing the board yet.`); }
    if (bus.engineHint && (bus.engineHint.from === name || bus.engineHint.to === name)) { mark("Green", bus.engineHint.from === name ? "engine move: pick up here" : "engine move: put down here", "ok"); why.push("Green: Stockfish's move. Play it on the board for the engine."); }
    if (this.sel !== null && viewSettings().display.legalMoves && virtualTable.game.moves({ verbose: true }).some((m) => m.from === sqName(this.sel!) && m.to === name)) { mark("Dot", "legal move for the selected piece"); }
    if (g) rows.push({ label: "Tracker status", value: g.status, tone: g.status === "illegal" ? "bad" : g.status === "synced" ? "ok" : "warn" });
    return {
      title: name, tag: `${isLightSquare(sq) ? "light" : "dark"} square · virtual table`, color: "#ffe45c",
      body: why.length ? why.join(" ") : real ? `A ${pieceLabel(realCh)} stands here. No overlay colours on this square.` : "Empty square. No overlay colours on this square.",
      rows, hint: this.sel === null ? "Click a piece to select it" : "Click a square to move there",
    };
  };

  /** Top-down view of both arms: sleeve, forearm, palm and fingers, higher parts drawn on top. */
  private drawArms(c: CanvasRenderingContext2D, px: number) {
    const caps = virtualTable.arms().flatMap((a) => a.capsules).sort((a, b) => a.a[1] + a.b[1] - (b.a[1] + b.b[1]));
    c.lineCap = "round";
    const to = (p: [number, number, number]) => [(p[0] / SQUARE + 4) * px, (p[2] / SQUARE + 4) * px];
    for (const k of caps) {
      const [x0, y0] = to(k.a), [x1, y1] = to(k.b);
      c.strokeStyle = k.tone < 150 ? "rgba(58,74,99,.82)" : "rgba(226,170,138,.9)"; c.lineWidth = (2 * k.r * px) / SQUARE;
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    }
    c.lineCap = "butt";
  }

  private lastFrame = -1e9;
  frame(now: number) {
    const vs = viewSettings(), disp = vs.display;
    if (!dueFrame(now, this.lastFrame, vs.render.fps)) return;
    this.lastFrame = now;
    const c = this.cv.getContext("2d")!, px = this.px, m = this.margin, th = boardTheme();
    const k = pixelRatio(vs.render.scale), side = Math.round((8 + m * 2) * px * k); // backing resolution only: CSS keeps the canvas at 100% width
    if (this.cv.width !== side) this.cv.width = this.cv.height = side;
    c.setTransform(k, 0, 0, k, 0, 0);
    c.fillStyle = th.surround; c.fillRect(0, 0, (8 + m * 2) * px, (8 + m * 2) * px);
    c.save(); c.translate(m * px, m * px);
    const b = virtualTable.game.board();
    for (let i = 0; i < 64; i++) { c.fillStyle = ((i % 8) + Math.floor(i / 8)) % 2 ? th.dark : th.light; c.fillRect((i % 8) * px, Math.floor(i / 8) * px, px, px); }
    if (this.sel !== null) { c.fillStyle = th.hi; c.fillRect((this.sel % 8) * px, Math.floor(this.sel / 8) * px, px, px); }
    c.font = `bold ${px * 0.2}px Arial, sans-serif`; c.textBaseline = "top"; c.textAlign = "left";
    for (let k = 0; k < (disp.coords ? 8 : 0); k++) {
      const light = (k + 7) % 2 === 0; c.fillStyle = light ? th.dark : th.light;
      c.textAlign = "left"; c.fillText(String(8 - k), 0.06 * px, k * px + 0.06 * px);
      c.textAlign = "right"; c.textBaseline = "bottom"; c.fillText("abcdefgh"[k], (k + 1) * px - 0.06 * px, 8 * px - 0.04 * px); c.textBaseline = "top";
    }
    if (this.sel !== null && disp.legalMoves) {
      const from = sqName(this.sel);
      for (const mv of virtualTable.game.moves({ verbose: true }).filter((x) => x.from === from)) {
        const i = (8 - Number(mv.to[1])) * 8 + (mv.to.charCodeAt(0) - 97), cx = ((i % 8) + 0.5) * px, cy = (Math.floor(i / 8) + 0.5) * px;
        c.fillStyle = "rgba(0,0,0,.14)"; c.beginPath();
        if (mv.captured || mv.flags.includes("e")) { c.arc(cx, cy, px * 0.46, 0, 7); c.arc(cx, cy, px * 0.36, 0, 7, true); } else c.arc(cx, cy, px * 0.16, 0, 7);
        c.fill();
      }
    }
    c.font = `${px * 0.82}px "Segoe UI Symbol", serif`; c.textAlign = "center"; c.textBaseline = "middle";
    b.forEach((row, r) => row.forEach((p, col) => {
      if (!p || virtualTable.carried === r * 8 + col || this.drag?.from === r * 8 + col || bus.pieceView) return; // projected pieces come with the overlay
      const img = pieceImage(p.color + p.type);
      if (img) { c.drawImage(img, col * px, r * px, px, px); return; }
      const g = GLYPH["b" + p.type]; c.fillStyle = p.color === "w" ? "#fdfdfd" : "#262421"; c.strokeStyle = p.color === "w" ? "#3b3a37" : "#0d0d0d"; c.lineWidth = p.color === "w" ? 2.2 : 1.2; c.strokeText(g, (col + 0.5) * px, (r + 0.55) * px); c.fillText(g, (col + 0.5) * px, (r + 0.55) * px);
    }));
    if (bus.botColor) drawBotAvatar(c, px, bus.botColor, virtualTable.busy || !!bus.engineHint, virtualTable.hand, now / 1000);
    this.drawArms(c, px);
    const lifted = (sq: number | null, x: number, y: number, hand: "me" | "bot") => { // a piece in a hand, raised and shadowed
      const p = sq === null ? null : b[Math.floor(sq / 8)][sq % 8]; if (!p) return;
      c.fillStyle = "rgba(0,0,0,.25)"; c.beginPath(); c.ellipse(x * px + 4, y * px + px * 0.4, px * 0.32, px * 0.14, 0, 0, 7); c.fill();
      const img = pieceImage(p.color + p.type), s = px * 1.12;
      if (img) c.drawImage(img, x * px - s / 2, y * px - s / 2 - 6, s, s);
      else { c.font = `${px * 0.9}px "Segoe UI Symbol", serif`; c.fillStyle = p.color === "w" ? "#fdfdfd" : "#262421"; c.fillText(GLYPH["b" + p.type], x * px, y * px - 4); }
      drawGrabHand(c, x * px, y * px - px * 0.3, px, hand === "bot" ? bus.botColor === "b" : false);
    };
    if (virtualTable.carried !== null && virtualTable.hand) lifted(virtualTable.carried, virtualTable.hand.x, virtualTable.hand.y, "bot");
    if (this.drag && virtualTable.pointer) lifted(this.drag.from, virtualTable.pointer.x, virtualTable.pointer.y, "me");
    if (this.over !== null) { c.strokeStyle = "rgba(255,255,255,.9)"; c.lineWidth = 2; c.strokeRect((this.over % 8) * px + 1, Math.floor(this.over / 8) * px + 1, px - 2, px - 2); }
    c.restore();
    drawTableOverlay(c, px, m, { game: bus.game, director: bus.director, hint: bus.engineHint, clock: bus.clockView, pieces: bus.pieceView, outline: bus.outline, reconcile: bus.reconcile, lastMove: disp.lastMove, hints: disp.hints }, now / 1000, false);
    const g = bus.game, d = bus.director;
    this.info.textContent = `${d?.phase ?? "idle"}${d?.mode ? ` · ${d.mode === "engine" ? `Stockfish ${d.elo}` : "2 joueurs"}` : ""} · tracker: ${g?.status ?? "—"} · ${g?.history.slice(-6).join(" ") ?? ""}`;
  }
}

/** 3D simulation + projection mapping: scan import, projector rig, auto-calibration, output windows. */
export class WorldPanel {
  root = el("div", "panel world");
  view: WorldView;
  cfg: MappingConfig = loadMapping();
  private cv = el("canvas", "world-cv");
  private status = el("div", "muted");
  private projSize = new Map<number, { w: number; h: number }>();
  private ch = openChannel();
  private wins = new Map<number, Window | null>();

  constructor(private graph: Graph) {
    const bar = el("div", "bar");
    const frusta = this.toggle("Projector frusta", viewSettings().display.frusta, (v) => { this.view.showFrusta = v; setDisplay({ frusta: v }); });
    const proj = this.toggle("Projected content", true, (v) => { this.view.showProjection = v; this.view.setMapping(this.cfg); });
    const scan = el("label", "btn", "Import room scan (.glb/.obj)"); scan.dataset.tip = "Import room scan"; scan.dataset.tipBody = "Loads a 3D scan of the room, finds the flat surfaces (table, walls, floor) and maps the projectors onto them."; scan.dataset.tipTag = "file .glb · .obj"; const file = el("input"); file.type = "file"; file.accept = ".glb,.gltf,.obj"; file.hidden = true; scan.append(file);
    file.onchange = () => file.files?.[0] && void this.importScan(file.files[0]);
    const reset = el("button", "", "Default room"); reset.dataset.tip = "Default room"; reset.dataset.tipBody = "Forgets the imported scan and projector poses and goes back to the built-in room."; reset.dataset.tipTag = "resets mapping"; reset.onclick = () => { this.cfg = defaultMapping(); this.apply(); };
    bar.append(frusta, proj, scan, reset);
    const rig = el("div", "rig");
    this.root.append(bar, this.cv, rig, this.status);
    this.view = new WorldView(this.cv, this.cfg);
    registerContextMenu(this.cv, () => viewMenu([
      { kind: "action", label: "Reset camera", run: () => this.view.resetCamera() },
      { kind: "action", label: "Default room", run: () => { this.cfg = defaultMapping(); this.apply(); } },
    ], { world: true }));
    this.renderRig(rig);
    this.ch.onmessage = (e: MessageEvent<InMsg>) => { if (e.data.type === "size") this.projSize.set(e.data.index, { w: e.data.w, h: e.data.h }); };
  }

  private toggle(label: string, on: boolean, cb: (v: boolean) => void) {
    const l = el("label", "chk"); l.dataset.tip = label; l.dataset.tipTag = "toggle";
    l.dataset.tipBody = { "Projector frusta": "Draws the cone of light each projector throws, so you can see what it covers.", "Projected content": "Shows the overlay (move hints, clock, menu) as it lands on the table, as the projector would draw it." }[label] ?? ""; const c = el("input"); c.type = "checkbox"; c.checked = on; c.onchange = () => cb(c.checked); l.append(c, document.createTextNode(label)); return l;
  }

  private apply() { saveMapping(this.cfg); this.view.setMapping(this.cfg); this.ch.postMessage({ type: "mapping" }); }

  private renderRig(rig: HTMLElement) {
    rig.replaceChildren();
    this.cfg.projectors.forEach((p, i) => {
      const row = el("div", "rig-row"); row.append(el("b", "", p.id));
      const open = el("button", "", "Open output"); open.dataset.tip = `Open output for ${p.id}`; open.dataset.tipBody = "Opens the picture this projector shows in its own window. Drag it onto the projector and double-click for fullscreen."; open.onclick = () => { this.wins.set(i, window.open(`?output=${i}`, `cx-out-${i}`, "popup,width=960,height=540")); };
      const cal = el("button", "", this.cfg.calibration[p.id] ? `Re-calibrate (${this.cfg.calibration[p.id].rms.toFixed(1)}px)` : "Auto-calibrate"); cal.dataset.tip = `Calibrate ${p.id}`; cal.dataset.tipBody = "Projects dots and watches them with the webcam to learn where the projector lands on the table. Needs the output window open and a webcam Online."; cal.dataset.tipRows = this.cfg.calibration[p.id] ? `Last error:${this.cfg.calibration[p.id].rms.toFixed(1)} px` : "Calibrated:no"; cal.onclick = () => void this.calibrate(i);
      row.append(open, cal); rig.append(row);
    });
  }

  private async calibrate(i: number) {
    const p = this.cfg.projectors[i];
    if (!this.wins.get(i) || this.wins.get(i)!.closed) { this.status.textContent = `Open the output window for ${p.id} first, drag it to the projector and double-click for fullscreen.`; return; }
    // find the first online webcam node to look at the projection
    const camId = [...this.graph.nodes.values()].find((n) => n.type === "source.webcam" && n.params.online)?.id;
    if (!camId) { this.status.textContent = "Set a Webcam node Online (the camera that sees the projection) before calibrating."; return; }
    const io = {
      show: (cmd: any) => this.ch.postMessage({ type: "calib", cmd }),
      grab: async () => { await new Promise((r) => setTimeout(r, 450)); return this.graph.outputs.get(camId)?.frame ?? null; },
    };
    this.status.textContent = `Calibrating ${p.id}…`;
    const out = await runCalibration(io, { w: 1280, h: 720 }, (pr) => (this.status.textContent = `Calibrating ${p.id}… ${Math.round(pr * 100)}%`));
    this.ch.postMessage({ type: "calib", cmd: { kind: "end" } });
    if (!out.result) { this.status.textContent = `Calibration failed: saw ${out.hits} dots (need 6). Reduce ambient light or aim the camera at the projection.`; return; }
    this.cfg.calibration[p.id] = { camToProj: out.result.camToProj, rms: out.result.rmsError };
    saveMapping(this.cfg); this.renderRig(this.root.querySelector(".rig")!);
    this.status.textContent = `${p.id} calibrated: ${out.hits} dots, RMS ${out.result.rmsError.toFixed(2)}px${out.footprint ? ", footprint found" : ""}.`;
  }

  private async importScan(f: File) {
    this.status.textContent = "Reading scan…";
    const THREE = await import("three");
    const buf = await f.arrayBuffer();
    const verts: number[] = [];
    const collect = (root: any) => root.traverse((o: any) => {
      if (!o.isMesh) return;
      o.updateWorldMatrix(true, false);
      const pos = o.geometry.attributes.position, v = new THREE.Vector3();
      const step = Math.max(1, Math.floor(pos.count / 40000));
      for (let k = 0; k < pos.count; k += step) { v.fromBufferAttribute(pos, k).applyMatrix4(o.matrixWorld); verts.push(v.x, v.y, v.z); }
    });
    if (/\.obj$/i.test(f.name)) { const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js"); collect(new OBJLoader().parse(new TextDecoder().decode(buf))); }
    else { const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js"); const g = await new GLTFLoader().parseAsync(buf, ""); collect(g.scene); }
    // recentre on the scan's floor so the table can sit at the origin
    let minY = Infinity, sx = 0, sz = 0;
    for (let k = 0; k < verts.length; k += 3) { minY = Math.min(minY, verts[k + 1]); sx += verts[k]; sz += verts[k + 2]; }
    const n = verts.length / 3;
    for (let k = 0; k < verts.length; k += 3) { verts[k] -= sx / n; verts[k + 1] -= minY; verts[k + 2] -= sz / n; }
    const surfaces = extractSurfaces(new Float32Array(verts), { tol: 0.04, minInliers: Math.max(150, n / 80), maxPlanes: 10 });
    if (!surfaces.length) { this.status.textContent = "No planar surfaces found in that scan."; return; }
    this.cfg.surfaces = surfaces; this.apply();
    this.status.textContent = `Scan mapped: ${surfaces.map((s) => s.kind).join(", ")}. Move the table by editing projector poses (saved in localStorage cx.mapping.v1).`;
  }

  frame(now: number) { this.view.render(now); }
  post(m: any) { this.ch.postMessage(m); }
}

export class LogPanel {
  root = el("div", "panel log");
  private chips = el("div", "chips"); private lines = el("div", "lines"); private ev = el("div", "events");
  private n = 0;
  constructor() { this.root.append(this.chips, el("h4", "", "Narration"), this.lines, el("h4", "", "Events"), this.ev); }
  /** Hover cards for camera chips, narration lines and events: the full record behind each short row. */
  tips = (e: Element): Tip | null => {
    if (!(e instanceof HTMLElement) || !this.root.contains(e)) return null;
    if (e.dataset.cam) {
      const c = bus.cameras.find((x) => x.id === e.dataset.cam);
      return c ? { title: `Camera ${c.id}`, tag: c.online ? "online" : "offline", color: "#35e0b4", body: "Image quality is how clean this camera's picture is; trust is how often it agreed with the other cameras, and it scales its vote in Fusion.",
        rows: [{ label: "Picture quality", value: pct(c.quality), bar: c.quality, tone: tone(c.quality) }, { label: "Trust", value: pct(c.reliability), bar: c.reliability, tone: tone(c.reliability) }] } : null;
    }
    if (e.classList.contains("ln")) {
      const l = bus.lines.find((x) => String(x.t) === e.dataset.t && x.speaker === e.dataset.who);
      return l ? { title: l.name, tag: `voice ${l.speaker}`, color: l.speaker === "A" ? "#7fd4ff" : "#ffb86b", body: l.text, rows: [{ label: "Priority", value: `${l.priority} / 3`, bar: l.priority / 3 }, { label: "Said at", value: `${Math.round(l.t / 1000)} s` }] } : null;
    }
    if (e.classList.contains("evt")) {
      const v = bus.events.find((x) => String(x.t) === e.dataset.t && x.type === e.dataset.type);
      return v ? { title: v.type, tag: "event", color: "#ff5a6e", body: "Something worth reacting to; the narrator and scene cues listen for these.",
        rows: [{ label: "At", value: `${Math.round(v.t / 1000)} s` }, ...Object.entries((v.data ?? {}) as Record<string, unknown>).slice(0, 10).map(([k, x]) => ({ label: k, value: typeof x === "object" ? JSON.stringify(x).slice(0, 40) : String(x) }))] } : null;
    }
    return null;
  };
  frame() {
    this.chips.innerHTML = bus.cameras.map((c) => `<span class="chip ok" data-cam="${c.id}">cam ${c.id} · q ${Math.round(c.quality * 100)}% · trust ${Math.round(c.reliability * 100)}%</span>`).join("") || `<span class="chip">no camera online</span>`;
    const sig = bus.lines.length + bus.events.length;
    if (sig === this.n) return; this.n = sig;
    this.lines.innerHTML = bus.lines.slice(-12).reverse().map((l) => `<div class="ln ${l.speaker}" data-t="${l.t}" data-who="${l.speaker}"><b>${l.name}</b> ${l.text}</div>`).join("");
    this.ev.innerHTML = bus.events.slice(-14).reverse().map((e) => `<div class="evt" data-t="${e.t}" data-type="${e.type}"><b>${e.type}</b> ${e.data ? JSON.stringify(e.data).slice(0, 90) : ""}</div>`).join("");
  }
}
