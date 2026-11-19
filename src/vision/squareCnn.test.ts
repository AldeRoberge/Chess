import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { VirtualTable } from "../sim/virtualTable";
import { applySensor, renderLuminance } from "../sim/render3d";
import { RIGS, rigCorners } from "../sim/rigs";
import { parseCorners } from "../plugins/shared";
import { BoardSampler, defaultSamplerConfig } from "./sampler";
import { SquareCache } from "./squareCnn";
import { loadSquareCnn } from "./squareModel";
import { CROP } from "./squareCrops";
import check from "./squareCnn.check.json";
import type { GrayFrame } from "./types";

const truthOf = (g: Chess) => g.board().flat().map((p) => (!p ? 0 : p.color === "w" ? 1 : 2));
const errors = (s: BoardSampler, frame: GrayFrame, truth: number[]) => {
  const o = s.read(frame);
  let err = 0;
  for (let i = 0; i < 64; i++) {
    const seen = o.occ[i] > 0.5, colour = o.white[i] > 0.5 ? 1 : 2;
    if (truth[i] === 0 ? seen : !seen || colour !== truth[i]) err++;
  }
  return err;
};

describe("square CNN", () => {
  beforeAll(async () => { await loadSquareCnn(); });

  it("reproduces the logits PyTorch gave for the same crops", () => {
    const net = BoardSampler.cnn!, x = Float32Array.from(check.x);
    for (let k = 0; k < check.logits.length / 3; k++) {
      const out = net.logits(x, k * CROP * CROP);
      for (let c = 0; c < 3; c++) expect(out[c]).toBeCloseTo(check.logits[k * 3 + c], 2);
    }
  });

  it("only reruns the network on squares that changed", () => {
    const cache = new SquareCache(BoardSampler.cnn!), crops = new Float32Array(64 * CROP * CROP).fill(0.5);
    cache.classify(crops);
    expect(cache.ran).toBe(64);
    cache.classify(crops.map((v) => v + 0.01)); // sensor noise
    expect(cache.ran).toBeLessThanOrEqual(5); // only the staggered refreshes
    const moved = crops.slice();
    for (let i = 0; i < 16 * CROP; i++) moved[3 * CROP * CROP + 8 * CROP + i] = 0.1; // a dark blob on one square
    cache.classify(moved);
    expect(cache.ran).toBeGreaterThanOrEqual(1);
  });

  it("reads the real camera frame of the starting position", () => {
    const frame: GrayFrame = { width: 480, height: 360, data: new Uint8ClampedArray(readFileSync("src/vision/fixtures/real-start-B.gray")), t: 0 };
    const s = new BoardSampler("B", { ...defaultSamplerConfig(), corners: parseCorners("304,55;397,216;147,292;112,93")!, engine: "cnn" });
    s.calibrateFromStart(frame);
    // The shipped model is fine-tuned on this very frame, so this guards against a broken export, not generalisation.
    expect(errors(s, frame, truthOf(new Chess()))).toBeLessThanOrEqual(3);
  });

  it("reads simulated middlegames from every rig under noise at least as well as the brightness reader", () => {
    const t = new VirtualTable(), startScene = new VirtualTable().scene3d();
    for (const m of ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Bxc6", "dxc6"]) t.game.move(m);
    const truth = truthOf(t.game), midScene = t.scene3d();
    let rules = 0, cnn = 0;
    for (const rig of ["A", "B", "C"]) {
      const o = { width: 480, height: 360, rig: RIGS[rig], shadows: true };
      const start = renderLuminance(startScene, o), mid = renderLuminance(midScene, o), corners = rigCorners(RIGS[rig]);
      for (const noise of [8, 16, 24]) {
        const f0 = applySensor(start, { ...o, noise, gradient: 0.15, seed: 1 }), f1 = applySensor(mid, { ...o, noise, gradient: 0.15, seed: 2 });
        for (const engine of ["rules", "cnn"] as const) {
          const s = new BoardSampler(rig, { ...defaultSamplerConfig(), corners, engine });
          s.calibrateFromStart(f0);
          const e = errors(s, f1, truth);
          if (engine === "rules") rules += e; else cnn += e;
        }
      }
    }
    console.info(`square errors over 9 boards: rules ${rules}, cnn ${cnn}`);
    expect(cnn).toBeLessThanOrEqual(Math.max(rules, 9));
  });
});
