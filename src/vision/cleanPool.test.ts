import { describe, expect, it } from "vitest";
import { CleanPool } from "./cleanPool";
import { FrameCleaner } from "./cleaner";
import type { GrayFrame } from "./types";

const frame = (w: number, h: number, v: (i: number) => number, t = 0): GrayFrame => ({ width: w, height: h, data: Uint8ClampedArray.from({ length: w * h }, (_, i) => v(i)), t });

/** Stands in for the module worker: same message shape, answered on the next microtask. */
class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  cleaners = new Map<string, FrameCleaner>();
  sent: unknown[] = [];
  postMessage(req: any) {
    this.sent.push(req);
    if (req.forget) { this.cleaners.delete(req.key); return; }
    let c = this.cleaners.get(req.key); if (!c) this.cleaners.set(req.key, (c = new FrameCleaner()));
    const r = c.run(req.frame, req.opts);
    void Promise.resolve().then(() => this.onmessage?.({ data: { id: req.id, ...r } } as MessageEvent));
  }
  terminate() {}
}

describe("FrameCleaner", () => {
  it("averages a still board, restarts on motion, and median-filters", () => {
    const c = new FrameCleaner(), o = { width: 4, height: 2, keep: 2, clean: false, reset: false };
    c.run(frame(4, 2, () => 10), o);
    expect(Array.from(c.run(frame(4, 2, () => 30), o).cleaned.data)).toEqual(Array(8).fill(20));
    expect(Array.from(c.run(frame(4, 2, () => 50), { ...o, reset: true }).cleaned.data)).toEqual(Array(8).fill(50));
    const spike = c.run(frame(4, 2, (i) => (i === 1 ? 255 : 0)), { ...o, keep: 1, clean: true });
    expect(Array.from(spike.cleaned.data)).toEqual(Array(8).fill(0));
    expect(spike.analysis.width).toBe(4);
  });
  it("resamples to the analysis size", () => {
    const r = new FrameCleaner().run(frame(8, 4, () => 100), { width: 4, height: 2, keep: 1, clean: false, reset: false });
    expect([r.analysis.width, r.analysis.height, r.cleaned.data[0]]).toEqual([4, 2, 100]);
  });
});

describe("CleanPool", () => {
  it("cleans on a worker, keeps each reader's history apart, and forgets it", async () => {
    const ws: FakeWorker[] = [];
    const pool = new CleanPool(2, () => { const w = new FakeWorker(); ws.push(w); return w as unknown as Worker; });
    expect(pool.supported).toBe(true);
    const o = { width: 2, height: 1, keep: 4, clean: false, reset: false };
    await pool.clean("a", frame(2, 1, () => 10), o);
    const r = await pool.clean("a", frame(2, 1, () => 30), o);
    expect(Array.from(r.cleaned.data)).toEqual([20, 20]);
    expect(Array.from((await pool.clean("b", frame(2, 1, () => 90), o)).cleaned.data)).toEqual([90, 90]);
    pool.forget("a");
    expect(Array.from((await pool.clean("a", frame(2, 1, () => 70), o)).cleaned.data)).toEqual([70, 70]);
    pool.dispose(); pool.forget("a");
  });
  it("is unsupported without workers, or when a worker cannot start", () => {
    expect(new CleanPool(1).supported).toBe(typeof Worker !== "undefined");
    expect(new CleanPool(1, () => { throw new Error("blocked"); }).supported).toBe(false);
  });
});
