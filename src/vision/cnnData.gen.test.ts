import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { Chess } from "chess.js";
import { VirtualTable } from "../sim/virtualTable";
import { applySensor, renderLuminance } from "../sim/render3d";
import { FRAME_H, FRAME_W, rigCorners, type CameraRig } from "../sim/rigs";
import { TABLE_Y } from "../world/coords";
import { parseCorners } from "../plugins/shared";
import { extractBoard, BOARD_SIDE } from "./boardImage";
import { CROP, extractCrops } from "./squareCrops";
import { rng } from "./synthetic";
import type { GrayFrame } from "./types";

/**
 * Training data for the square CNN (see ml/README.md):
 *   CNN_GEN=1 CNN_N=2400 CNN_SEED=1 CNN_OUT=ml/data/train npx vitest run src/vision/cnnData.gen.test.ts
 * Writes <out>.x (uint8 crops, value * 127.5) and <out>.y (0 empty, 1 white, 2 black). Skipped in the normal run.
 */
// CNN_BOARD=1 cuts the whole board into one flattened image per sample (boardImage.ts) instead of 64 square crops
const BOARD = !!process.env.CNN_BOARD, cut = BOARD ? extractBoard : extractCrops, UNIT = BOARD ? BOARD_SIDE * BOARD_SIDE : 64 * CROP * CROP, PRE = BOARD ? "ml/data/board-" : "ml/data/";
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
    const xs = new Uint8Array(N * 2 * UNIT), ys = new Uint8Array(N * 2 * 64);
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
        const crops = cut(frame, corners), at = n * 2 + k;
        for (let i = 0; i < crops.length; i++) xs[at * UNIT + i] = Math.min(255, Math.round(crops[i] * 127.5));
        ys.set(truth, at * 64);
      }
    }
    mkdirSync("ml/data", { recursive: true });
    writeFileSync(`${out}.x`, xs);
    writeFileSync(`${out}.y`, ys);
  }, 3_600_000);

  it("augments the real camera frames into extra training crops", () => {
    // Every labelled frame the running app saved to ml/real (see collect.ts) plus the committed fixture. CNN_HOLDOUT=1 keeps
    // every 5th saved frame out of training and writes it to real.x/.y, so the score the trainer prints is on pictures it never saw.
    const V = Number(process.env.CNN_REAL ?? 100), rand = rng(99), gauss = () => (rand() + rand() + rand() - 1.5) * 2;
    type Real = { data: Uint8Array; width: number; height: number; corners: { x: number; y: number }[]; truth: number[] };
    const frames: Real[] = [{ data: readFileSync("src/vision/fixtures/real-start-B.gray"), width: 480, height: 360, corners: parseCorners("304,55;397,216;147,292;112,93")!, truth: label(new Chess()) }];
    const saved: Real[] = [];
    if (existsSync("ml/real")) for (const f of readdirSync("ml/real").filter((n) => n.endsWith(".json")).sort()) {
      const m = JSON.parse(readFileSync(`ml/real/${f}`, "utf8")), g = new Chess();
      g.load(`${m.fen} w - - 0 1`, { skipValidation: true });
      saved.push({ data: readFileSync(`ml/real/${f.replace(".json", ".gray")}`), width: m.width, height: m.height, corners: m.corners, truth: label(g) });
    }
    const hold = process.env.CNN_HOLDOUT ? saved.filter((_, i) => i % 5 === 4) : [];
    frames.push(...saved.filter((r) => !hold.includes(r)));
    const per = Math.max(6, Math.round((V * 3) / Math.max(1, frames.length))); // the fixture and a few frames get many variants, a big collection fewer each
    const xs = new Uint8Array(frames.length * per * UNIT), ys = new Uint8Array(frames.length * per * 64);
    frames.forEach((r, fi) => {
      for (let m = 0; m < per; m++) {
        const noise = rand() * 18, gain = 0.6 + rand() * 0.8, grad = rand() * 0.3, d = new Uint8ClampedArray(r.data.length), draw = rng(fi * 1000 + m + 5);
        for (let i = 0; i < d.length; i++) d[i] = r.data[i] * gain * (1 - grad * ((i % r.width) / r.width)) + (draw() + draw() + draw() - 1.5) * 2 * noise;
        const crops = cut({ width: r.width, height: r.height, data: d, t: 0 }, r.corners.map((p) => ({ x: p.x + gauss() * 1.6, y: p.y + gauss() * 1.6 }))), at = fi * per + m;
        for (let i = 0; i < crops.length; i++) xs[at * UNIT + i] = Math.min(255, Math.round(crops[i] * 127.5));
        ys.set(r.truth, at * 64);
      }
    });
    mkdirSync("ml/data", { recursive: true });
    writeFileSync(`${PRE}realaug.x`, xs);
    writeFileSync(`${PRE}realaug.y`, ys);
    if (hold.length) {
      const hx = new Uint8Array(hold.length * UNIT), hy = new Uint8Array(hold.length * 64);
      hold.forEach((r, i) => {
        const c = cut({ width: r.width, height: r.height, data: new Uint8ClampedArray(r.data), t: 0 }, r.corners);
        for (let k = 0; k < c.length; k++) hx[i * UNIT + k] = Math.min(255, Math.round(c[k] * 127.5));
        hy.set(r.truth, i * 64);
      });
      writeFileSync(`${PRE}real.x`, hx);
      writeFileSync(`${PRE}real.y`, hy);
    }
    console.info(`real frames: ${frames.length} for training, ${hold.length} held out`);
  });

  it.skipIf(!!process.env.CNN_HOLDOUT)("cuts the real camera frame of the start position into crops", () => {
    const frame: GrayFrame = { width: 480, height: 360, data: new Uint8ClampedArray(readFileSync("src/vision/fixtures/real-start-B.gray")), t: 0 };
    const crops = cut(frame, parseCorners("304,55;397,216;147,292;112,93")!);
    const xs = new Uint8Array(crops.length);
    for (let i = 0; i < crops.length; i++) xs[i] = Math.min(255, Math.round(crops[i] * 127.5));
    mkdirSync("ml/data", { recursive: true });
    writeFileSync(`${PRE}real.x`, xs);
    writeFileSync(`${PRE}real.y`, Uint8Array.from(label(new Chess())));
  });
});
