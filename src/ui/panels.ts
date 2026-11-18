import type { Graph } from "../core/graph";
import { bus } from "../core/bus";
import { extractSurfaces } from "../mapping/planes";
import { runCalibration } from "../mapping/calibrator";
import { loadMapping, saveMapping, defaultMapping, type MappingConfig } from "../mapping/store";
import { virtualTable } from "../sim/virtualTable";
import { SQUARE } from "../world/coords";
import { sqName } from "../vision/types";
import { WorldView } from "../world/view";
import { drawTableOverlay } from "../world/overlay";
import { registerContextMenu } from "./contextMenu";
import { viewMenu } from "./menus/viewMenu";
import { dueFrame, pixelRatio, setDisplay, viewSettings } from "./viewSettings";
import { PIECE_SETS, pieceColors, pieceImage, pieceSet, setPieceColors, setPieceSet } from "./pieceSets";
import { BOARD_THEMES, boardTheme, setBoardTheme } from "./boardThemes";
import { openChannel, type InMsg } from "./channel";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
const GLYPH: Record<string, string> = { wp: "♙", wn: "♘", wb: "♗", wr: "♖", wq: "♕", wk: "♔", bp: "♟", bn: "♞", bb: "♝", br: "♜", bq: "♛", bk: "♚" };

/** The virtual table: play moves with the mouse (a simulated hand carries the piece past the cameras), hover menu buttons to test dwell selection. */
export class TablePanel {
  root = el("div", "panel table");
  private cv = el("canvas"); private info = el("div", "muted");
  private px = 44; private margin = 3; private sel: number | null = null;

  constructor() {
    this.cv.width = this.cv.height = (8 + this.margin * 2) * this.px;
    this.cv.className = "table-cv";
    const bar = el("div", "bar");
    const reset = el("button", "", "Reset table"); reset.onclick = () => virtualTable.reset();
    const seat = el("button", "", "Sit / stand"); seat.onclick = () => { virtualTable.seated = !virtualTable.seated; this.seatCb(virtualTable.seated); };
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
      virtualTable.pointer = pos(e);
      if (virtualTable.hoverHand && !virtualTable.busy) { virtualTable.hand = { ...virtualTable.pointer }; virtualTable.carried = null; virtualTable.setHoverHand(); }
    };
    this.cv.onmouseleave = () => { virtualTable.pointer = null; if (virtualTable.hoverHand && !virtualTable.busy) virtualTable.hand = null; };
    this.cv.onclick = (e) => {
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
      if (!p || virtualTable.carried === r * 8 + col) return;
      const img = pieceImage(p.color + p.type);
      if (img) { c.drawImage(img, col * px, r * px, px, px); return; }
      const g = GLYPH["b" + p.type]; c.fillStyle = p.color === "w" ? "#fdfdfd" : "#262421"; c.strokeStyle = p.color === "w" ? "#3b3a37" : "#0d0d0d"; c.lineWidth = p.color === "w" ? 2.2 : 1.2; c.strokeText(g, (col + 0.5) * px, (r + 0.55) * px); c.fillText(g, (col + 0.5) * px, (r + 0.55) * px);
    }));
    this.drawArms(c, px);
    c.restore();
    drawTableOverlay(c, px, m, { game: bus.game, director: bus.director, hint: bus.engineHint, clock: bus.clockView, lastMove: disp.lastMove, hints: disp.hints }, now / 1000, false);
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
    const scan = el("label", "btn", "Import room scan (.glb/.obj)"); const file = el("input"); file.type = "file"; file.accept = ".glb,.gltf,.obj"; file.hidden = true; scan.append(file);
    file.onchange = () => file.files?.[0] && void this.importScan(file.files[0]);
    const reset = el("button", "", "Default room"); reset.onclick = () => { this.cfg = defaultMapping(); this.apply(); };
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
    const l = el("label", "chk"); const c = el("input"); c.type = "checkbox"; c.checked = on; c.onchange = () => cb(c.checked); l.append(c, document.createTextNode(label)); return l;
  }

  private apply() { saveMapping(this.cfg); this.view.setMapping(this.cfg); this.ch.postMessage({ type: "mapping" }); }

  private renderRig(rig: HTMLElement) {
    rig.replaceChildren();
    this.cfg.projectors.forEach((p, i) => {
      const row = el("div", "rig-row"); row.append(el("b", "", p.id));
      const open = el("button", "", "Open output"); open.onclick = () => { this.wins.set(i, window.open(`?output=${i}`, `cx-out-${i}`, "popup,width=960,height=540")); };
      const cal = el("button", "", this.cfg.calibration[p.id] ? `Re-calibrate (${this.cfg.calibration[p.id].rms.toFixed(1)}px)` : "Auto-calibrate"); cal.onclick = () => void this.calibrate(i);
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
  frame() {
    this.chips.innerHTML = bus.cameras.map((c) => `<span class="chip ok">cam ${c.id} · q ${Math.round(c.quality * 100)}% · trust ${Math.round(c.reliability * 100)}%</span>`).join("") || `<span class="chip">no camera online</span>`;
    const sig = bus.lines.length + bus.events.length;
    if (sig === this.n) return; this.n = sig;
    this.lines.innerHTML = bus.lines.slice(-12).reverse().map((l) => `<div class="ln ${l.speaker}"><b>${l.name}</b> ${l.text}</div>`).join("");
    this.ev.innerHTML = bus.events.slice(-14).reverse().map((e) => `<div class="evt"><b>${e.type}</b> ${e.data ? JSON.stringify(e.data).slice(0, 90) : ""}</div>`).join("");
  }
}
