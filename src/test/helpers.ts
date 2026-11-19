import { render3D } from "../sim/render3d";
import { FRAME_H, FRAME_W, RIGS } from "../sim/rigs";
import type { VirtualTable } from "../sim/virtualTable";
import type { GrayFrame } from "../vision/types";
import { squareToQuad } from "../ui/quadMap";

export const flatFrame = (v: number, w = FRAME_W, h = FRAME_H, t = 0): GrayFrame => ({ width: w, height: h, data: new Uint8ClampedArray(w * h).fill(v), t });

/** What camera `rig` sees of `table` right now. */
export const shoot = (table: VirtualTable, rig = "A", t = 0, noise = 6, seed = 1): GrayFrame =>
  render3D(table.scene3d(), { width: FRAME_W, height: FRAME_H, rig: RIGS[rig], noise, gradient: 0.1, seed, t });

/** A bare checkerboard seen through the quad `c` (a8,h8,h1,a1; a1 dark), softly blurred: what the corner finder is tuned on. */
export function checkerFrame(c: { x: number; y: number }[], W = FRAME_W, H = FRAME_H, t = 0): GrayFrame {
  const data = new Uint8ClampedArray(W * H).fill(120), N = 8 * 24;
  const at = squareToQuad(c); // the unit square in perspective, painted forward densely
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const u = (i + 0.5) / N, v = (j + 0.5) / N, col = Math.floor(u * 8), row = Math.floor(v * 8), p = at(u, v), val = (col + 8 - row) % 2 === 1 ? 70 : 190;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = Math.round(p.x) + dx, y = Math.round(p.y) + dy; if (x >= 0 && y >= 0 && x < W && y < H) data[y * W + x] = val; }
  }
  const tmp = new Float32Array(W * H), out = new Uint8ClampedArray(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let a = 0, n = 0; for (let k = -2; k <= 2; k++) { const xx = x + k; if (xx >= 0 && xx < W) { a += data[y * W + xx]; n++; } } tmp[y * W + x] = a / n; }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let a = 0, n = 0; for (let k = -2; k <= 2; k++) { const yy = y + k; if (yy >= 0 && yy < H) { a += tmp[yy * W + x]; n++; } } out[y * W + x] = a / n; }
  return { width: W, height: H, data: out, t };
}

import { createRegistry } from "../plugins";
import type { NodeRuntime, ParamValues } from "../core/types";

/** Runs a single node outside a graph with a fake runtime; keeps state across calls. */
export function node(type: string, params: ParamValues = {}) {
  const spec = createRegistry().get(type)!;
  const merged: ParamValues = {};
  for (const p of spec.params ?? []) merged[p.id] = p.value;
  Object.assign(merged, params);
  const state = spec.init?.();
  const h = { fidelity: undefined as number | null | undefined, emitted: [] as [string, unknown][] };
  return {
    spec, state, params: merged, h,
    run(inputs: Record<string, any> = {}, now = 0) {
      const rt: NodeRuntime = { dt: 0.066, now, params: merged, state, setFidelity: (v) => { h.fidelity = v; }, span: (_n, f) => f(), emit: (e, p) => { h.emitted.push([e, p]); } };
      return spec.process(inputs, rt) as Record<string, any> | undefined;
    },
    paint(w = 160, hh = 120, out: Record<string, any> = {}) { const c = document.createElement("canvas"); c.width = w; c.height = hh; const ctx = c.getContext("2d")!; spec.preview!(ctx, w, hh, state, out); return ctx; },
    dispose() { spec.dispose?.(state); },
  };
}

export const tick = () => new Promise<void>((r) => setTimeout(r, 0));
