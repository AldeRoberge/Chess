/// <reference lib="webworker" />
import { applySensor, renderLuminance, type RenderOptions, type Scene3D } from "./render3d";

export interface RenderReq { id: number; cam: string; key: string; scene: Scene3D; opts: RenderOptions }
export interface RenderRes { id: number; width: number; height: number; t: number; data: Uint8ClampedArray }

/** Ray-casts the virtual cameras off the main thread. Clean luminance is cached per camera until the scene key changes. */
const cache = new Map<string, { key: string; lum: Float32Array }>();
const ctx = self as unknown as { onmessage: ((e: MessageEvent<RenderReq>) => void) | null; postMessage(m: RenderRes, t: Transferable[]): void };
ctx.onmessage = (e) => {
  const { id, cam, key, scene, opts } = e.data;
  let c = cache.get(cam);
  if (!c || c.key !== key) { c = { key, lum: renderLuminance(scene, opts) }; cache.set(cam, c); }
  const f = applySensor(c.lum, opts);
  ctx.postMessage({ id, width: f.width, height: f.height, t: f.t, data: f.data }, [f.data.buffer]);
};
