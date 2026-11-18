import { describe, expect, it } from "vitest";
import { signature, wireClass } from "./editor";

describe("wire look", () => {
  it("is solid once constant, otherwise follows certainty", () => {
    expect(wireClass(5000, 0.2)).toBe("constant");
    expect(wireClass(0, 0.95)).toBe("sure"); expect(wireClass(0, 0.6)).toBe("part"); expect(wireClass(0, 0.1)).toBe("weak"); expect(wireClass(100, null)).toBe("live");
  });
  it("fingerprints values structurally, sampling typed arrays", () => {
    expect(signature({ a: [1, 2] })).toBe(signature({ a: [1, 2] })); expect(signature({ a: [1, 2] })).not.toBe(signature({ a: [1, 3] }));
    const big = new Uint8Array(172800); const s1 = signature({ d: big }); big[0] = 9; expect(signature({ d: big })).not.toBe(s1);
    expect(signature(1)).toBe("1");
  });
});
