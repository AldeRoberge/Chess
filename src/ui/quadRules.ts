import type { Pt } from "../vision/types";
import { turnQuad } from "./quadTurn";

const cross = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Shortest side a corner box may have, in picture pixels. */
export const MIN_SIDE = 6;
/** How far the top edge (a8 to h8) may point away from "to the right" before the board counts as upside down, in degrees. A board turned a quarter turn is fine; one turned past this is not. */
export const MAX_TILT = 110;

/**
 * A usable corner box: four corners that go round the same way (clockwise on screen, as a8 h8 h1 a1 do), each turn bending
 * the same direction (convex), no two sides crossing, and no side vanishingly short. A criss-crossed (bow-tie) or mirrored
 * box fails.
 */
export function quadValid(q: Pt[]): boolean {
  if (q.length !== 4 || q.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return false;
  for (let i = 0; i < 4; i++) {
    if (dist(q[i], q[(i + 1) % 4]) < MIN_SIDE) return false;
    if (!(cross(q[i], q[(i + 1) % 4], q[(i + 2) % 4]) > 1e-6)) return false; // positive for every corner: clockwise and convex
  }
  return true;
}

/** Direction of the board's top edge, in degrees from "to the right" (clockwise positive, -180..180): the mean of a8 to h8 and a1 to h1. */
export function boardTilt(q: Pt[]): number {
  const dx = q[1].x - q[0].x + (q[2].x - q[3].x), dy = q[1].y - q[0].y + (q[2].y - q[3].y);
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

/** The box is valid and the right way up: not turned past `MAX_TILT`, so a8 can never end up at the bottom. */
export function quadUpright(q: Pt[], board: boolean): boolean {
  return quadValid(q) && (!board || Math.abs(boardTilt(q)) <= MAX_TILT);
}

const centre = (q: Pt[]): Pt => ({ x: q.reduce((s, p) => s + p.x, 0) / 4, y: q.reduce((s, p) => s + p.y, 0) / 4 });

/**
 * Moves corner `i` of `q` to `to`. When that would criss-cross the box or turn it upside down, the corner is not moved:
 * the whole box turns about its centre instead, by the angle the pointer swept from `from` to `to` around that centre.
 * Returns the new corners (or `q` itself when neither is allowed).
 */
export function dragCorner(q: Pt[], i: number, from: Pt, to: Pt, board: boolean): Pt[] {
  const moved = q.map((p, k) => (k === i ? to : p));
  if (quadUpright(moved, board) || !quadUpright(q, board)) return moved; // a box that is already broken can be mended by hand
  const c = centre(q), d = Math.atan2(to.y - c.y, to.x - c.x) - Math.atan2(from.y - c.y, from.x - c.x);
  const turn = Math.atan2(Math.sin(d), Math.cos(d));
  return turnWithin(q, c, turn, board) ?? q;
}

/** `turnQuad` by `angle`, backed off to the largest turn that is still allowed (bisection); null when not even a hair of it is. */
export function turnWithin(q: Pt[], c: Pt, angle: number, board: boolean): Pt[] | null {
  const at = (a: number) => turnQuad(q, c, a);
  if (quadUpright(at(angle), board)) return at(angle);
  if (!quadUpright(q, board)) return null;
  let lo = 0, hi = angle;
  for (let k = 0; k < 14; k++) { const mid = (lo + hi) / 2; if (quadUpright(at(mid), board)) lo = mid; else hi = mid; }
  return lo === 0 ? null : at(lo);
}
