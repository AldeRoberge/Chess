import { describe, expect, it } from "vitest";
import { drawChevrons } from "./chevrons";

const ctx = () => document.createElement("canvas").getContext("2d")!;

describe("chevrons", () => {
  it("draws along a path without throwing, at any animation phase", () => {
    const c = ctx();
    for (const t of [0, 0.37, 5.9]) expect(() => drawChevrons(c, { x: 20, y: 20 }, { x: 300, y: 140 }, 44, t)).not.toThrow();
  });
  it("ignores a zero-length move and handles squares that touch", () => {
    const c = ctx();
    expect(() => drawChevrons(c, { x: 5, y: 5 }, { x: 5, y: 5 }, 44, 1)).not.toThrow();
    expect(() => drawChevrons(c, { x: 22, y: 22 }, { x: 66, y: 22 }, 44, 1)).not.toThrow();
  });
  it("marches: the chevrons are drawn at different spots as time passes", () => {
    const c = ctx(), seen: string[] = [];
    const orig = c.translate.bind(c); c.translate = ((x: number, y: number) => { seen.push(`${Math.round(x)},${Math.round(y)}`); return orig(x, y); }) as any;
    drawChevrons(c, { x: 0, y: 0 }, { x: 400, y: 0 }, 44, 0); const a = seen.splice(0).join("|");
    drawChevrons(c, { x: 0, y: 0 }, { x: 400, y: 0 }, 44, 0.3); const b = seen.join("|");
    expect(a).not.toBe(b);
  });
});
