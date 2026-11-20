import { describe, expect, it } from "vitest";
import { alignPrefs, setAlignPref } from "./alignPrefs";

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };

describe("align preferences", () => {
  it("start off, remember each switch on its own, and survive bad storage", () => {
    const s = memory();
    expect(alignPrefs(s)).toEqual({ centre: false, ocr: false });
    setAlignPref("ocr", true, s); expect(alignPrefs(s)).toEqual({ centre: false, ocr: true });
    setAlignPref("centre", true, s); expect(alignPrefs(s)).toEqual({ centre: true, ocr: true });
    setAlignPref("ocr", false, s); expect(alignPrefs(s)).toEqual({ centre: true, ocr: false });
    s.setItem("cx.align.opts", "{not json"); expect(alignPrefs(s)).toEqual({ centre: false, ocr: false });
    expect(alignPrefs(null)).toEqual({ centre: false, ocr: false });
    expect(() => setAlignPref("ocr", true, { getItem: () => null, setItem: () => { throw new Error("full"); } })).not.toThrow();
  });
});
