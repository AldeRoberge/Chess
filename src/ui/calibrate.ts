import { Chess } from "chess.js";
import type { Graph } from "../core/graph";
import type { CalibrationCommand } from "../remote/protocol";
import { calibrationRuntime, calibrationDefaults, calibrationSteps, calibrationPosition, positionDiff, evaluateCalibration, settingRanges, type CalibrationSample, type CalibrationView, type DetectionSettings } from "../vision/calibration";
import type { BoardSampler } from "../vision/sampler";
import type { GrayFrame } from "../vision/types";
import { pieceImage, pieceSet } from "./pieceSets";

export class Calibrate {
  view: CalibrationView | null = null;
  private samples: CalibrationSample[] = [];
  private baseline: DetectionSettings = { ...calibrationDefaults };
  private timer: ReturnType<typeof setInterval> | undefined;
  constructor(private graph: Graph, private persist: () => void) {}
  private cameras() {
    return [...this.graph.nodes.values()].filter(n => n.type === "vision.boardReader" && !n.bypass).flatMap(n => {
      const state = this.graph.states.get(n.id) as { sampler?: BoardSampler; cleaned?: GrayFrame; obs?: { motion: number }; autoDone: boolean; readOf: GrayFrame | null } | undefined;
      return state?.sampler && state.cleaned ? [{ id: n.id, state, frame: state.cleaned, sampler: state.sampler }] : [];
    });
  }
  command(c: CalibrationCommand): { ok: boolean; text: string } {
    if (c.action === "start") {
      if (this.view && ["capturing", "searching"].includes(this.view.phase)) return { ok: false, text: "Calibration is busy." };
      const reader = [...this.graph.nodes.values()].find(n => n.type === "vision.boardReader");
      const tracker = [...this.graph.nodes.values()].find(n => n.type === "game.tracker");
      this.baseline = { ...calibrationDefaults };
      for (const key of Object.keys(this.baseline) as (keyof DetectionSettings)[]) {
        const value = key === "legalMargin" ? tracker?.params.margin : reader?.params[key];
        if (typeof value === "number" && Number.isFinite(value)) this.baseline[key] = value;
      }
      calibrationRuntime.active = true;
      this.samples = [];
      this.view = { session: Math.random().toString(36).slice(2), step: 0, phase: "ready", ...calibrationPosition(0), message: "Remove your hands, then confirm here or on your phone. You move the physical pieces yourself.", samples: 0, results: [], validation: null };
      return { ok: true, text: "Calibrate started. Set the physical board to the displayed position." };
    }
    const v = this.view;
    if (!v || c.session !== v.session || c.step !== v.step) return { ok: false, text: "The calibration step changed. Refresh and try again." };
    if (c.action === "stop") { clearInterval(this.timer); calibrationRuntime.active = false; this.samples = []; this.view = null; return { ok: true, text: "Calibration closed." }; }
    if (c.action === "retry") {
      if (["capturing", "searching", "applied"].includes(v.phase) || !this.samples.length) return { ok: false, text: "No configuration to repeat right now." };
      const previous = this.samples.pop()!; v.step = previous.step; v.samples = this.samples.length;
      v.validation = null; v.lastCapture = null; if (v.step < calibrationSteps - 1) v.results = [];
      Object.assign(v, calibrationPosition(v.step)); v.phase = "ready"; v.message = "Restore this configuration and confirm it again.";
      return { ok: true, text: v.message };
    }
    if (c.action === "apply") {
      if (v.phase !== "complete" || !v.validation || this.samples.length < 5) return { ok: false, text: "Finish training and validation first." };
      const best = v.results[0];
      if (!best || v.validation.accuracy < 0.9 || v.validation.consistency < 0.95) return { ok: false, text: "Validation is too weak to apply. Check corners and lighting, then restart Calibrate." };
      const cameras = this.cameras();
      if (cameras.length !== this.samples[0].cameras.length || cameras.some(c => !this.samples[0].cameras.some(b => b.id === c.id && JSON.stringify(b.corners) === JSON.stringify(c.sampler.cfg.corners)))) return { ok: false, text: "Camera setup changed. Restart calibration." };
      const { legalMargin, ...readerSettings } = best.settings;
      for (const camera of cameras) {
        Object.assign(this.graph.nodes.get(camera.id)!.params, readerSettings);
        camera.sampler.cfg = { ...camera.sampler.cfg, ...readerSettings };
        camera.sampler.calibrateFromStart(this.samples[0].cameras.find(c => c.id === camera.id)!.frames[0]);
        camera.state.autoDone = true; camera.state.readOf = null;
      }
      for (const node of this.graph.nodes.values()) if (node.type === "game.tracker") node.params.margin = legalMargin;
      this.persist(); v.phase = "applied"; v.message = "Settings saved to the workflow. Restore the board to your game position before continuing play.";
      return { ok: true, text: v.message };
    }
    if (v.phase !== "ready") return { ok: false, text: "Wait for the current capture or search." };
    const cameras = this.cameras();
    if (!cameras.length) return { ok: false, text: "Connect a camera to a Board Reader and align its corners first." };
    if (this.samples.length && (cameras.length !== this.samples[0].cameras.length || cameras.some(c => !this.samples[0].cameras.some(b => b.id === c.id && JSON.stringify(b.corners) === JSON.stringify(c.sampler.cfg.corners))))) return { ok: false, text: "Camera setup or corners changed. Restart calibration with camera following disabled." };
    v.phase = "capturing"; v.message = "Recording three fresh, still frames per camera. Keep your hands away.";
    const sample: CalibrationSample = { step: v.step, fen: v.fen, cameras: cameras.map(c => ({ id: c.id, corners: c.sampler.cfg.corners.map(p => ({ ...p })), frames: [] })) };
    const last = new Map(cameras.map(c => [c.id, c.frame.t])); const started = performance.now();
    this.timer = setInterval(() => {
      if (this.view !== v) { clearInterval(this.timer); return; }
      for (const c of this.cameras()) {
        const target = sample.cameras.find(t => t.id === c.id);
        if (!target || target.frames.length >= 3 || c.frame.t === last.get(c.id) || (c.state.obs?.motion ?? 1) > 0.02) continue;
        target.frames.push({ ...c.frame, data: c.frame.data.slice() }); last.set(c.id, c.frame.t);
      }
      if (sample.cameras.every(c => c.frames.length === 3)) {
        clearInterval(this.timer); this.samples.push(sample); v.samples = this.samples.length;
        v.lastCapture = evaluateCalibration(this.samples, v.results[0]?.settings ?? calibrationDefaults, "Latest capture", true);
        if (v.step === calibrationSteps - 1) {
          v.validation = evaluateCalibration(this.samples, v.results[0].settings, "Held-out validation", true);
          v.phase = "complete"; v.message = "Validation complete. Review accuracy, stability and disagreements before applying.";
        } else if (v.step === calibrationSteps - 2) { v.phase = "searching"; void this.search(v); }
        else { v.step++; Object.assign(v, calibrationPosition(v.step)); v.phase = "ready"; v.message = "Recorded. Set up the next board."; }
      } else if (performance.now() - started > 12000) { clearInterval(this.timer); v.phase = "ready"; v.message = "No complete still capture. Check camera feed, lighting and hands, then retry."; }
    }, 300);
    return { ok: true, text: v.message };
  }
  private async search(v: CalibrationView) {
    let best: DetectionSettings = { ...calibrationDefaults };
    v.results = [evaluateCalibration(this.samples, best, "Default"), evaluateCalibration(this.samples, this.baseline, "Current settings")];
    v.results.sort((a, b) => b.score - a.score); best = { ...v.results[0].settings };
    for (let pass = 1; pass <= 2; pass++) for (const key of Object.keys(settingRanges) as (keyof DetectionSettings)[]) {
      for (const value of settingRanges[key]) {
        if (best[key] === value) continue;
        await new Promise(resolve => setTimeout(resolve, 0)); if (this.view !== v) return;
        v.results.push(evaluateCalibration(this.samples, { ...best, [key]: value }, `${key} = ${value}${pass > 1 ? " (refine)" : ""}`));
      }
      v.results.sort((a, b) => b.score - a.score); best = { ...v.results[0].settings };
    }
    v.step++; Object.assign(v, calibrationPosition(v.step)); v.phase = "ready";
    v.message = "Search complete. Set up this last board, which was never used for tuning, to check the result.";
  }
}


// ---- panel ------------------------------------------------------------------------------------------------------
// The panel is built once and then patched in place. Every region has a reserved size, so a status change, a new
// capture or a reload of the view never moves the board or the buttons.

const CAL_CSS = `
.cal{--cal-line:#3d5864;--cal-ink:#1e3440;--cal-text:#eaf3f5;--cal-dim:#a9bec6;--cal-accent:#4aa3ff;--cal-on:#ffffff;display:flex;flex-direction:column;gap:14px;color:var(--cal-text)}
.cal h2{margin:0;font-size:20px;color:var(--cal-text)}
.cal p,.cal summary,.cal div,.cal pre{color:inherit}
.cal-head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:30px}
.cal-chip{font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;border:1px solid var(--cal-line);color:var(--cal-dim);white-space:nowrap}
.cal-chip[data-phase=capturing],.cal-chip[data-phase=searching]{color:var(--cal-accent);border-color:var(--cal-accent)}
.cal-chip[data-phase=complete],.cal-chip[data-phase=applied]{color:#57d5a2;border-color:#57d5a2}
.cal-progress{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:3px;height:6px}
.cal-progress i{background:var(--cal-line);border-radius:3px;transition:background .25s}
.cal-progress i.done{background:var(--cal-accent)} .cal-progress i.now{background:#e6d83c}
.cal-stage{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;align-items:start}
.cal-col{display:flex;flex-direction:column;gap:6px;min-width:0}
.cal-cap{font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--cal-dim)}
.cal-boardwrap{position:relative;width:100%;max-width:330px;aspect-ratio:1;border-radius:8px;overflow:hidden;box-shadow:0 0 0 1px var(--cal-line)}
.cal-board{position:absolute;inset:0;display:grid;grid-template-columns:repeat(8,1fr);grid-template-rows:repeat(8,1fr)}
.cal-board span{position:relative;display:block;min-width:0;min-height:0}
.cal-board span img{display:block;width:100%;height:100%;pointer-events:none}
.cal-board span.from{box-shadow:inset 0 0 0 3px #ffb347;background-image:linear-gradient(#ffb34777,#ffb34777)}
.cal-board span.to{box-shadow:inset 0 0 0 3px #2fd47f;background-image:linear-gradient(#2fd47f66,#2fd47f66)}
.cal-board span.off{box-shadow:inset 0 0 0 3px #ff5a50;background-image:linear-gradient(#ff5a5066,#ff5a5066)}
.cal-board span .x{position:absolute;inset:0;display:grid;place-items:center;font:700 22px/1 system-ui,sans-serif;color:#ff3b30;text-shadow:0 0 3px #fff}
.cal-legend{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12.5px;color:var(--cal-dim)}
.cal-legend i{display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:6px;vertical-align:-1px}
.cal-side{display:flex;flex-direction:column;gap:10px;min-width:0}
.cal-instr{min-height:3em;margin:0;font-size:16px;line-height:1.45;color:var(--cal-text)}
.cal-msg{min-height:2.8em;margin:0;color:var(--cal-dim);font-size:14px;line-height:1.4}
.cal-last{min-height:2.4em;margin:0;font-size:13px;color:var(--cal-dim)}
.cal-actions{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:10px}
.cal .cal-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:46px;padding:0 14px;margin:0;border:1px solid var(--cal-line);border-radius:10px;background:var(--cal-ink);color:var(--cal-text);font:600 14px/1 system-ui,sans-serif;cursor:pointer}
.cal .cal-btn svg{width:18px;height:18px;flex:none}
.cal .cal-btn:disabled{opacity:.4;cursor:default}
.cal .cal-btn.primary{background:var(--cal-accent);color:var(--cal-on);border-color:transparent}
.cal .cal-btn:focus-visible{outline:2px solid var(--cal-accent);outline-offset:2px}
.cal-close{justify-self:end;background:none;border:0;color:var(--cal-dim);font:13px system-ui,sans-serif;cursor:pointer;padding:6px 4px}
.cal-close:disabled{opacity:.4;cursor:default}
.cal-details{border-top:1px solid var(--cal-line);padding-top:10px;font-size:12.5px}
.cal-details summary{cursor:pointer;color:var(--cal-dim)}
.cal-results{max-height:220px;overflow:auto;margin-top:8px}
.cal-results div.row{margin-bottom:6px}
.cal-results pre{margin:8px 0 0;font-size:12px}
`;
const ICON = {
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l12-7.5z"/></svg>',
  spin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 3a9 9 0 1 0 9 9"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur=".9s" repeatCount="indefinite"/></path></svg>',
};
const PHASE_LABEL: Record<CalibrationView["phase"], string> = { ready: "Waiting for you", capturing: "Capturing…", searching: "Analysing…", complete: "Review", applied: "Saved" };
const IDLE_TEXT = "Teach the camera what your pieces look like. You will set up 5 different boards from famous games, each with many pieces moved at once, and the camera tunes seven detection levers from them. Align the camera corners first. Move tracking, autoplay and camera following pause meanwhile.";

function pieceSrc(code: string): string {
  const img = pieceImage(code);
  if (img instanceof HTMLImageElement && img.src) return img.src;
  if (img instanceof HTMLCanvasElement) { try { return img.toDataURL(); } catch { /* fall through */ } }
  let base = "/"; try { base = (import.meta as any).env?.BASE_URL ?? "/"; } catch { /* default */ }
  return `${base}pieces/${pieceSet().id}/${code}.svg`;
}
const sqXY = (sq: string) => ({ x: "abcdefgh".indexOf(sq[0]), y: 8 - Number(sq[1]) });
function changes(step: number, fen: string) {
  if (step < 1) return null;
  return positionDiff(calibrationPosition(step - 1).fen, fen);
}

interface Shell { el: HTMLElement; set: (view: CalibrationView | null, run: (c: CalibrationCommand) => void) => void }
const shells = new WeakMap<HTMLElement, Shell>();

function buildShell(): Shell {
  if (!document.getElementById("cal-css")) { const s = document.createElement("style"); s.id = "cal-css"; s.textContent = CAL_CSS; document.head.append(s); }
  const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", parent?: HTMLElement, text = "") => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; parent?.append(e); return e; };
  const el = mk("div", "cal");
  const head = mk("div", "cal-head", el); mk("h2", "", head, "Calibrate"); const chip = mk("span", "cal-chip", head);
  const progress = mk("div", "cal-progress", el); progress.setAttribute("aria-hidden", "true");
  const total = calibrationSteps;
  const bars = Array.from({ length: total }, () => mk("i", "", progress));
  const stage = mk("div", "cal-stage", el);
  const makeBoard = (title: string, cls: string) => {
    const col = mk("div", "cal-col", stage); mk("div", "cal-cap", col, title);
    const wrap = mk("div", "cal-boardwrap", col), board = mk("div", cls, wrap);
    return Array.from({ length: 64 }, (_, i) => { const c = mk("span", "", board); c.style.background = (i % 8 + Math.floor(i / 8)) % 2 ? "#62777f" : "#d9e3df"; c.title = `${"abcdefgh"[i % 8]}${8 - Math.floor(i / 8)}`; return c; });
  };
  const beforeCells = makeBoard("Your board now", "cal-board cal-before"), cells = makeBoard("Set it up like this", "calibrate-board cal-board");
  const side = mk("div", "cal-side", el);
  const step = mk("div", "", side); step.style.cssText = "font-size:12px;font-weight:600;color:var(--cal-dim);text-transform:uppercase;letter-spacing:.06em";
  const instr = mk("p", "cal-instr", side);
  const legend = mk("div", "cal-legend", side);
  for (const [color, text] of [["#ffb347", "pick up here"], ["#2fd47f", "put it here"], ["#ff5a50", "take off the board"]]) { const l = mk("span", "", legend); mk("i", "", l).style.background = color; l.append(text); }
  const msg = mk("p", "cal-msg", side), last = mk("p", "cal-last", side);
  const actions = mk("div", "cal-actions", el);
  const back = mk("button", "cal-btn", actions), main = mk("button", "cal-btn primary", actions);
  back.type = main.type = "button";
  const close = mk("button", "cal-close", el, "Stop and close"); close.type = "button";
  const details = mk("details", "cal-details", el); mk("summary", "", details, "Detection details");
  const results = mk("div", "cal-results", details);
  let boardKey = "", resultKey = "", onMain: () => void = () => {}, onBack: () => void = () => {}, onClose: () => void = () => {};
  main.onclick = () => onMain(); back.onclick = () => onBack(); close.onclick = () => onClose();
  const setBtn = (b: HTMLButtonElement, icon: string, label: string, disabled: boolean) => { if (b.dataset.k !== icon + label) { b.innerHTML = icon; b.append(label); b.dataset.k = icon + label; } b.disabled = disabled; };

  const drawBoard = (view: CalibrationView | null) => {
    const key = view ? `${view.step}|${view.fen}` : "idle";
    if (key === boardKey) return; boardKey = key;
    const fill = (target: HTMLElement[], fen: string | null) => {
      const board = fen ? new Chess(fen).board().flat() : Array(64).fill(null);
      board.forEach((p, i) => { const c = target[i]; c.replaceChildren(); c.className = ""; if (p) { const img = document.createElement("img"); img.src = pieceSrc(p.color + p.type); img.alt = ""; img.draggable = false; c.append(img); } });
    };
    const step = view?.step ?? 0, diff = changes(step, view?.fen ?? new Chess().fen());
    fill(cells, view?.fen ?? new Chess().fen()); fill(beforeCells, step > 0 ? calibrationPosition(step - 1).fen : null);
    const at = (t: HTMLElement[], sq: string) => t[sqXY(sq).y * 8 + sqXY(sq).x];
    if (!diff) { for (const c of cells) c.classList.add("to"); return; } // first board: every piece goes on
    const cross = (c: HTMLElement) => { const x = document.createElement("b"); x.textContent = "✕"; x.className = "x"; c.append(x); };
    for (const m of diff.moves) { at(beforeCells, m.from).classList.add("from"); at(cells, m.to).classList.add("to"); }
    for (const r of diff.removed) { const c = at(beforeCells, r.sq); c.classList.add("off"); cross(c); }
    for (const r of diff.added) at(cells, r.sq).classList.add("to");
  };

  const drawResults = (view: CalibrationView) => {
    const key = `${view.results.length}|${view.validation ? 1 : 0}|${view.results[0]?.score}`;
    if (key === resultKey) return; resultKey = key; results.replaceChildren();
    if (!view.results.length) { mk("div", "", results, "Results appear after the last position is captured."); return; }
    mk("p", "", results, "Cyan: visual accuracy. Green: repeat-frame consistency. Settings are tested one at a time, so this is the best tested set, not a guaranteed optimum. Exact boards is the share of captures where all 64 squares were read correctly.").style.margin = "0 0 8px";
    for (const r of view.results) {
      const row = mk("div", "row", results, `${r.label}: ${(r.accuracy * 100).toFixed(1)}% accuracy / ${(r.consistency * 100).toFixed(1)}% stable / ${(r.exactBoards * 100).toFixed(0)}% exact boards`);
      for (const [v, color] of [[r.accuracy, "#59d9ef"], [r.consistency, "#57d5a2"]] as const) mk("div", "", row).style.cssText = `width:${v * 100}%;height:5px;background:${color};margin:3px 0`;
    }
    mk("pre", "", results, JSON.stringify(view.results[0].settings, null, 2));
  };

  return { el, set(view, run) {
    const cmd = (action: CalibrationCommand["action"]) => () => run({ type: "calibrate", action, session: view?.session, step: view?.step });
    drawBoard(view);
    details.hidden = !view?.results.length; if (view) drawResults(view);
    if (!view) {
      chip.textContent = "Not started"; chip.dataset.phase = "idle"; step.textContent = "Before you begin";
      bars.forEach(b => b.className = ""); instr.textContent = IDLE_TEXT; msg.textContent = "Restore your game position before closing."; last.textContent = "";
      setBtn(back, ICON.undo, "Redo previous", true); setBtn(main, ICON.play, "Start calibration", false);
      close.hidden = true; onMain = cmd("start"); return;
    }
    close.hidden = false; close.disabled = false;
    const busy = view.phase === "capturing" || view.phase === "searching", n = calibrationSteps;
    chip.textContent = PHASE_LABEL[view.phase]; chip.dataset.phase = view.phase;
    bars.forEach((b, i) => b.className = i < Math.min(view.step, n) ? "done" : i === view.step ? "now" : "");
    step.textContent = view.phase === "complete" || view.phase === "applied" ? "All positions recorded" : `Position ${Math.min(view.step + 1, n)} of ${n}  ·  ${view.samples} recorded`;
    instr.textContent = view.instruction; msg.textContent = view.message;
    last.textContent = view.lastCapture ? `Last capture: ${(view.lastCapture.accuracy * 100).toFixed(0)}% accurate, ${(view.lastCapture.consistency * 100).toFixed(0)}% stable. Disagreements: ${view.lastCapture.errors.join(", ") || "none"}.` : "";
    setBtn(back, ICON.undo, "Redo previous", !view.samples || busy || view.phase === "applied");
    onBack = cmd("retry"); onClose = cmd("stop");
    if (view.phase === "complete" && view.validation) {
      const weak = view.validation.accuracy < 0.9 || view.validation.consistency < 0.95;
      setBtn(main, ICON.check, "Apply settings", weak); onMain = cmd("apply");
      last.textContent = `Validation: ${(view.validation.accuracy * 100).toFixed(1)}% accurate, ${(view.validation.consistency * 100).toFixed(1)}% stable.${weak ? " Too weak to apply: check corners and lighting, then restart." : ""} Disagreements: ${view.validation.errors.join(", ") || "none"}.`;
    } else if (view.phase === "applied") { setBtn(main, ICON.check, "Done", false); onMain = cmd("stop"); }
    else if (busy) { setBtn(main, ICON.spin, view.phase === "capturing" ? "Capturing…" : "Analysing…", true); onMain = () => {}; }
    else { setBtn(main, ICON.camera, "I moved the pieces. Capture", false); onMain = cmd("capture"); }
  } };
}

export function renderCalibration(root: HTMLElement, view: CalibrationView | null, run: (c: CalibrationCommand) => void) {
  let shell = shells.get(root);
  if (!shell || shell.el.parentElement !== root) { shell = buildShell(); shells.set(root, shell); root.replaceChildren(shell.el); }
  shell.set(view, run);
}
