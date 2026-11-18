import { describe, expect, it } from "vitest";
import { describeError } from "./nodeError";

describe("describeError", () => {
  it("explains camera permission failures in plain words", () => {
    const e = new Error("Permission denied"); e.name = "NotAllowedError";
    const d = describeError(e);
    expect(d.message).toMatch(/blocked access to a camera/);
    expect(d.hint).toMatch(/address bar/);
    expect(d.detail).toContain("NotAllowedError");
  });
  it("explains missing inputs for null/undefined access", () => {
    expect(describeError(new TypeError("Cannot read properties of undefined (reading 'x')")).message).toMatch(/didn't expect/);
  });
  it("falls back to a readable sentence that keeps the original text", () => {
    const d = describeError(new Error("kaput"));
    expect(d.message).toBe("This node stopped with an error: kaput");
    expect(d.hint).not.toBe("");
  });
  it("handles non-Error throws", () => { expect(describeError("boom").detail).toBe("boom"); });
});
