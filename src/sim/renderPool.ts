import type { GrayFrame } from "../vision/types";
import type { RenderOptions, Scene3D } from "./render3d";
import type { RenderReq, RenderRes } from "./render.worker";

export interface RenderJob { cam: string; key: string; scene: Scene3D; opts: RenderOptions }

/**
 * A few module workers that ray-cast virtual cameras. A camera always goes to the same worker (its
 * cached clean image stays warm there) and cameras on different workers render truly in parallel.
 * `supported` is false where Workers don't exist (tests, very old browsers): callers render inline then.
 */
export class RenderPool {
  private workers: Worker[] = [];
  private pending = new Map<number, (f: GrayFrame) => void>();
  private seq = 1;
  readonly supported: boolean;

  constructor(size = Math.max(1, Math.min(3, (typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4) - 1)), make?: () => Worker) {
    const factory = make ?? (typeof Worker !== "undefined" ? () => new Worker(new URL("./render.worker.ts", import.meta.url), { type: "module" }) : null);
    this.supported = !!factory;
    if (!factory) return;
    try {
      for (let i = 0; i < size; i++) {
        const w = factory();
        w.onmessage = (e: MessageEvent<RenderRes>) => { const r = e.data, cb = this.pending.get(r.id); this.pending.delete(r.id); cb?.({ width: r.width, height: r.height, t: r.t, data: r.data }); };
        this.workers.push(w);
      }
    } catch { this.workers.forEach((w) => w.terminate()); this.workers = []; (this as { supported: boolean }).supported = false; }
  }

  private pick(cam: string) { let h = 0; for (let i = 0; i < cam.length; i++) h = (h * 31 + cam.charCodeAt(i)) | 0; return this.workers[Math.abs(h) % this.workers.length]; }

  request(job: RenderJob): Promise<GrayFrame> {
    return new Promise((resolve) => {
      const id = this.seq++;
      this.pending.set(id, resolve);
      const req: RenderReq = { id, ...job };
      this.pick(job.cam).postMessage(req);
    });
  }

  dispose() { this.workers.forEach((w) => w.terminate()); this.workers = []; this.pending.clear(); }
}

let shared: RenderPool | null = null;
export const renderPool = () => (shared ??= new RenderPool());
