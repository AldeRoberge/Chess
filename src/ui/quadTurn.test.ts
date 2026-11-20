import { describe, expect, it } from "vitest";
import { RIGS, rigCorners } from "../sim/rigs";
import { VirtualTable } from "../sim/virtualTable";
import { shoot } from "../test/helpers";
import { quadToSquare, squareToQuad } from "./quadMap";
import { planeTurnable, pickTurnBase, turnQuadPlane } from "./quadTurn";

// a board seen at a tilt: the far (top) edge is shorter than the near one
const tilted = [{ x: 120, y: 60 }, { x: 280, y: 60 }, { x: 360, y: 220 }, { x: 40, y: 220 }];
const len = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe("quadToSquare", () => {
  it("is the inverse of squareToQuad, including in perspective", () => {
    const m = squareToQuad(tilted), inv = quadToSquare(tilted);
    for (const [u, v] of [[0, 0], [1, 0], [0.3, 0.8], [1, 1], [0.5, 0.5], [-0.2, 1.1]]) { const p = inv(m(u, v).x, m(u, v).y)!; expect(p.u).toBeCloseTo(u, 6); expect(p.v).toBeCloseTo(v, 6); }
  });
});

describe("turning the board in 3D", () => {
  it("is the identity at 0 and 360 degrees, and turns the corners round in order", () => {
    const a = turnQuadPlane(tilted, 0)!, b = turnQuadPlane(tilted, Math.PI * 2)!;
    a.forEach((p, i) => { expect(p.x).toBeCloseTo(tilted[i].x, 6); expect(p.y).toBeCloseTo(tilted[i].y, 6); expect(b[i].x).toBeCloseTo(tilted[i].x, 6); });
    const q = turnQuadPlane(tilted, Math.PI / 2)!; // a quarter turn clockwise: a8 goes where h8 was in the board's own plane
    const m = squareToQuad(tilted), h8 = m(1, 0);
    expect(q[0].x).toBeCloseTo(h8.x, 6); expect(q[0].y).toBeCloseTo(h8.y, 6);
  });
  it("foreshortens like a real turn: the far edge stays shorter, the shape is not a rigid turn of the picture", () => {
    const q = turnQuadPlane(tilted, Math.PI / 6)!, sq = squareToQuad(q);
    // the square is still a projective square: its mid-lines meet in the middle of the picture quad
    expect(len(q[0], q[1])).not.toBeCloseTo(len(tilted[0], tilted[1]), 1);
    const c = sq(0.5, 0.5), c0 = squareToQuad(tilted)(0.5, 0.5);
    expect(c.x).toBeCloseTo(c0.x, 3); expect(c.y).toBeCloseTo(c0.y, 3); // the board turns about its own middle
  });
  it("is just a flat turn when the view is square-on (no perspective)", () => {
    const flat = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], q = turnQuadPlane(flat, Math.PI / 2)!;
    expect(q[0].x).toBeCloseTo(100); expect(q[0].y).toBeCloseTo(0); expect(q[2].x).toBeCloseTo(0);
  });
  it("refuses a broken perspective: a corner at the horizon", () => {
    const wild = [{ x: 100, y: 100 }, { x: 110, y: 100 }, { x: 400, y: 300 }, { x: 0, y: 300 }];
    expect(planeTurnable(tilted)).toBe(true);
    expect(planeTurnable(wild)).toBe(false);
    expect(turnQuadPlane(wild, Math.PI)).toBeNull(); // turned half way, a corner would pass the horizon
  });
});

describe("what to turn", () => {
  it("turns in 3D when the grid sits on the picture's squares, flat with no picture or a picture with no squares in it", () => {
    const f = shoot(new VirtualTable(), "A"), c = rigCorners(RIGS.A);
    expect(pickTurnBase(null, c).mode).toBe("flat");
    expect(pickTurnBase(f, c).mode).toBe("3d");
    expect(pickTurnBase({ ...f, data: new Uint8ClampedArray(f.data.length).fill(128) }, c).mode).toBe("flat");
  });
});
