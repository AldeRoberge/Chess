import type { GrayFrame } from "./types";
import type { CleanOptions, Cleaned } from "./cleaner";
import type { CleanReq, CleanRes } from "./clean.worker";

/**
 * Workers that run the board readers' picture clean-up (resample, frame averaging, median) so a
 * camera frame never stalls the page. A reader always goes to the same worker, where its averaged
 * frames live. `supported` is false where Workers don't exist (tests): readers clean inline then.
 */
export class CleanPool {
  private workers: Worker[] = [];
  private pending = new Map<number, (r: Cleaned) => void>();
  private seq = 1;
  readonly supported: boolean;

  constructor(size = Math.max(1, Math.min(2, (typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4) - 2)), make?: () => Worker) {
    const factory = make ?? (typeof Worker !== "undefined" ? () => new Worker(new URL("./clean.worker.ts", import.meta.url), { type: "module" }) : null);
    this.supported = !!factory;
    if (!factory) return;
    try {
      for (let i = 0; i < size; i++) {
        const w = factory();
        w.onmessage = (e: MessageEvent<CleanRes>) => { const r = e.data, cb = this.pending.get(r.id); this.pending.delete(r.id); cb?.({ analysis: r.analysis, cleaned: r.cleaned }); };
        this.workers.push(w);
      }
    } catch { this.workers.forEach((w) => w.terminate()); this.workers = []; (this as { supported: boolean }).supported = false; }
  }

  private pick(key: string) { let h = 0; for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0; return this.workers[Math.abs(h) % this.workers.length]; }

  /** The frame is copied (the caller keeps showing it), the result comes back without a copy. */
  clean(key: string, frame: GrayFrame, opts: CleanOptions): Promise<Cleaned> {
    return new Promise((resolve) => {
      const id = this.seq++;
      this.pending.set(id, resolve);
      const req: CleanReq = { id, key, frame, opts };
      this.pick(key).postMessage(req);
    });
  }

  /** Drop a reader's averaged frames (it was removed, or its camera went away). */
  forget(key: string) { if (this.workers.length) { const req: CleanReq = { id: 0, key, forget: true }; this.pick(key).postMessage(req); } }

  dispose() { this.workers.forEach((w) => w.terminate()); this.workers = []; this.pending.clear(); }
}

let shared: CleanPool | null = null;
export const cleanPool = () => (shared ??= new CleanPool());
