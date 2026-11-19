import type { FingerId, HandPoseName } from "./joints";

/** Extra flexion (radians) on top of the GLB bind / rest pose. Ported from Hexalt (src/lib/hand/poses.ts). */
export type FingerCurl = { mcp: number; pip: number; dip: number; spread?: number; opposition?: number };
export type HandPoseRecipe = Record<FingerId, FingerCurl>;

const allFingers = (c: FingerCurl): HandPoseRecipe => ({ thumb: { ...c }, index: { ...c }, middle: { ...c }, ring: { ...c }, pinky: { ...c } });

export const HAND_POSE_RECIPES: Record<HandPoseName, HandPoseRecipe> = {
  rest: allFingers({ mcp: 0, pip: 0, dip: 0 }),
  open: {
    thumb: { mcp: -0.12, pip: -0.18, dip: -0.08, opposition: -0.12 },
    index: { mcp: -0.18, pip: -0.22, dip: -0.12, spread: 0.08 },
    middle: { mcp: -0.16, pip: -0.2, dip: -0.1, spread: 0.02 },
    ring: { mcp: -0.16, pip: -0.2, dip: -0.1, spread: 0.06 },
    pinky: { mcp: -0.18, pip: -0.22, dip: -0.12, spread: 0.1 },
  },
  // Pad pinch: thumb and index curl around a piece without meeting inside it; the other fingers stay lifted and adduct.
  pinch: {
    thumb: { mcp: 0.12, pip: 0.28, dip: 0.12, opposition: 0.28 },
    index: { mcp: 0.16, pip: 0.56, dip: 0.2, spread: 0.08 },
    middle: { mcp: 0.18, pip: 0.16, dip: 0.1, spread: -0.7 },
    ring: { mcp: 0.24, pip: 0.22, dip: 0.12, spread: -0.22 },
    pinky: { mcp: 0.3, pip: 0.26, dip: 0.14, spread: -0.2 },
  },
  grip: {
    thumb: { mcp: 0.28, pip: 0.55, dip: 0.28, opposition: 0.48 },
    index: { mcp: 0.72, pip: 1.05, dip: 0.62, spread: 0.04 },
    middle: { mcp: 0.78, pip: 1.12, dip: 0.68 },
    ring: { mcp: 0.82, pip: 1.15, dip: 0.72, spread: 0.04 },
    pinky: { mcp: 0.78, pip: 1.08, dip: 0.68, spread: 0.08 },
  },
};

/** Extra thumb/index close (or open, if `extra` is negative). */
export function withPinchClose(r: HandPoseRecipe, extra: number): HandPoseRecipe {
  if (extra === 0) return r;
  return {
    ...r,
    thumb: { ...r.thumb, mcp: r.thumb.mcp + extra * 0.08, pip: r.thumb.pip + extra * 0.28, dip: r.thumb.dip + extra * 0.12, opposition: (r.thumb.opposition ?? 0) + extra * 0.12 },
    index: { ...r.index, mcp: r.index.mcp + extra * 0.12, pip: r.index.pip + extra * 0.45, dip: r.index.dip + extra * 0.18, spread: (r.index.spread ?? 0) + extra * 0.06 },
  };
}

/** Blend two recipes finger by finger: t = 0 gives `a`, t = 1 gives `b`. */
export function lerpRecipe(a: HandPoseRecipe, b: HandPoseRecipe, t: number): HandPoseRecipe {
  const k = Math.min(1, Math.max(0, t)), mix = (x: number | undefined, y: number | undefined) => (x ?? 0) + ((y ?? 0) - (x ?? 0)) * k;
  const out = {} as HandPoseRecipe;
  for (const f of Object.keys(a) as FingerId[]) {
    out[f] = { mcp: mix(a[f].mcp, b[f].mcp), pip: mix(a[f].pip, b[f].pip), dip: mix(a[f].dip, b[f].dip), spread: mix(a[f].spread, b[f].spread), opposition: mix(a[f].opposition, b[f].opposition) };
  }
  return out;
}
