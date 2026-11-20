import { describe, expect, it } from "vitest";
import { botKnightSvg } from "./botIcon";

describe("the bot's knight", () => {
  it("is the logo's knight with a calm eye and flowers on its ear", () => {
    const svg = botKnightSvg(true);
    expect(svg).toContain("viewBox=\"0 0 64 64\""); expect(svg).toContain("#fff2d4"); // the logo's cream knight
    expect((svg.match(/#ffd34d/g) ?? []).length).toBeGreaterThanOrEqual(4); // a flower centre each
    expect(svg).toContain("--signal"); // on the themed tile, like the logo
  });
  it("has a clear-background version for canvas drawing that needs no CSS variables", () => {
    const svg = botKnightSvg(false, 128);
    expect(svg).not.toContain("var(--signal)"); expect(svg).toContain('width="128"'); expect(svg).toContain("xmlns=");
    expect(svg).not.toContain("<rect");
  });
});
