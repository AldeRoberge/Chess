import { readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { Chess } from "chess.js";
import { VirtualTable } from "../sim/virtualTable";
import { applySensor, renderLuminance } from "../sim/render3d";
import { RIGS, rigCorners } from "../sim/rigs";
import { averageFrames, downscale, enhance, noEnhance, type EnhanceConfig } from "./enhance";
import { BoardSampler, defaultSamplerConfig } from "./sampler";
import { parseCorners } from "../plugins/shared";
import { rng } from "./synthetic";
import type { GrayFrame, Pt } from "./types";

/**
 * Accuracy benchmark for the board reader: `BENCH=1 npx vitest run src/vision/bench.test.ts`.
 * Not part of the normal run. Writes the ranked table to BENCH_OUT (default bench-results.json).
 * - "real": a true camera frame of the starting position (src/vision/fixtures/real-start-B.gray, 480x360).
 * - "synth": three virtual cameras, start position learned, then an 8-ply middlegame read; sensor noise,
 *   light falloff and shadows on; some configs capture at 2x resolution and a few frames per read.
 */
interface Case { name: string; enh: Partial<EnhanceConfig>; thr?: number; grid?: number; patch?: number; res?: 1 | 2; down?: boolean }

const CASES: Case[] = [
  { name: "baseline", enh: {} },
  { name: "box3", enh: { denoise: "box" } },
  { name: "median3", enh: { denoise: "median" } },
  { name: "gauss", enh: { denoise: "gauss" } },
  { name: "sharpen0.7 r2", enh: { sharpen: 0.7 } },
  { name: "sharpen1.5 r2", enh: { sharpen: 1.5 } },
  { name: "sharpen1.0 r4", enh: { sharpen: 1, sharpenRadius: 4 } },
  { name: "median+sharpen1", enh: { denoise: "median", sharpen: 1 } },
  { name: "gauss+sharpen1.5 r3", enh: { denoise: "gauss", sharpen: 1.5, sharpenRadius: 3 } },
  { name: "flat 25", enh: { flat: 25 } },
  { name: "flat 40", enh: { flat: 40 } },
  { name: "median+flat40", enh: { denoise: "median", flat: 40 } },
  { name: "median+sharpen+flat40", enh: { denoise: "median", sharpen: 1, flat: 40 } },
  { name: "avg4", enh: { average: 4 } },
  { name: "avg4+median", enh: { average: 4, denoise: "median" } },
  { name: "2x down", enh: {}, res: 2, down: true },
  { name: "2x down+sharpen1", enh: { sharpen: 1 }, res: 2, down: true },
  { name: "2x native", enh: {}, res: 2 },
  { name: "2x native+median", enh: { denoise: "median" }, res: 2 },
  { name: "2x native+gauss+sharpen", enh: { denoise: "gauss", sharpen: 1.2, sharpenRadius: 3 }, res: 2 },
  { name: "2x down+avg3+sharpen", enh: { average: 3, sharpen: 1 }, res: 2, down: true },
  { name: "thr0.15", enh: {}, thr: 0.15 },
  { name: "thr0.30", enh: {}, thr: 0.3 },
  { name: "median thr0.15", enh: { denoise: "median" }, thr: 0.15 },
  { name: "median grid6 patch0.6", enh: { denoise: "median" }, grid: 6, patch: 0.6 },
  { name: "median grid5 patch0.4", enh: { denoise: "median" }, grid: 5, patch: 0.4 },
  { name: "median+sharpen grid6 patch0.6", enh: { denoise: "median", sharpen: 1 }, grid: 6, patch: 0.6 },
  { name: "median+flat40 thr0.15", enh: { denoise: "median", flat: 40 }, thr: 0.15 },
  { name: "median+sharpen+flat40 thr0.15 g6", enh: { denoise: "median", sharpen: 1, flat: 40 }, thr: 0.15, grid: 6, patch: 0.6 },
  { name: "2x down+avg3+median+sharpen thr0.15", enh: { average: 3, denoise: "median", sharpen: 1 }, res: 2, down: true, thr: 0.15 },
];

const REAL_CORNERS = parseCorners("304,55;397,216;147,292;112,93")!;

function truthFromGame(g: Chess) {
  const occ: boolean[] = [], white: boolean[] = [];
  for (const row of g.board()) for (const p of row) { occ.push(!!p); white.push(p?.color === "w"); }
  return { occ, white };
}
function score(s: BoardSampler, frame: GrayFrame, truth: { occ: boolean[]; white: boolean[] }) {
  const o = s.read(frame);
  let miss = 0, fp = 0, colour = 0, pieces = 0;
  for (let i = 0; i < 64; i++) {
    const seen = o.occ[i] > 0.5;
    if (truth.occ[i]) { pieces++; if (!seen) miss++; else if ((o.white[i] > 0.5) !== truth.white[i]) colour++; }
    else if (seen) fp++;
  }
  return { miss, fp, colour, pieces, err: miss + fp + colour };
}

interface Synth { rig: string; res: 1 | 2; startLum: Float32Array; midLum: Float32Array; truth: ReturnType<typeof truthFromGame>; corners: Pt[] }

describe.skipIf(!process.env.BENCH)("board reader benchmark", () => {
  it("ranks 30 preprocessing / sampler settings", () => {
    const real: GrayFrame = { width: 480, height: 360, data: new Uint8ClampedArray(readFileSync("src/vision/fixtures/real-start-B.gray")), t: 0 };
    const realTruth = truthFromGame(new Chess());

    const t = new VirtualTable();
    const start = truthFromGame(t.game);
    for (const m of ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Bxc6", "dxc6"]) t.game.move(m);
    const mid = truthFromGame(t.game);
    const startScene = new VirtualTable().scene3d(), midScene = t.scene3d();
    void start;
    const synth: Synth[] = [];
    for (const res of [1, 2] as const)
      for (const rig of ["A", "B", "C"]) {
        const o = { width: 480 * res, height: 360 * res, rig: RIGS[rig], shadows: true };
        synth.push({ rig, res, startLum: renderLuminance(startScene, o), midLum: renderLuminance(midScene, o), truth: mid, corners: rigCorners(RIGS[rig]).map((p) => ({ x: p.x * res, y: p.y * res })) });
      }

    const frames = (lum: Float32Array, sy: Synth, c: Case, seed: number, noise: number): GrayFrame => {
      const n = c.enh.average ?? 1, list: GrayFrame[] = [];
      for (let k = 0; k < n; k++) list.push(applySensor(lum, { width: 480 * sy.res, height: 360 * sy.res, rig: RIGS[sy.rig], noise, gain: 1, gradient: 0.15, seed: seed * 17 + k + 1 }));
      let f = n > 1 ? averageFrames(list) : list[0];
      if (c.down && sy.res > 1) f = downscale(f, sy.res);
      return enhance(f, { ...noEnhance(), ...c.enh });
    };

    const rows: any[] = [];
    for (const c of CASES) {
      const cfg = () => { const d = defaultSamplerConfig(); if (c.thr) d.threshold = c.thr; if (c.grid) d.grid = c.grid; if (c.patch) d.patch = c.patch; return d; };
      // real frame (one frame only: denoise/sharpen/flat apply; averaging and 2x are synthetic-only)
      // simulated webcam sensor noise is added to the real frame (a screenshot is cleaner than a live webcam); averaging uses independent noise copies
      const r = { err: 0, miss: 0, fp: 0, colour: 0 };
      for (const noise of [0, 8, 14])
        for (const seed of [1, 2]) {
          const noisy = (sd: number): GrayFrame => {
            const n = c.enh.average ?? 1, list: GrayFrame[] = [];
            for (let k = 0; k < n; k++) { const rand = rng(seed * 1009 + sd * 31 + k + 1), d = new Uint8ClampedArray(real.data.length); for (let i = 0; i < d.length; i++) d[i] = real.data[i] + (rand() + rand() + rand() - 1.5) * 2 * noise; list.push({ ...real, data: d }); }
            return enhance(n > 1 ? averageFrames(list) : list[0], { ...noEnhance(), ...c.enh });
          };
          const rs = new BoardSampler("B", { ...cfg(), corners: REAL_CORNERS });
          rs.calibrateFromStart(noisy(1));
          const q = score(rs, noisy(2), realTruth);
          r.err += q.err / 6; r.miss += q.miss / 6; r.fp += q.fp / 6; r.colour += q.colour / 6;
        }
      r.err = +r.err.toFixed(2); r.miss = +r.miss.toFixed(2); r.fp = +r.fp.toFixed(2); r.colour = +r.colour.toFixed(2);
      // synthetic: three rigs, two noise levels
      let se = 0, sm = 0, sf = 0, sc = 0, n = 0;
      for (const sy of synth) {
        const useRes = (c.res ?? 1) === sy.res;
        if (!useRes) continue;
        for (const noise of [8, 16]) {
          const down = c.down && sy.res > 1;
          const k = down ? sy.res : 1;
          const s = new BoardSampler(sy.rig, { ...cfg(), corners: sy.corners.map((p) => ({ x: p.x / k, y: p.y / k })) });
          s.calibrateFromStart(frames(sy.startLum, sy, c, 1, noise));
          const q = score(s, frames(sy.midLum, sy, c, 2, noise), sy.truth);
          se += q.err; sm += q.miss; sf += q.fp; sc += q.colour; n++;
        }
      }
      rows.push({ name: c.name, realErr: r.err, realMiss: r.miss, realFp: r.fp, realColour: r.colour, synthErr: +(se / n).toFixed(2), synthMiss: +(sm / n).toFixed(2), synthFp: +(sf / n).toFixed(2), synthColour: +(sc / n).toFixed(2) });
    }
    for (const r of rows) r.score = +(r.realErr * 2 + r.synthErr).toFixed(2);
    rows.sort((a, b) => a.score - b.score);
    console.table(rows);
    writeFileSync(process.env.BENCH_OUT ?? "bench-results.json", JSON.stringify(rows, null, 2));
  });
});
