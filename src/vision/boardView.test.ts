import { describe, expect, it } from "vitest";
import { VirtualTable } from "../sim/virtualTable";
import { RIGS, rigCorners } from "../sim/rigs";
import { shoot } from "../test/helpers";
import { extractView, VIEW_SIDE } from "./boardView";

describe("extractView", () => {
  const table = new VirtualTable(), frame = shoot(table, "A"), corners = rigCorners(RIGS.A);
  it("keeps the board and blacks out the rest of the picture", () => {
    const v = extractView(frame, corners);
    expect(v.length).toBe(VIEW_SIDE * VIEW_SIDE);
    const lit = v.reduce((n, x) => n + (x > 0 ? 1 : 0), 0);
    expect(lit).toBeGreaterThan(VIEW_SIDE * VIEW_SIDE * 0.35); expect(lit).toBeLessThan(VIEW_SIDE * VIEW_SIDE * 0.95);
    expect(v[0]).toBe(0); expect(v[VIEW_SIDE * VIEW_SIDE - 1]).toBe(0); // corners of the crop lie outside the board outline
    expect(v[(VIEW_SIDE / 2) * VIEW_SIDE + VIEW_SIDE / 2]).toBeGreaterThan(0); // the middle is board
  });
  it("gives the same layout when the picture is turned half way round, because a8 -> h8 is made to run left to right", () => {
    const W = frame.width, H = frame.height, turned = { ...frame, data: new Uint8ClampedArray(frame.data.length) };
    for (let i = 0; i < frame.data.length; i++) turned.data[frame.data.length - 1 - i] = frame.data[i];
    const c2 = corners.map((p) => ({ x: W - 1 - p.x, y: H - 1 - p.y }));
    const a = extractView(frame, corners), b = extractView(turned, c2);
    let diff = 0, n = 0; for (let i = 0; i < a.length; i++) if (a[i] > 0 || b[i] > 0) { diff += Math.abs(a[i] - b[i]); n++; }
    expect(diff / n).toBeLessThan(0.08);
  });
});
