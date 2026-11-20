import { describe, expect, it } from "vitest";
import { MAX_TILT, boardTilt, dragCorner, quadUpright, quadValid, turnWithin } from "./quadRules";
import { turnQuad } from "./quadTurn";

const sq = [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 300 }, { x: 100, y: 300 }]; // a8 h8 h1 a1, clockwise on screen
const len = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe("quadValid", () => {
  it("accepts a box and a tilted one, rejects a criss-cross, a mirror image and a sliver", () => {
    expect(quadValid(sq)).toBe(true);
    expect(quadValid(turnQuad(sq, { x: 200, y: 200 }, 0.4))).toBe(true);
    expect(quadValid([sq[0], sq[2], sq[1], sq[3]])).toBe(false); // bow-tie
    expect(quadValid([sq[1], sq[0], sq[3], sq[2]])).toBe(false); // mirrored: goes round the other way
    expect(quadValid([sq[0], sq[1], { x: 300, y: 101 }, { x: 100, y: 100 }])).toBe(false); // collapsed
    expect(quadValid([sq[0], sq[1], sq[2], { x: 350, y: 120 }])).toBe(false); // a reflex corner
  });
});

describe("tilt and upright", () => {
  it("reads the top edge's direction, and calls a board turned past the limit upside down", () => {
    expect(boardTilt(sq)).toBeCloseTo(0, 6);
    expect(boardTilt(turnQuad(sq, { x: 200, y: 200 }, Math.PI / 2))).toBeCloseTo(90, 4);
    expect(quadUpright(turnQuad(sq, { x: 200, y: 200 }, (100 * Math.PI) / 180), true)).toBe(true);
    expect(quadUpright(turnQuad(sq, { x: 200, y: 200 }, (130 * Math.PI) / 180), true)).toBe(false);
    expect(quadUpright(turnQuad(sq, { x: 200, y: 200 }, Math.PI), true)).toBe(false);
    expect(quadUpright(turnQuad(sq, { x: 200, y: 200 }, Math.PI), false)).toBe(true); // a plain box has no up
  });
});

describe("dragCorner", () => {
  it("moves a corner normally", () => {
    const q = dragCorner(sq, 1, sq[1], { x: 320, y: 90 }, true);
    expect(q[1]).toEqual({ x: 320, y: 90 }); expect(q[0]).toEqual(sq[0]);
  });
  it("turns the whole box instead of criss-crossing it when a corner is dragged past its neighbour", () => {
    // drag h8 (top right) across the box to the bottom left, which would cross the box
    const q = dragCorner(sq, 1, sq[1], { x: 110, y: 290 }, true);
    expect(quadValid(q)).toBe(true); expect(quadUpright(q, true)).toBe(true);
    expect(q[1]).not.toEqual({ x: 110, y: 290 });
    expect(len(q[0], q[1])).toBeCloseTo(200, 3); // turned, not squashed: the sides keep their length
    expect(boardTilt(q)).not.toBeCloseTo(0, 1);
  });
  it("never turns the box upside down, however far the pointer sweeps", () => {
    let q = sq, last = sq[1];
    for (let a = 0; a <= 360; a += 6) { const to = { x: 200 + 140 * Math.cos((a - 45) * Math.PI / 180), y: 200 + 140 * Math.sin((a - 45) * Math.PI / 180) }; q = dragCorner(q, 1, last, to, true); last = to; expect(quadUpright(q, true)).toBe(true); expect(Math.abs(boardTilt(q))).toBeLessThanOrEqual(MAX_TILT + 1e-6); }
  });
  it("lets a box that is already broken be mended by hand", () => {
    const bow = [sq[0], sq[2], sq[1], sq[3]], q = dragCorner(bow, 1, bow[1], { x: 300, y: 100 }, true);
    expect(q[1]).toEqual({ x: 300, y: 100 });
  });
});

describe("turnWithin", () => {
  it("backs off to the limit instead of refusing", () => {
    const c = { x: 200, y: 200 }, q = turnWithin(sq, c, Math.PI, true)!;
    expect(Math.abs(boardTilt(q))).toBeLessThanOrEqual(MAX_TILT + 1e-6); expect(Math.abs(boardTilt(q))).toBeGreaterThan(MAX_TILT - 1);
    expect(turnWithin(sq, c, 0.3, true)).toEqual(turnQuad(sq, c, 0.3));
  });
});
