import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { VirtualTable } from "../sim/virtualTable";
import { applySensor, renderLuminance } from "../sim/render3d";
import { RIGS, rigCorners } from "../sim/rigs";
import { calibrationGames, calibrationPosition } from "./calibration";
import { BoardSampler, defaultSamplerConfig, type SamplerConfig } from "./sampler";
import type { GrayFrame } from "./types";

/**
 * Precision harness: the five calibration boards seen by three fake cameras (ray-cast, shadows, sensor noise) under
 * different exposures. The start position teaches the reader; the other four boards are read cold and scored per square.
 * `PRECISION=1 npx vitest run src/vision/precision.test.ts` prints the table.
 */
const W = 480, H = 360;
export interface Light { name: string; gain: number; gradient: number; noise: number }
export const LIGHTS: Light[] = [
  { name: "normal", gain: 1, gradient: 0.15, noise: 10 },
  { name: "bright", gain: 1.75, gradient: 0.15, noise: 10 },
  { name: "very bright", gain: 2.1, gradient: 0.1, noise: 8 },
  { name: "dim", gain: 0.45, gradient: 0.15, noise: 8 },
  { name: "uneven", gain: 1.3, gradient: 0.5, noise: 12 },
  { name: "noisy", gain: 1, gradient: 0.15, noise: 26 },
];

const luminance = new Map<string, Float32Array>();
function lum(step: number, rig: string) {
  const key = `${step}${rig}`;
  if (!luminance.has(key)) {
    const t = new VirtualTable(); t.game = new Chess(calibrationPosition(step).fen);
    luminance.set(key, renderLuminance(t.scene3d(), { width: W, height: H, rig: RIGS[rig], shadows: true }));
  }
  return luminance.get(key)!;
}
const shot = (step: number, rig: string, l: Light, seed: number): GrayFrame => applySensor(lum(step, rig), { width: W, height: H, rig: RIGS[rig], noise: l.noise, gain: l.gain, gradient: l.gradient, seed });

export interface Score { errors: number; miss: number; fp: number; colour: number; undecided: number; squares: number; boards: number; exact: number }
export function runPrecision(light: Light, tweak: Partial<SamplerConfig> = {}): Score {
  const s: Score = { errors: 0, miss: 0, fp: 0, colour: 0, undecided: 0, squares: 0, boards: 0, exact: 0 };
  for (const rig of Object.keys(RIGS)) {
    const sampler = new BoardSampler(rig, { ...defaultSamplerConfig(), ...tweak, corners: rigCorners(RIGS[rig]) });
    sampler.calibrateFromStart(shot(0, rig, light, 1));
    for (let step = 1; step < calibrationGames.length; step++) {
      const truth = new Chess(calibrationPosition(step).fen).board().flat(), o = sampler.read(shot(step, rig, light, 10 + step));
      let wrong = 0;
      for (let sq = 0; sq < 64; sq++) {
        const p = truth[sq], seen = o.occ[sq] > 0.5;
        if (Math.abs(o.occ[sq] - 0.5) < 0.1) s.undecided++;
        if (p) { if (!seen) { s.miss++; wrong++; } else if ((o.white[sq] > 0.5) !== (p.color === "w")) { s.colour++; wrong++; } }
        else if (seen) { s.fp++; wrong++; }
        s.squares++;
      }
      s.errors += wrong; s.boards++; if (!wrong) s.exact++;
    }
  }
  return s;
}

describe.skipIf(!process.env.PRECISION)("precision report", () => {
  it("prints per-light accuracy", () => {
    const rows = LIGHTS.map((l) => ({ light: l.name, ...runPrecision(l) }));
    writeFileSync(process.env.PRECISION_OUT ?? "precision-results.json", JSON.stringify(rows));
    console.table(rows);
  }, 600000);
});

describe("board reader precision on fake cameras", () => {
  // Budget per light: wrong squares out of 768 (3 cameras x 4 unseen boards x 64). A regression in the reader shows up here first.
  const budget: Record<string, number> = { normal: 12, bright: 10, dim: 14, uneven: 12, noisy: 16 };
  for (const l of LIGHTS.filter((x) => x.name in budget))
    it(`stays within ${budget[l.name]} wrong squares under ${l.name} light`, () => {
      const s = runPrecision(l);
      expect(s.colour).toBe(0);
      expect(s.errors).toBeLessThanOrEqual(budget[l.name]);
      expect(s.undecided / s.squares).toBeLessThan(0.03);
    }, 120000);
});
