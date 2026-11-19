import { Chess } from "chess.js";
import { BoardSampler, defaultSamplerConfig } from "./sampler";
import type { GrayFrame, Pt } from "./types";

export const calibrationRuntime = { active: false };
/** Five boards. Step 0 must be the start position: the reader learns its references from it. The other four have at most five pieces, in both colours, on light and dark squares and on the edges, so they are quick to set up. The last one is held out to validate. */
export const calibrationGames: { title: string; fen: string }[] = [
  { title: "Starting position", fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" },
  { title: "Board 2 of 5: five pieces", fen: "4k3/8/8/3q4/8/8/3P4/R3K3 w - - 0 1" },
  { title: "Board 3 of 5: five pieces", fen: "6k1/5n2/8/8/2B5/8/8/4K2R w - - 0 1" },
  { title: "Board 4 of 5: five pieces", fen: "8/2k5/8/4p3/3N4/8/5P2/4K3 w - - 0 1" },
  { title: "Board 5 of 5: five pieces (check)", fen: "2r5/8/5k2/8/8/2K5/1B6/6Q1 w - - 0 1" },
];
export const calibrationSteps = calibrationGames.length;
const NAMES: Record<string, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
const gameAt = (step: number) => new Chess(calibrationGames[step].fen);
export interface PositionDiff { moves: { from: string; to: string; code: string }[]; removed: { sq: string; code: string }[]; added: { sq: string; code: string }[] }
const grid = (fen: string) => new Chess(fen).board().flat().map((p, i) => ({ sq: `${"abcdefgh"[i % 8]}${8 - Math.floor(i / 8)}`, code: p ? p.color + p.type : "" }));
/** What the player has to do to turn one board into the next: pieces that slide to a new square, pieces that come off, and pieces that go on. */
export function positionDiff(fromFen: string, toFen: string): PositionDiff {
  const a = grid(fromFen), b = grid(toFen);
  const removed = a.filter((x, i) => x.code && x.code !== b[i].code), added = b.filter((x, i) => x.code && x.code !== a[i].code);
  const moves: PositionDiff["moves"] = [], left: PositionDiff["removed"] = [];
  const file = (sq: string) => "abcdefgh".indexOf(sq[0]), rank = (sq: string) => Number(sq[1]);
  for (const r of removed) {
    let best = -1, bd = Infinity;
    added.forEach((t, i) => { if (t.code !== r.code) return; const d = Math.hypot(file(t.sq) - file(r.sq), rank(t.sq) - rank(r.sq)); if (d < bd) { bd = d; best = i; } });
    if (best >= 0) { moves.push({ from: r.sq, to: added[best].sq, code: r.code }); added.splice(best, 1); } else left.push(r);
  }
  return { moves, removed: left, added };
}
export function calibrationPosition(step: number) {
  const game = gameAt(step), title = calibrationGames[step].title;
  if (step === 0) return { fen: game.fen(), title, instruction: "Set up the normal starting position. White pieces on ranks 1-2, black on ranks 7-8." };
  const d = positionDiff(gameAt(step - 1).fen(), game.fen()), parts: string[] = [];
  if (d.moves.length) parts.push(`move ${d.moves.length} piece${d.moves.length > 1 ? "s" : ""}`);
  if (d.removed.length) parts.push(`take ${d.removed.length} off the board`);
  if (d.added.length) parts.push(`put ${d.added.length} back on`);
  const text = parts.join(", ");
  return { fen: game.fen(), title, instruction: `${title}. Change the board to match: ${text}. Copy the right-hand board.` };
}
export interface DetectionSettings { threshold: number; shapeWeight: number; colorWeight: number; patch: number; positionWeight: number; softness: number; grid: number; legalMargin: number }
export const calibrationDefaults: DetectionSettings = { threshold: 0.22, shapeWeight: 1, colorWeight: 1, patch: 0.6, positionWeight: 1, softness: 0.06, grid: 8, legalMargin: 0.5 };
/** The levers the search turns, one at a time. legalMargin is the tracker's and cannot be judged from jumps between unrelated boards, so it keeps its current value. */
export const settingRanges: Record<keyof DetectionSettings, number[]> = { threshold: [0.12, 0.15, 0.18, 0.22, 0.27, 0.32, 0.4, 0.5], shapeWeight: [0.25, 0.5, 1, 1.5, 2], colorWeight: [0.25, 0.5, 1, 1.5, 2], patch: [0.35, 0.45, 0.6, 0.7, 0.8], positionWeight: [0, 0.5, 1, 1.5, 2], softness: [0.03, 0.045, 0.06, 0.09, 0.13], grid: [4, 6, 8], legalMargin: [] };
export interface CalibrationSample { step: number; fen: string; cameras: { id: string; corners: Pt[]; frames: GrayFrame[] }[] }
export interface CalibrationResult { label: string; settings: DetectionSettings; accuracy: number; consistency: number; score: number; exactBoards: number; errors: string[]; /** Accuracy per camera id, so one bad camera is not hidden inside the average. */ cameraAccuracy?: Record<string, number> }
/** Replay each candidate from the same labelled start frame. Never train references on a later position. */
export function evaluateCalibration(samples: CalibrationSample[], settings: DetectionSettings, label: string, heldOutOnly = false): CalibrationResult {
  let loss = 0, count = 0, flips = 0, pairs = 0, exactCorrect = 0, exactCount = 0; const errors = new Set<string>();
  const perCamera: Record<string, number> = {};
  for (const base of samples[0]?.cameras ?? []) {
    const loss0 = loss, count0 = count;
    const sampler = new BoardSampler(base.id, { ...defaultSamplerConfig(), ...settings, corners: base.corners });
    sampler.calibrateFromStart(base.frames[0]);
    for (const sample of samples) {
      const camera = sample.cameras.find(c => c.id === base.id); if (!camera) continue;
      sampler.cfg.corners = camera.corners;
      const scored = !heldOutOnly || sample === samples[samples.length - 1];
      const truth = new Chess(sample.fen).board().flat(); let previous: number[] | null = null;
      for (const frame of camera.frames) {
        const obs = sampler.read(frame); const map: number[] = []; let wrong = 0;
        for (let sq = 0; sq < 64; sq++) {
          const piece = truth[sq], p = obs.occ[sq], white = obs.white[sq];
          const probability = piece ? p * (piece.color === "w" ? white : 1 - white) : 1 - p;
          if (scored) { loss += 1 - probability; count++; }
          const detected = p > 0.5 ? (white > 0.5 ? 1 : 2) : 0; map.push(detected);
          const expected = piece ? (piece.color === "w" ? 1 : 2) : 0;
          if (detected !== expected) wrong++;
          if (scored && detected !== expected) errors.add(`${base.id}: ${"abcdefgh"[sq % 8]}${8 - Math.floor(sq / 8)}`);
          if (scored && previous) { pairs++; if (previous[sq] !== detected) flips++; }
        }
        if (scored && frame === camera.frames[camera.frames.length - 1]) { exactCount++; if (!wrong) exactCorrect++; }
        previous = map;
      }
    }
    if (count > count0) perCamera[base.id] = 1 - (loss - loss0) / (count - count0);
  }
  const accuracy = count ? 1 - loss / count : 0, consistency = pairs ? 1 - flips / pairs : 0;
  const exactBoards = exactCount ? exactCorrect / exactCount : 0;
  return { label, exactBoards, settings: { ...settings }, accuracy, consistency, score: accuracy * 0.75 + consistency * 0.1 + exactBoards * 0.15, errors: [...errors], cameraAccuracy: perCamera };
}
export interface CalibrationView {
  session: string; step: number; phase: "ready" | "capturing" | "searching" | "complete" | "applied";
  fen: string; title?: string; instruction: string; message: string; samples: number; results: CalibrationResult[]; validation: CalibrationResult | null; lastCapture?: CalibrationResult | null;
}
