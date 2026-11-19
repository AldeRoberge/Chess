import { readFileSync } from "node:fs";
import { it } from "vitest";
import { BoardSampler, defaultSamplerConfig } from "./sampler";
import { enhance, noEnhance } from "./enhance";
import { rng } from "./synthetic";
import { parseCorners } from "../plugins/shared";
it.skipIf(!process.env.DBG)("dbg", () => {
  const raw = new Uint8ClampedArray(readFileSync("src/vision/fixtures/real-start-B.gray"));
  const mk = (seed: number, noise: number) => { const r = rng(seed), d = new Uint8ClampedArray(raw.length); for (let i = 0; i < d.length; i++) d[i] = raw[i] + (r() + r() + r() - 1.5) * 2 * noise; return enhance({ width: 480, height: 360, data: d, t: 0 }, { ...noEnhance(), denoise: "median" }); };
  const s = new BoardSampler("B", { ...defaultSamplerConfig(), corners: parseCorners("304,55;397,216;147,292;112,93")! });
  s.calibrateFromStart(mk(5, 14)); console.log("tone", JSON.stringify((s as any).tone), "gate", s.spreadGate);
  const f = mk(6, 14), o = s.read(f);
  for (let i = 0; i < 64; i++) { const t = i < 16 ? "b" : i >= 48 ? "w" : "."; const seen = o.occ[i] > 0.5 ? (o.white[i] > 0.5 ? "w" : "b") : "."; if (t !== seen) { const d = s.diagnose(f, i); console.log(i, t, seen, JSON.stringify(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, Math.round(v as number)]))), "occ", o.occ[i].toFixed(2), "wh", o.white[i].toFixed(2)); } }
});
