import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { Chess } from "chess.js";
import { VirtualTable } from "../sim/virtualTable";
import { applySensor, renderLuminance } from "../sim/render3d";
import { FRAME_H, FRAME_W, rigCorners, type CameraRig } from "../sim/rigs";
import { TABLE_Y } from "../world/coords";
import { parseCorners } from "../plugins/shared";
import { CROP, extractCrops } from "./squareCrops";
import { rng } from "./synthetic";
import type { GrayFrame } from "./types";

/**
 * Training data for the square CNN (see ml/README.md):
 *   CNN_GEN=1 CNN_N=2400 CNN_SEED=1 CNN_OUT=ml/data/train npx vitest run src/vision/cnnData.gen.test.ts
 * Writes <out>.x (uint8 crops, value * 127.5) and <out>.y (0 empty, 1 white, 2 black). Skipped in the normal run.
 */
const label = (g: Chess) => g.board().flat().map((p) => (!p ? 0 : p.color === "w" ? 1 : 2));

function randomGame(rand: () => number): Chess {
  const g = new Chess();
  const plies = Math.floor(rand() ** 1.3 * 130);
  for (let i = 0; i < plies && !g.isGameOver(); i++) { const m = g.moves(); g.move(m[Math.floor(rand() * m.length)]); }
  // sometimes thin the board further, so lone pieces and odd layouts are seen too
  if (rand() < 0.25) for (const row of g.board()) for (const p of row) if (p && p.type !== "k" && rand() < 0.3) g.remove(p.square);
  return g;
}

function randomRig(rand: () => number, i: number): CameraRig {
  const az = rand() * Math.PI * 2, rad = 0.45 + rand() * 0.55, h = 1.25 + rand() * 0.6;
  return { id: `r${i}`, pos: [Math.sin(az) * rad, h, Math.cos(az) * rad], target: [(rand() - 0.5) * 0.05, TABLE_Y, (rand() - 0.5) * 0.05], fovY: 40 + rand() * 8 };
}

describe.skipIf(!process.env.CNN_GEN)("square CNN training data", () => {
  it("renders positions and cuts them into square crops", () => {
    const N = Number(process.env.CNN_N ?? 600), rand = rng(Number(process.env.CNN_SEED ?? 1) * 7919 + 13), out = process.env.CNN_OUT ?? "ml/data/train";
    const xs = new Uint8Array(N * 2 * 64 * CROP * CROP), ys = new Uint8Array(N * 2 * 64);
    const table = new VirtualTable();
    const gauss = () => (rand() + rand() + rand() - 1.5) * 2;
    for (let n = 0; n < N; n++) {
      const g = randomGame(rand);
      table.game = g;
      // board and piece tones vary a lot between real sets: pale "white" pieces can be barely brighter than a light square
      const light = 100 + rand() * 80, dark = Math.max(35, light - 15 - rand() * 70), w = rand() < 0.5 ? 130 + rand() * 115 : light + 5 + rand() * 60, b = 10 + rand() * 90;
      const rig = randomRig(rand, n), o = { width: FRAME_W, height: FRAME_H, rig, shadows: rand() < 0.7, tones: { light, dark, w, b } };
      const lum = renderLuminance(table.scene3d(), o);
      const truth = label(g);
      for (let k = 0; k < 2; k++) {
        const frame: GrayFrame = applySensor(lum, { ...o, noise: 3 + rand() * 24, gain: 0.5 + rand() * 0.9, gradient: rand() * 0.4, seed: n * 3 + k + 1 });
        // the user drags the corners by hand, so they are never exact
        const corners = rigCorners(rig).map((p) => ({ x: p.x + gauss() * 1.4, y: p.y + gauss() * 1.4 }));
        const crops = extractCrops(frame, corners), at = (n * 2 + k) * 64;
        for (let i = 0; i < crops.length; i++) xs[at * CROP * CROP + i] = Math.min(255, Math.round(crops[i] * 127.5));
        ys.set(truth, at);
      }
    }
    mkdirSync("ml/data", { recursive: true });
    writeFileSync(`${out}.x`, xs);
    writeFileSync(`${out}.y`, ys);
  }, 3_600_000);

  it("augments the real camera frame into extra training crops", () => {
    const M = Number(process.env.CNN_REAL ?? 300), rand = rng(99), gauss = () => (rand() + rand() + rand() - 1.5) * 2;
    const real = readFileSync("src/vision/fixtures/real-start-B.gray"), base = parseCorners("304,55;397,216;147,292;112,93")!;
    const xs = new Uint8Array(M * 64 * CROP * CROP), ys = new Uint8Array(M * 64), truth = label(new Chess());
    for (let m = 0; m < M; m++) {
      const noise = rand() * 18, gain = 0.6 + rand() * 0.8, grad = rand() * 0.3, d = new Uint8ClampedArray(real.length), draw = rng(m + 5);
      for (let i = 0; i < d.length; i++) d[i] = real[i] * gain * (1 - grad * ((i % 480) / 480)) + (draw() + draw() + draw() - 1.5) * 2 * noise;
      const crops = extractCrops({ width: 480, height: 360, data: d, t: 0 }, base.map((p) => ({ x: p.x + gauss() * 1.6, y: p.y + gauss() * 1.6 })));
      for (let i = 0; i < crops.length; i++) xs[m * 64 * CROP * CROP + i] = Math.min(255, Math.round(crops[i] * 127.5));
      ys.set(truth, m * 64);
    }
    writeFileSync("ml/data/realaug.x", xs);
    writeFileSync("ml/data/realaug.y", ys);
  });

  it("cuts the real camera frame of the start position into crops", () => {
    const frame: GrayFrame = { width: 480, height: 360, data: new Uint8ClampedArray(readFileSync("src/vision/fixtures/real-start-B.gray")), t: 0 };
    const crops = extractCrops(frame, parseCorners("304,55;397,216;147,292;112,93")!);
    const xs = new Uint8Array(crops.length);
    for (let i = 0; i < crops.length; i++) xs[i] = Math.min(255, Math.round(crops[i] * 127.5));
    mkdirSync("ml/data", { recursive: true });
    writeFileSync("ml/data/real.x", xs);
    writeFileSync("ml/data/real.y", Uint8Array.from(label(new Chess())));
  });
});
