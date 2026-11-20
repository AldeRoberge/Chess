import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { VirtualTable } from "../sim/virtualTable";
import { applySensor, renderLuminance } from "../sim/render3d";
import { RIGS, rigCorners } from "../sim/rigs";
import { parseCorners } from "../plugins/shared";
import { BoardCache } from "./boardCnn";
import { BOARD_SIDE, extractBoard } from "./boardImage";
import { loadBoardCnn } from "./boardModel";
import { BoardSampler, defaultSamplerConfig } from "./sampler";
import { loadSquareCnn } from "./squareModel";
import check from "./boardCnn.check.json";
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

describe("whole-board CNN", () => {
  beforeAll(async () => { await loadBoardCnn(); await loadSquareCnn(); });

  it("reproduces the logits PyTorch gave for the same board images", () => {
    const net = BoardSampler.boardNet!, x = Float32Array.from(check.x), n = BOARD_SIDE * BOARD_SIDE;
    for (let k = 0; k < check.logits.length / 192; k++) {
      const out = net.logits(x.subarray(k * n, (k + 1) * n));
      for (let i = 0; i < 192; i++) expect(out[i]).toBeCloseTo(check.logits[k * 192 + i], 2);
    }
  });

  it("only reruns the network when the picture changed", () => {
    const cache = new BoardCache(BoardSampler.boardNet!), img = new Float32Array(BOARD_SIDE * BOARD_SIDE).fill(0.5);
    cache.classify(img);
    expect(cache.ran).toBe(true);
    cache.classify(img.map((v) => v + 0.01)); // sensor noise
    expect(cache.ran).toBe(false);
    const moved = img.slice();
    for (let y = 40; y < 56; y++) for (let x = 40; x < 56; x++) moved[y * BOARD_SIDE + x] = 0.1; // a dark blob on one square
    cache.classify(moved);
    expect(cache.ran).toBe(true);
  });

  it("reads the real camera frame of the starting position", () => {
    const frame: GrayFrame = { width: 480, height: 360, data: new Uint8ClampedArray(readFileSync("src/vision/fixtures/real-start-B.gray")), t: 0 };
    const s = new BoardSampler("B", { ...defaultSamplerConfig(), corners: parseCorners("304,55;397,216;147,292;112,93")!, engine: "board" });
    s.calibrateFromStart(frame);
    // The shipped model is fine-tuned on this very frame, so this guards against a broken export, not generalisation.
    expect(errors(s, frame, truthOf(new Chess()))).toBeLessThanOrEqual(3);
  });

  it("reads simulated middlegames from every rig under noise as well as the brightness reader and the square reader", () => {
    const t = new VirtualTable(), startScene = new VirtualTable().scene3d();
    for (const m of ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Bxc6", "dxc6"]) t.game.move(m);
    const truth = truthOf(t.game), midScene = t.scene3d();
    const total = { rules: 0, cnn: 0, board: 0 }, ms = { cnn: 0, board: 0 };
    for (const rig of ["A", "B", "C"]) {
      const o = { width: 480, height: 360, rig: RIGS[rig], shadows: true };
      const start = renderLuminance(startScene, o), mid = renderLuminance(midScene, o), corners = rigCorners(RIGS[rig]);
      for (const noise of [8, 16, 24]) {
        const f0 = applySensor(start, { ...o, noise, gradient: 0.15, seed: 1 }), f1 = applySensor(mid, { ...o, noise, gradient: 0.15, seed: 2 });
        for (const engine of ["rules", "cnn", "board"] as const) {
          const s = new BoardSampler(rig, { ...defaultSamplerConfig(), corners, engine });
          s.calibrateFromStart(f0);
          const t0 = performance.now(), e = errors(s, f1, truth);
          if (engine !== "rules") ms[engine] += performance.now() - t0;
          total[engine] += e;
        }
      }
    }
    console.info(`square errors over 9 boards: rules ${total.rules}, square cnn ${total.cnn}, board cnn ${total.board}; uncached read ms per board: square ${(ms.cnn / 9).toFixed(1)}, board ${(ms.board / 9).toFixed(1)}`);
    expect(total.board).toBeLessThanOrEqual(Math.max(total.rules, 9));
  });
});
