import { render3D } from "../sim/render3d";
import { FRAME_H, FRAME_W, RIGS } from "../sim/rigs";
import type { VirtualTable } from "../sim/virtualTable";
import type { GrayFrame } from "../vision/types";

export const flatFrame = (v: number, w = FRAME_W, h = FRAME_H, t = 0): GrayFrame => ({ width: w, height: h, data: new Uint8ClampedArray(w * h).fill(v), t });

/** What camera `rig` sees of `table` right now. */
export const shoot = (table: VirtualTable, rig = "A", t = 0, noise = 6, seed = 1): GrayFrame =>
  render3D(table.scene3d(), { width: FRAME_W, height: FRAME_H, rig: RIGS[rig], noise, gradient: 0.1, seed, t });

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
