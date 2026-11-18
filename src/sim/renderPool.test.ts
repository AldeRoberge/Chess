import { describe, expect, it } from "vitest";
import { RenderPool } from "./renderPool";
import { virtualTable } from "./virtualTable";
import { RIGS, FRAME_H, FRAME_W } from "./rigs";
import { applySensor, renderLuminance } from "./render3d";
import type { RenderReq } from "./render.worker";

/** A fake worker that runs the same pipeline inline, so pooling and sticky routing are testable without real threads. */
function fake(log: number[][]) {
  const idx = log.length; log.push([]);
  const w: any = { onmessage: null, terminate() {}, postMessage(r: RenderReq) { log[idx].push(r.id); const f = applySensor(renderLuminance(r.scene, r.opts), r.opts); queueMicrotask(() => w.onmessage({ data: { id: r.id, ...f } })); } };
  return w as Worker;
}

describe("RenderPool", () => {
  const job = (cam: string) => ({ cam, key: cam, scene: virtualTable.scene3d(), opts: { width: FRAME_W, height: FRAME_H, rig: RIGS[cam], seed: 1, t: 5 } });
  it("returns frames and keeps a camera on the same worker", async () => {
    const log: number[][] = []; const pool = new RenderPool(2, () => fake(log));
    expect(pool.supported).toBe(true);
    const a1 = await pool.request(job("A")), a2 = await pool.request(job("A"));
    expect(a1.width).toBe(FRAME_W); expect(a1.data.length).toBe(FRAME_W * FRAME_H); expect(a1.t).toBe(5);
    expect(log.filter((l) => l.length === 2)).toHaveLength(1); // both A jobs hit one worker
    pool.dispose();
  });
  it("reports unsupported when worker creation throws, so callers fall back to inline rendering", () => {
    expect(new RenderPool(1, () => { throw new Error("no"); }).supported).toBe(false);
  });
});
