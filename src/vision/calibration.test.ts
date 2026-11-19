import { afterEach, describe, expect, it, vi } from "vitest";
import { Chess } from "chess.js";
import { Graph } from "../core/graph";
import { createRegistry } from "../plugins";
import { parseCommand } from "../remote/protocol";
import { Calibrate, renderCalibration } from "../ui/calibrate";
import { BoardSampler, defaultSamplerConfig } from "./sampler";
import { calibrationDefaults, calibrationGames, calibrationSteps, calibrationPosition, positionDiff, calibrationRuntime, evaluateCalibration, type CalibrationSample } from "./calibration";
import type { GrayFrame } from "./types";

const corners = [{ x: 0, y: 0 }, { x: 320, y: 0 }, { x: 320, y: 320 }, { x: 0, y: 320 }];
function picture(fen: string, t: number): GrayFrame {
  const pieces = new Chess(fen).board().flat(), data = new Uint8ClampedArray(320 * 320);
  for (let y = 0; y < 320; y++) for (let x = 0; x < 320; x++) {
    const file = Math.floor(x / 40), row = Math.floor(y / 40), p = pieces[row * 8 + file];
    const inPiece = Math.hypot(x % 40 - 20, y % 40 - 20) < 14;
    data[y * 320 + x] = p && inPiece ? (p.color === "w" ? 225 : 25) + ((x + y) % 5) : (file + row) % 2 ? 90 : 170;
  }
  return { width: 320, height: 320, data, t };
}
function sample(step: number): CalibrationSample {
  const fen = calibrationPosition(step).fen;
  return { step, fen, cameras: [{ id: "camera", corners, frames: [0, 1, 2].map(i => picture(fen, step * 1000 + i * 300)) }] };
}
afterEach(() => { calibrationRuntime.active = false; vi.useRealTimers(); });

describe("Calibrate", () => {
  it("uses five distinct boards that each move many pieces, starting from the start position", () => {
    expect(calibrationSteps).toBe(5); expect(calibrationGames).toHaveLength(5);
    for (let i = 0; i < calibrationSteps; i++) expect(() => new Chess(calibrationPosition(i).fen)).not.toThrow();
    expect(calibrationPosition(0).fen).toBe(new Chess().fen());
    for (let i = 1; i < calibrationSteps; i++) {
      const d = positionDiff(calibrationPosition(i - 1).fen, calibrationPosition(i).fen);
      expect(d.moves.length + d.removed.length + d.added.length).toBeGreaterThanOrEqual(6);
      expect(calibrationPosition(i).instruction).toContain("Rearrange");
    }
  });
  it("scores real pixels against confirmed labels, preserves evidence, and isolates validation", () => {
    const samples = [sample(0), sample(1)], before = samples[0].cameras[0].frames[0].data.slice();
    const correct = evaluateCalibration(samples, calibrationDefaults, "correct");
    const wrong = evaluateCalibration([samples[0], { ...samples[1], fen: calibrationPosition(3).fen }], calibrationDefaults, "wrong");
    expect(correct.accuracy).toBeGreaterThan(wrong.accuracy);
    expect(correct.consistency).toBe(1); expect(wrong.errors.length).toBeGreaterThan(correct.errors.length);
    expect(samples[0].cameras[0].frames[0].data).toEqual(before);
    expect(evaluateCalibration(samples, calibrationDefaults, "validation", true).score).toBeGreaterThan(0);
    expect(evaluateCalibration([], calibrationDefaults, "empty").score).toBe(0);
  });
  it("validates phone calibration commands including stale-step metadata", () => {
    expect(parseCommand({ type: "calibrate", action: "start" })).toEqual({ type: "calibrate", action: "start" });
    expect(parseCommand({ type: "calibrate", action: "capture", session: "abc", step: 4 })).toMatchObject({ step: 4 });
    for (const bad of [{ action: "capture" }, { action: "unknown" }, { action: "apply", session: "a", step: -1 }, { action: "capture", session: "a", step: 0.5 }]) expect(parseCommand({ type: "calibrate", ...bad })).toBeNull();
  });
  it("requires fresh still frames, rejects stale confirmations, and permits retry without saving settings", async () => {
    vi.useFakeTimers();
    const graph = new Graph(createRegistry()), node = graph.addNode("vision.boardReader");
    const state = graph.states.get(node.id); state.sampler = new BoardSampler("A", { ...defaultSamplerConfig(), corners });
    state.cleaned = picture(calibrationPosition(0).fen, 1); state.obs = { motion: 0 };
    const persist = vi.fn(), cal = new Calibrate(graph, persist);
    cal.command({ type: "calibrate", action: "start" }); expect(calibrationRuntime.active).toBe(true);
    const capture = { type: "calibrate" as const, action: "capture" as const, session: cal.view!.session, step: 0 };
    expect(cal.command({ ...capture, session: "stale" }).ok).toBe(false);
    expect(cal.command(capture).ok).toBe(true);
    await vi.advanceTimersByTimeAsync(900); expect(cal.view!.samples).toBe(0);
    for (let i = 0; i < 3; i++) { state.cleaned = picture(calibrationPosition(0).fen, 2 + i); await vi.advanceTimersByTimeAsync(300); }
    expect(cal.view).toMatchObject({ samples: 1, step: 1, phase: "ready" });
    expect(cal.command(capture).ok).toBe(false);
    expect(cal.command({ ...capture, action: "apply", step: 1 }).ok).toBe(false); expect(persist).not.toHaveBeenCalled();
    cal.command({ ...capture, action: "retry", step: 1 }); expect(cal.view).toMatchObject({ step: 0, samples: 0 });
    cal.command({ ...capture, action: "stop" }); expect(cal.view).toBeNull(); expect(calibrationRuntime.active).toBe(false);
  });
  it("runs the complete capture, search, held-out validation and apply workflow", async () => {
    vi.useFakeTimers(); const graph = new Graph(createRegistry());
    const reader = graph.addNode("vision.boardReader"), tracker = graph.addNode("game.tracker");
    const state = graph.states.get(reader.id); state.sampler = new BoardSampler("A", { ...defaultSamplerConfig(), corners });
    state.obs = { motion: 0 }; let timestamp = 0; state.cleaned = picture(calibrationPosition(0).fen, timestamp);
    const persist = vi.fn(), cal = new Calibrate(graph, persist); cal.command({ type: "calibrate", action: "start" });
    for (let step = 0; step < calibrationSteps; step++) {
      expect(cal.view!.step).toBe(step);
      const command = { type: "calibrate" as const, action: "capture" as const, session: cal.view!.session, step };
      expect(cal.command(command).ok).toBe(true);
      for (let i = 0; i < 3; i++) { state.cleaned = picture(calibrationPosition(step).fen, ++timestamp); await vi.advanceTimersByTimeAsync(300); }
      if (cal.view!.phase === "searching") await vi.advanceTimersByTimeAsync(1000);
    }
    expect(cal.view!.phase).toBe("complete"); expect(cal.view!.results.length).toBeGreaterThan(20);
    expect(cal.view!.validation!.accuracy).toBeGreaterThan(0.9);
    const best = cal.view!.results[0].settings;
    expect(cal.command({ type: "calibrate", action: "apply", session: cal.view!.session, step: cal.view!.step }).ok).toBe(true);
    expect(persist).toHaveBeenCalledOnce(); expect(reader.params.patch).toBe(best.patch); expect(tracker.params.margin).toBe(best.legalMargin);
    cal.command({ type: "calibrate", action: "stop", session: cal.view!.session, step: cal.view!.step });
  });
  it("renders the phone confirmation with the session and configuration it describes", () => {
    const root = document.createElement("div"), run = vi.fn();
    renderCalibration(root, { session: "session", step: 1, phase: "ready", ...calibrationPosition(1), message: "Ready", samples: 1, results: [], validation: null }, run);
    expect(root.querySelectorAll(".calibrate-board span")).toHaveLength(64);
    const capture = [...root.querySelectorAll("button")].find(b => b.textContent?.startsWith("I moved"))!;
    capture.click(); expect(run).toHaveBeenCalledWith({ type: "calibrate", action: "capture", session: "session", step: 1 });
  });
});
