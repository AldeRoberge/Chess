import { PositionTracker } from "../chess/tracker";
import { Chess } from "chess.js";
import { BoardSampler, defaultSamplerConfig } from "./sampler";
import type { GrayFrame, Pt } from "./types";

export const calibrationRuntime = { active: false };
export const calibrationMoves = ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "d3", "Bc5", "O-O", "O-O", "Bxf7+"];
export function calibrationPosition(step: number) {
  const game = new Chess(); let instruction = "Set up the normal starting position. White pieces on ranks 1-2, black on ranks 7-8.";
  const names: Record<string, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
  for (const san of calibrationMoves.slice(0, step)) {
    const m = game.move(san), side = m.color === "w" ? "white" : "black";
    instruction = `Move ${side} ${names[m.piece]} from ${m.from} to ${m.to} (${m.san}).`;
    if (m.isKingsideCastle()) instruction += ` Also move the ${side} rook from h${m.from[1]} to f${m.from[1]}.`;
    if (m.captured) instruction += ` Remove the captured ${names[m.captured]} from ${m.to}.`;
    instruction += " Keep all remaining pieces in place.";
  }
  return { fen: game.fen(), instruction };
}
export interface DetectionSettings { threshold: number; shapeWeight: number; colorWeight: number; patch: number; positionWeight: number; legalMargin: number }
export const calibrationDefaults: DetectionSettings = { threshold: 0.22, shapeWeight: 1, colorWeight: 1, patch: 0.6, positionWeight: 1, legalMargin: 0.5 };
export const settingRanges: Record<keyof DetectionSettings, number[]> = { threshold: [0.15, 0.22, 0.32, 0.45], shapeWeight: [0.5, 1, 1.5, 2], colorWeight: [0.5, 1, 1.5, 2], patch: [0.4, 0.6, 0.8], positionWeight: [0, 1, 2], legalMargin: [0.3, 0.5, 0.8, 1.2] };
export interface CalibrationSample { step: number; fen: string; cameras: { id: string; corners: Pt[]; frames: GrayFrame[] }[] }
export interface CalibrationResult { label: string; settings: DetectionSettings; accuracy: number; consistency: number; score: number; legalAccuracy: number; errors: string[] }
/** Replay each candidate from the same labelled start frame. Never train references on a later position. */
export function evaluateCalibration(samples: CalibrationSample[], settings: DetectionSettings, label: string, heldOutOnly = false): CalibrationResult {
  let loss = 0, count = 0, flips = 0, pairs = 0, legalCorrect = 0, legalCount = 0; const errors = new Set<string>();
  for (const base of samples[0]?.cameras ?? []) {
    const sampler = new BoardSampler(base.id, { ...defaultSamplerConfig(), ...settings, corners: base.corners });
    sampler.calibrateFromStart(base.frames[0]);
    const tracker = new PositionTracker({ margin: settings.legalMargin });
    for (const sample of samples) {
      const camera = sample.cameras.find(c => c.id === base.id); if (!camera) continue;
      sampler.cfg.corners = camera.corners;
      const scored = !heldOutOnly || sample === samples[samples.length - 1];
      const truth = new Chess(sample.fen).board().flat(); let previous: number[] | null = null;
      for (const frame of camera.frames) {
        const obs = sampler.read(frame); const map: number[] = [];
        for (let sq = 0; sq < 64; sq++) {
          const piece = truth[sq], p = obs.occ[sq], white = obs.white[sq];
          const probability = piece ? p * (piece.color === "w" ? white : 1 - white) : 1 - p;
          if (scored) { loss += 1 - probability; count++; }
          const detected = p > 0.5 ? (white > 0.5 ? 1 : 2) : 0; map.push(detected);
          const expected = piece ? (piece.color === "w" ? 1 : 2) : 0;
          if (scored && detected !== expected) errors.add(`${base.id}: ${"abcdefgh"[sq % 8]}${8 - Math.floor(sq / 8)}`);
          if (scored && previous) { pairs++; if (previous[sq] !== detected) flips++; }
        }
        const conf = Float32Array.from(obs.occ, (p, i) => Math.abs(p - 0.5) * 2 * (p > 0.5 ? Math.abs(obs.white[i] - 0.5) * 2 : 1));
        const tracked = tracker.observe({ t: frame.t, occ: obs.occ, white: obs.white, conf, fidelity: obs.quality, settled: true, handOver: false, cams: 1 });
        if (scored && frame === camera.frames[camera.frames.length - 1]) { legalCount++; if (tracked.fen.split(" ")[0] === sample.fen.split(" ")[0]) legalCorrect++; }
        previous = map;
      }
    }
  }
  const accuracy = count ? 1 - loss / count : 0, consistency = pairs ? 1 - flips / pairs : 0;
  const legalAccuracy = legalCount ? legalCorrect / legalCount : 0;
  return { label, legalAccuracy, settings: { ...settings }, accuracy, consistency, score: accuracy * 0.7 + consistency * 0.15 + legalAccuracy * 0.15, errors: [...errors] };
}
export interface CalibrationView {
  session: string; step: number; phase: "ready" | "capturing" | "searching" | "complete" | "applied";
  fen: string; instruction: string; message: string; samples: number; results: CalibrationResult[]; validation: CalibrationResult | null; lastCapture?: CalibrationResult | null;
}
