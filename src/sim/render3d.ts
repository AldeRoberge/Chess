import type { GrayFrame } from "../vision/types";
import { SQUARE, TABLE_Y } from "../world/coords";
import { profileHeight, profileMaxRadius, radiusAt } from "../world/profiles";
import { rng } from "../vision/synthetic";
import type { CameraRig } from "./rigs";
import { cameraBasis } from "./camera";
import type { Capsule3D, V3 } from "./arm";
import { LIGHT, SHADOW_STRENGTH, buildShadowMask, shadowAt } from "./shadow";

export interface Piece3D { type: string; color: "w" | "b"; x: number; y: number; z: number }
export interface Blob3D { x: number; y: number; z: number; r: number }

export interface Scene3D {
  pieces: Piece3D[];
  blobs: Blob3D[]; // simple spheres
  /** arms, hands and fingers */
  capsules?: Capsule3D[];
}

export interface RenderOptions {
  width: number; height: number;
  rig: CameraRig;
  noise?: number; // luminance sigma
  gain?: number; // exposure
  gradient?: number; // left->right light falloff 0..1
  seed?: number;
  t?: number;
  /** cast soft shadows of pieces and arms on the table, and shade the arms */
  shadows?: boolean;
}

const SCALE = SQUARE * 0.8; // piece units -> metres (matches the 3D view)
const HALF = SQUARE * 4;
const L_LIGHT = 135, L_DARK = 110, L_TABLE = 40, L_FLOOR = 12, L_W = 235, L_B = 22, L_HAND = 200;

/**
 * Software ray-caster that produces what an IR camera sees of a real game: tilted perspective,
 * tall pieces that occlude their neighbours and lean away from the lens, a hand and forearm
 * carrying a lifted piece, exposure / falloff / sensor noise. Deterministic for a given seed.
 */
export function renderLuminance(scene: Scene3D, o: RenderOptions): Float32Array {
  const { width: W, height: H } = o;
  const depth = new Float32Array(W * H).fill(Infinity);
  const lum = new Float32Array(W * H);
  const cam = cameraBasis(o.rig, W, H);
  const [ox, oy, oz] = o.rig.pos;
  const dirAt = (x: number, y: number): [number, number, number] => {
    const dx = x - W / 2, dy = y - H / 2;
    return [cam.f[0] * cam.fl + cam.r[0] * dx - cam.u[0] * dy, cam.f[1] * cam.fl + cam.r[1] * dx - cam.u[1] * dy, cam.f[2] * cam.fl + cam.r[2] * dx - cam.u[2] * dy];
  };

  const caps = scene.capsules ?? [];
  // pieces approximated as upright capsules for shadow casting
  const mask = o.shadows ? buildShadowMask([...caps, ...scene.pieces.map((p): Capsule3D => { const R = profileMaxRadius(p.type) * SCALE, h = profileHeight(p.type) * SCALE; return { a: [p.x, p.y + R, p.z], b: [p.x, p.y + Math.max(R, h - R * 0.6), p.z], r: R * 0.62, tone: 0 }; })], TABLE_Y) : null;

  // pass 1: board plane, table, floor
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const d = dirAt(x, y), i = y * W + x;
      if (d[1] >= 0) { lum[i] = L_FLOOR; continue; } // sky: never happens for table-facing rigs but stay defined
      const t = (TABLE_Y - oy) / d[1];
      const px = ox + d[0] * t, pz = oz + d[2] * t;
      depth[i] = t;
      if (Math.abs(px) < HALF && Math.abs(pz) < HALF) {
        const c = Math.floor((px + HALF) / SQUARE), r = Math.floor((pz + HALF) / SQUARE);
        lum[i] = (c + r) % 2 === 0 ? L_LIGHT : L_DARK;
      } else lum[i] = Math.abs(px) < 0.65 && Math.abs(pz) < 0.45 ? L_TABLE : L_FLOOR;
      if (mask) lum[i] *= 1 - SHADOW_STRENGTH * shadowAt(mask, px, pz);
    }

  // pass 2: pieces (ray vs. surface of revolution, marched inside the bounding cylinder)
  for (const p of scene.pieces) {
    const h = profileHeight(p.type) * SCALE, R = profileMaxRadius(p.type) * SCALE;
    const box = screenBox(cam, W, H, p.x, p.y, p.z, R, h);
    for (let y = box.y0; y <= box.y1; y++)
      for (let x = box.x0; x <= box.x1; x++) {
        const d = dirAt(x, y);
        const hit = hitRevolution(ox - p.x, oy, oz - p.z, d, R, p.y, h, p.type);
        const i = y * W + x;
        if (hit !== null && hit.t < depth[i]) { depth[i] = hit.t; lum[i] = (p.color === "w" ? L_W : L_B) * (0.86 + 0.14 * hit.k); }
      }
  }
  // pass 3: hand + forearm spheres
  for (const b of scene.blobs) {
    const box = screenBox(cam, W, H, b.x, b.y - b.r, b.z, b.r, b.r * 2);
    for (let y = box.y0; y <= box.y1; y++)
      for (let x = box.x0; x <= box.x1; x++) {
        const d = dirAt(x, y), t = raySphere(ox - b.x, oy - b.y, oz - b.z, d, b.r), i = y * W + x;
        if (t !== null && t < depth[i]) { depth[i] = t; lum[i] = L_HAND; } // screenBox already dropped anything behind the lens
      }
  }

  // pass 4: arms, hands and fingers (capsules, lit from the lamp)
  for (const c of caps) {
    const box = capsuleBox(cam, o.rig.pos, W, H, c);
    if (!box) continue;
    for (let y = box.y0; y <= box.y1; y++)
      for (let x = box.x0; x <= box.x1; x++) {
        const i = y * W + x, hit = rayCapsule(ox, oy, oz, dirAt(x, y), c);
        if (hit && hit.t < depth[i]) { depth[i] = hit.t; const L = o.shadows ? lightDir(hit.p) : null; lum[i] = c.tone * (L ? 0.62 + 0.38 * Math.max(0, hit.n[0] * L[0] + hit.n[1] * L[1] + hit.n[2] * L[2]) : 1); }
      }
  }

  return lum;
}

const lightDir = (p: V3): V3 => { const d: V3 = [LIGHT[0] - p[0], LIGHT[1] - p[1], LIGHT[2] - p[2]], l = Math.hypot(d[0], d[1], d[2]) || 1; return [d[0] / l, d[1] / l, d[2] / l]; };


function capsuleBox(cam: ReturnType<typeof cameraBasis>, pos: [number, number, number], W: number, H: number, c: Capsule3D) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (const p of [c.a, c.b]) {
    const z = (p[0] - pos[0]) * cam.f[0] + (p[1] - pos[1]) * cam.f[1] + (p[2] - pos[2]) * cam.f[2];
    const q = z > 0.05 ? cam.project(p) : null;
    if (!q) return null; // behind (or touching) the lens
    const pad = (c.r * cam.fl) / z + 2;
    x0 = Math.min(x0, q.x - pad); x1 = Math.max(x1, q.x + pad); y0 = Math.min(y0, q.y - pad); y1 = Math.max(y1, q.y + pad);
  }
  return { x0: Math.max(0, Math.floor(x0)), x1: Math.min(W - 1, Math.ceil(x1)), y0: Math.max(0, Math.floor(y0)), y1: Math.min(H - 1, Math.ceil(y1)) };
}

/** Ray (origin o, direction d, any length) vs a capsule: nearest hit parameter, point and outward normal. */
export function rayCapsule(ox: number, oy: number, oz: number, d: [number, number, number], c: Capsule3D): { t: number; p: V3; n: V3 } | null {
  const bax = c.b[0] - c.a[0], bay = c.b[1] - c.a[1], baz = c.b[2] - c.a[2];
  const oax = ox - c.a[0], oay = oy - c.a[1], oaz = oz - c.a[2];
  const baba = bax * bax + bay * bay + baz * baz, rdrd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  const bard = bax * d[0] + bay * d[1] + baz * d[2], baoa = bax * oax + bay * oay + baz * oaz, rdoa = d[0] * oax + d[1] * oay + d[2] * oaz, oaoa = oax * oax + oay * oay + oaz * oaz;
  let best = Infinity;
  const a = baba * rdrd - bard * bard;
  if (a > 1e-12) {
    const b = baba * rdoa - baoa * bard, cc = baba * oaoa - baoa * baoa - c.r * c.r * baba, h = b * b - a * cc;
    if (h >= 0) { const t = (-b - Math.sqrt(h)) / a, y = baoa + t * bard; if (t > 0 && y > 0 && y < baba) best = t; }
  }
  for (const end of [c.a, c.b]) { // spherical end caps
    const px = ox - end[0], py = oy - end[1], pz = oz - end[2];
    const b = d[0] * px + d[1] * py + d[2] * pz, cc = px * px + py * py + pz * pz - c.r * c.r, h = b * b - rdrd * cc;
    if (h >= 0) { const t = (-b - Math.sqrt(h)) / rdrd; if (t > 0 && t < best) best = t; }
  }
  if (best === Infinity) return null;
  const p: V3 = [ox + d[0] * best, oy + d[1] * best, oz + d[2] * best];
  const k = baba > 0 ? Math.min(1, Math.max(0, ((p[0] - c.a[0]) * bax + (p[1] - c.a[1]) * bay + (p[2] - c.a[2]) * baz) / baba)) : 0;
  const n: V3 = [(p[0] - c.a[0] - bax * k) / c.r, (p[1] - c.a[1] - bay * k) / c.r, (p[2] - c.a[2] - baz * k) / c.r];
  return { t: best, p, n };
}

/** Sensor model: exposure, lighting falloff and per-pixel noise on top of a (cacheable) clean luminance image. */
export function applySensor(lum: Float32Array, o: RenderOptions): GrayFrame {
  const { width: W, height: H } = o;
  const data = new Uint8ClampedArray(W * H);
  const rand = rng(o.seed ?? 1), noise = o.noise ?? 6, gain = o.gain ?? 1, grad = o.gradient ?? 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const n = (rand() + rand() + rand() - 1.5) * 2 * noise;
      data[i] = lum[i] * gain * (1 - grad * (x / W)) + n;
    }
  return { width: W, height: H, data, t: o.t ?? 0 };
}

export const render3D = (scene: Scene3D, o: RenderOptions): GrayFrame => applySensor(renderLuminance(scene, o), o);

function screenBox(cam: ReturnType<typeof cameraBasis>, W: number, H: number, cx: number, y0: number, cz: number, R: number, h: number) {
  let x0 = W, y0p = H, x1 = -1, y1 = -1;
  for (const dy of [0, h]) for (const [sx, sz] of [[-R, -R], [R, -R], [R, R], [-R, R]]) {
    const q = cam.project([cx + sx, y0 + dy, cz + sz]);
    if (!q) return { x0: 0, y0: 0, x1: -1, y1: -1 };
    x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0p = Math.min(y0p, q.y); y1 = Math.max(y1, q.y);
  }
  return { x0: Math.max(0, Math.floor(x0) - 1), x1: Math.min(W - 1, Math.ceil(x1) + 1), y0: Math.max(0, Math.floor(y0p) - 1), y1: Math.min(H - 1, Math.ceil(y1) + 1) };
}

function raySphere(ox: number, oy: number, oz: number, d: [number, number, number], r: number): number | null {
  const a = d[0] * d[0] + d[1] * d[1] + d[2] * d[2], b = 2 * (ox * d[0] + oy * d[1] + oz * d[2]), c = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t;
}

/** Ray (origin relative to the piece axis) vs a lathe solid standing at base height `y0`. */
function hitRevolution(ox: number, oy: number, oz: number, d: [number, number, number], R: number, y0: number, h: number, type: string): { t: number; k: number } | null {
  const a = d[0] * d[0] + d[2] * d[2], b = 2 * (ox * d[0] + oz * d[2]), c = ox * ox + oz * oz - R * R;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t0 = (-b - s) / (2 * a), t1 = (-b + s) / (2 * a); // both roots are in front: screenBox rejects pieces behind the lens
  const STEPS = 14;
  for (let k = 0; k <= STEPS; k++) {
    const t = t0 + ((t1 - t0) * k) / STEPS;
    const y = oy + d[1] * t - y0;
    if (y < 0 || y > h) continue;
    const rx = ox + d[0] * t, rz = oz + d[2] * t;
    if (Math.hypot(rx, rz) <= radiusAt(type, y / SCALE) * SCALE) return { t, k: y / h };
  }
  return null;
}
