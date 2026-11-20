import { describe, expect, it } from "vitest";
import check from "./viewCnn.check.json";
import weights from "./viewCnn.weights.json";
import { ViewCnn, type ViewCnnJson } from "./viewCnn";

describe("ViewCnn", () => {
  it("reproduces the logits PyTorch gave for the same masked views", () => {
    const net = new ViewCnn(weights as unknown as ViewCnnJson), n = 160 * 160, ref = check.logits as number[];
    for (let k = 0; k < 2; k++) {
      const got = net.logits(Float32Array.from((check.x as number[]).slice(k * n, (k + 1) * n)));
      for (let i = 0; i < 192; i += 7) expect(got[i]).toBeCloseTo(ref[k * 192 + i], 2);
    }
  });
  it("gives probabilities that sum to one per square", () => {
    const net = new ViewCnn(weights as unknown as ViewCnnJson), p = net.classify(new Float32Array(160 * 160));
    for (let sq = 0; sq < 64; sq++) expect(p[sq * 3] + p[sq * 3 + 1] + p[sq * 3 + 2]).toBeCloseTo(1, 4);
  });
});
