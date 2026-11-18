/** Pure arm geometry (worker-safe): two-bone inverse kinematics, a hand that opens or grips, and the capsules the ray-caster and 3D view draw. World = metres, y up, white at +z. */
export type V3 = [number, number, number];
export interface Capsule3D { a: V3; b: V3; r: number; /** IR luminance 0..255 (skin is bright, sleeves dark) */ tone: number }
export type Hand = "L" | "R";
export interface ArmPose { side: 1 | -1; hand: Hand; active: boolean; shoulder: V3; elbow: V3; wrist: V3; stretched: boolean; capsules: Capsule3D[] }

export const UPPER = 0.3, FORE = 0.27, PALM = 0.085, FINGER = 0.075;
export const SHOULDER_Y = 1.05, SHOULDER_Z = 0.62, SHOULDER_X = 0.19;
const TONE_SKIN = 205, TONE_FOREARM = 185, TONE_SLEEVE = 70;

const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const nrm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/**
 * Two-bone IK. Returns the elbow for a shoulder->wrist chain of bone lengths l1, l2, bending toward `pole`
 * (a direction, not a point). Out-of-reach targets are clamped to a nearly straight arm, never NaN.
 */
export function twoBoneIK(shoulder: V3, target: V3, pole: V3, l1: number, l2: number): { elbow: V3; wrist: V3; stretched: boolean } {
  const to = sub(target, shoulder), raw = len(to);
  const min = Math.abs(l1 - l2) + 1e-3, max = l1 + l2 - 1e-3;
  const d = Math.min(max, Math.max(min, raw)), dir = raw > 1e-9 ? nrm(to) : ([0, -1, 0] as V3);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  let side = sub(pole, [dir[0] * dot(pole, dir), dir[1] * dot(pole, dir), dir[2] * dot(pole, dir)]);
  if (len(side) < 1e-6) side = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]; // pole parallel to the chain: any perpendicular works
  side = nrm(sub(side, [dir[0] * dot(side, dir), dir[1] * dot(side, dir), dir[2] * dot(side, dir)]));
  return { elbow: add(add(shoulder, dir, a), side, h), wrist: add(shoulder, dir, d), stretched: raw > max };
}

/** Where a resting hand waits: just above the player's table edge, on its own side of the body. */
export const restTarget = (side: 1 | -1, hand: Hand): V3 => [(hand === "R" ? 1 : -1) * side * 0.24, 0.75 + 0.12, side * 0.44];

export interface ArmOpts {
  side: 1 | -1;
  hand: Hand;
  /** where the fingertips should end up */
  tip: V3;
  /** 0 = open, flat hand; 1 = fingers curled around a piece */
  grasp: number;
  active: boolean;
}

/** A full arm for one hand: shoulder (leaning toward far squares), IK elbow and wrist, palm, four fingers and a thumb. */
export function armPose(o: ArmOpts): ArmPose {
  const { side, hand, tip, grasp } = o, out = (hand === "R" ? 1 : -1) * side; // +1 = this arm's elbow bows toward +x
  const s0: V3 = [out * SHOULDER_X, SHOULDER_Y, side * SHOULDER_Z];
  const hd = nrm([tip[0] - s0[0], 0, tip[2] - s0[2]]) as V3; // heading on the table plane
  const rightV: V3 = [-hd[2], 0, hd[0]];
  const wristWant: V3 = [tip[0] - hd[0] * (PALM + 0.01), tip[1] + 0.05, tip[2] - hd[2] * (PALM + 0.01)];
  // lean the torso toward distant squares instead of overstretching
  const flat = Math.hypot(wristWant[0] - s0[0], wristWant[2] - s0[2]), lean = Math.min(0.26, Math.max(0, flat - 0.5));
  const shoulder: V3 = [s0[0] + hd[0] * lean, s0[1] - lean * 0.3, s0[2] + hd[2] * lean];
  const ik = twoBoneIK(shoulder, wristWant, [out * 0.6, -0.8, side * 0.5], UPPER, FORE);
  const w = ik.wrist;
  const fdir = (down: number): V3 => [hd[0] * Math.cos(down), -Math.sin(down), hd[2] * Math.cos(down)];
  const knuckle = add(w, fdir(0.2), PALM);
  const curl = 0.25 + grasp * 0.85;
  const fingerLen = FINGER * (1 - 0.25 * grasp);
  const caps: Capsule3D[] = [
    { a: shoulder, b: ik.elbow, r: 0.045, tone: TONE_SLEEVE },
    { a: ik.elbow, b: w, r: 0.036, tone: TONE_FOREARM },
    { a: w, b: knuckle, r: 0.03, tone: TONE_SKIN },
  ];
  for (const k of [-0.027, -0.009, 0.009, 0.027]) {
    const base = add(knuckle, rightV, k);
    caps.push({ a: base, b: add(base, fdir(0.2 + curl), fingerLen * (1 - Math.abs(k) * 2)), r: 0.011, tone: TONE_SKIN });
  }
  const thumbSide = hand === "R" ? -1 : 1; // thumb faces the other hand
  const tb = add(add(w, rightV, 0.026 * thumbSide), fdir(0.2), 0.02);
  caps.push({ a: tb, b: add(add(tb, rightV, 0.02 * thumbSide * (1 - grasp)), fdir(0.35 + grasp * 0.5), 0.055), r: 0.013, tone: TONE_SKIN });
  return { side, hand, active: o.active, shoulder, elbow: ik.elbow, wrist: w, stretched: ik.stretched, capsules: caps };
}
