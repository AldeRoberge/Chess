import { Chess } from "chess.js";
import type { Graph } from "../core/graph";
import type { CalibrationCommand } from "../remote/protocol";
import { calibrationRuntime, calibrationDefaults, calibrationMoves, calibrationPosition, evaluateCalibration, settingRanges, type CalibrationSample, type CalibrationView, type DetectionSettings } from "../vision/calibration";
import type { BoardSampler } from "../vision/sampler";
import type { GrayFrame } from "../vision/types";

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
      this.view = { session: Math.random().toString(36).slice(2), step: 0, phase: "ready", ...calibrationPosition(0), message: "Remove your hands, then confirm here or on your phone. Move the physical pieces yourself.", samples: 0, results: [], validation: null };
      return { ok: true, text: "Calibrate started. Set the physical board to the displayed position." };
    }
    const v = this.view;
    if (!v || c.session !== v.session || c.step !== v.step) return { ok: false, text: "The calibration step changed. Refresh and try again." };
    if (c.action === "stop") { clearInterval(this.timer); calibrationRuntime.active = false; this.view = null; return { ok: true, text: "Calibration closed." }; }
    if (c.action === "retry") {
      if (["capturing", "searching", "applied"].includes(v.phase) || !this.samples.length) return { ok: false, text: "No configuration to repeat right now." };
      const previous = this.samples.pop()!; v.step = previous.step; v.samples = this.samples.length;
      v.validation = null; v.lastCapture = null; if (v.step < calibrationMoves.length) v.results = [];
      Object.assign(v, calibrationPosition(v.step)); v.phase = "ready"; v.message = "Restore this configuration and confirm it again.";
      return { ok: true, text: v.message };
    }
    if (c.action === "apply") {
      if (v.phase !== "complete" || !v.validation || this.samples.length < 5) return { ok: false, text: "Finish training and validation first." };
      const best = v.results[0];
      if (!best || v.validation.accuracy < 0.9 || v.validation.consistency < 0.95) return { ok: false, text: "Validation is too weak to apply. Check corners and lighting, then restart Calibrate." };
      const cameras = this.cameras();
      if (!cameras.length || cameras.some(c => !this.samples[0].cameras.some(b => b.id === c.id))) return { ok: false, text: "Camera setup changed. Restart calibration." };
      for (const camera of cameras) {
        Object.assign(this.graph.nodes.get(camera.id)!.params, best.settings);
        camera.sampler.cfg = { ...camera.sampler.cfg, ...best.settings };
        camera.sampler.calibrateFromStart(this.samples[0].cameras.find(c => c.id === camera.id)!.frames[0]);
        camera.state.autoDone = true; camera.state.readOf = null;
      }
      for (const node of this.graph.nodes.values()) if (node.type === "game.tracker") node.params.margin = best.settings.legalMargin;
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
        if (v.step === calibrationMoves.length) {
          v.validation = evaluateCalibration(this.samples, v.results[0].settings, "Held-out validation", true);
          v.phase = "complete"; v.message = "Validation complete. Review accuracy, stability and disagreements before applying.";
        } else if (v.step === calibrationMoves.length - 1) { v.phase = "searching"; void this.search(v); }
        else { v.step++; Object.assign(v, calibrationPosition(v.step)); v.phase = "ready"; v.message = "Previous configuration recorded. Follow the next instruction."; }
      } else if (performance.now() - started > 12000) { clearInterval(this.timer); v.phase = "ready"; v.message = "No complete still capture. Check camera feed, lighting and hands, then retry."; }
    }, 300);
    return { ok: true, text: v.message };
  }
  private async search(v: CalibrationView) {
    let best: DetectionSettings = { ...calibrationDefaults };
    v.results = [evaluateCalibration(this.samples, best, "Default"), evaluateCalibration(this.samples, this.baseline, "Current settings")];
    v.results.sort((a, b) => b.score - a.score); best = { ...v.results[0].settings };
    for (const key of Object.keys(settingRanges) as (keyof DetectionSettings)[]) {
      for (const value of settingRanges[key]) {
        await new Promise(resolve => setTimeout(resolve, 0)); if (this.view !== v) return;
        v.results.push(evaluateCalibration(this.samples, { ...best, [key]: value }, `${key} = ${value}`));
      }
      v.results.sort((a, b) => b.score - a.score); best = { ...v.results[0].settings };
    }
    v.step++; Object.assign(v, calibrationPosition(v.step)); v.phase = "ready";
    v.message = "Search complete. Confirm this final position to validate the recommendation on held-out frames. The tracker still enforces legal moves; visual scoring does not assume a legal move was seen.";
  }
}

export function renderCalibration(root: HTMLElement, view: CalibrationView | null, run: (c: CalibrationCommand) => void) {
  root.replaceChildren();
  const add = (tag: string, text: string) => { const e = document.createElement(tag); e.textContent = text; root.append(e); return e; };
  add("h2", "Calibrate");
  const button = (label: string, action: CalibrationCommand["action"], disabled = false) => { const b = add("button", label) as HTMLButtonElement; b.className = "rm-btn"; b.disabled = disabled; b.onclick = () => run({ type: "calibrate", action, session: view?.session, step: view?.step }); };
  if (!view) { add("p", "Learn detection settings from confirmed physical positions. Align camera corners first. Calibration pauses move tracking, autoplay and camera following. Restore your game position before closing."); button("Start calibration", "start"); return; }
  add("p", `Configuration ${view.step + 1} / ${calibrationMoves.length + 1} | ${view.samples} recorded | ${view.phase}`);
  add("p", view.instruction); add("p", view.message);
  const board = add("div", ""); board.className = "calibrate-board"; board.setAttribute("aria-label", "Expected board configuration");
  const glyphs: Record<string, string> = { wk: "\u2654", wq: "\u2655", wr: "\u2656", wb: "\u2657", wn: "\u2658", wp: "\u2659", bk: "\u265a", bq: "\u265b", br: "\u265c", bb: "\u265d", bn: "\u265e", bp: "\u265f" };
  new Chess(view.fen).board().flat().forEach((p, i) => { const cell = document.createElement("span"); cell.textContent = p ? glyphs[p.color + p.type] : ""; cell.style.background = (i % 8 + Math.floor(i / 8)) % 2 ? "#62777f" : "#d9e3df"; cell.title = `${"abcdefgh"[i % 8]}${8 - Math.floor(i / 8)}`; board.append(cell); });
  if (view.lastCapture) add("p", `Last capture: ${(view.lastCapture.accuracy * 100).toFixed(1)}% visual accuracy, ${(view.lastCapture.consistency * 100).toFixed(1)}% stable. Disagreements: ${view.lastCapture.errors.join(", ") || "none"}.`);
  button("Repeat last configuration", "retry", !view.samples || ["capturing", "searching", "applied"].includes(view.phase));
  button("I moved the board into this configuration", "capture", view.phase !== "ready");
  if (view.results.length) {
    add("p", "Graph: visual accuracy (cyan), repeat-frame consistency (green). One-setting-at-a-time search finds the best tested settings, not a guaranteed global optimum. Shape means texture and edges; color means grayscale brightness. Size is sample width; position is perspective correction. Legal margin controls how far the winning legal move must beat alternatives. Legal replay is scored separately so rules cannot hide visual errors.");
    const chart = add("div", ""); chart.setAttribute("role", "img"); chart.setAttribute("aria-label", "Detection settings comparison graph");
    for (const result of view.results) {
      const row = document.createElement("div"); row.textContent = `${result.label}: ${(result.accuracy * 100).toFixed(1)}% accuracy / ${(result.consistency * 100).toFixed(1)}% stable / ${(result.legalAccuracy * 100).toFixed(0)}% legal replay`;
      for (const [value, color] of [[result.accuracy, "#59d9ef"], [result.consistency, "#57d5a2"]] as const) { const bar = document.createElement("div"); bar.style.cssText = `width:${value * 100}%;height:5px;background:${color};margin:3px 0`; row.append(bar); }
      chart.append(row);
    }
    add("pre", JSON.stringify(view.results[0].settings, null, 2));
  }
  if (view.validation) { add("p", `Validation: ${(view.validation.accuracy * 100).toFixed(1)}% accuracy, ${(view.validation.consistency * 100).toFixed(1)}% stable. Disagreements: ${view.validation.errors.join(", ") || "none"}.`); button("Apply recommended settings", "apply", view.phase !== "complete" || view.validation.accuracy < 0.9 || view.validation.consistency < 0.95); }
  button("Close calibration", "stop");
}
