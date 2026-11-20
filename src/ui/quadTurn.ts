import type { GrayFrame, Pt } from "../vision/types";
import { scoreAlignment, traceSquareGuide } from "./boardGuide";
import { quadDepth, squareToQuad } from "./quadMap";

/** The board's four corners in its own plane (a8, h8, h1, a1), and its centre. The board is square, so turning it here is a true turn. */
const CORNERS: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];

/** How close to the horizon a corner may get (the projective depth, 1 at a8) before the view is called broken. */
const MIN_DEPTH = 0.2;
/** How much deeper the far side may be than the near side. A board seen this obliquely is almost certainly a wrong perspective. */
const MAX_DEPTH_RATIO = 6;
/** The grid must sit on the square edges at least this well for its perspective to be believed. */
const TRUST = 0.5;

/**
 * The quad after the board is turned by `angle` (radians, clockwise on screen) about its centre as a flat board on the
 * table would turn, seen through the same camera: the corners are turned in the board's own plane and carried through the
 * quad's perspective, so the grid foreshortens as it comes round. Null when that would put a corner at or past the horizon.
 */
export function turnQuadPlane(q: Pt[], angle: number): Pt[] | null {
  const m = squareToQuad(q), depth = quadDepth(q), cs = Math.cos(angle), sn = Math.sin(angle);
  const out: Pt[] = [];
  for (const [u, v] of CORNERS) {
    const dx = u - 0.5, dy = v - 0.5, nu = 0.5 + dx * cs - dy * sn, nv = 0.5 + dx * sn + dy * cs;
    if (!(depth(nu, nv) > MIN_DEPTH)) return null;
    const p = m(nu, nv);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    out.push(p);
  }
  return out;
}

/** Whether the board can be turned all the way round in this perspective without a corner reaching the horizon or the near and far sides being wildly different. */
export function planeTurnable(q: Pt[]): boolean {
  const depth = quadDepth(q);
  if (!(depth(0, 0) > MIN_DEPTH) || !(depth(1, 0) > MIN_DEPTH) || !(depth(1, 1) > MIN_DEPTH) || !(depth(0, 1) > MIN_DEPTH)) return false;
  let lo = Infinity, hi = -Infinity;
  for (let a = 0; a < 360; a += 5) {
    const r = turnQuadPlane(q, (a * Math.PI) / 180);
    if (!r) return false;
    const cs = Math.cos((a * Math.PI) / 180), sn = Math.sin((a * Math.PI) / 180);
    for (const [u, v] of CORNERS) { const dx = u - 0.5, dy = v - 0.5, d = depth(0.5 + dx * cs - dy * sn, 0.5 + dx * sn + dy * cs); lo = Math.min(lo, d); hi = Math.max(hi, d); }
  }
  return hi / lo <= MAX_DEPTH_RATIO;
}

export interface TurnBase { base: Pt[]; mode: "3d" | "flat" }

/**
 * What to turn, and how. When the grid sits on the square edges of the picture its perspective is real, so the board is
 * turned in 3D ("3d"). When it does not, the square edges may still give a perspective (the squares are sharp, easy lines):
 * the corners are moved onto that and turned. When neither can be believed, or the perspective is broken, the grid is simply
 * turned in the picture ("flat").
 */
export function pickTurnBase(f: GrayFrame | null, pts: Pt[]): TurnBase {
  const flat: TurnBase = { base: pts, mode: "flat" };
  if (!f) return flat;
  try {
    const fit = (c: Pt[]) => scoreAlignment(f, squareToQuad(c)).q, here = fit(pts);
    if (here >= TRUST && planeTurnable(pts)) return { base: pts, mode: "3d" };
    const traced = traceSquareGuide(f, pts);
    if (traced && traced.corners !== pts && planeTurnable(traced.corners)) {
      const q = fit(traced.corners);
      if (q >= TRUST && q >= here) return { base: traced.corners, mode: "3d" };
    }
  } catch { /* the picture cannot be read there */ }
  return flat;
}
