import type { NetReq, NetRes } from "./netWorker";

export interface NetResult { probs: Float32Array; ran: boolean; ms: number }

/**
 * The worker that runs the neural board reader, so about 20 ms of arithmetic per read never stalls the page.
 * `supported` is false where Workers do not exist (tests): the node then runs the network inline.
 */
export class NetPool {
  private worker: Worker | null = null;
  private pending = new Map<number, (r: NetResult) => void>();
  private seq = 1;
  readonly supported: boolean;

  constructor(make?: () => Worker) {
    const factory = make ?? (typeof Worker !== "undefined" ? () => new Worker(new URL("./netWorker.ts", import.meta.url), { type: "module" }) : null);
    this.supported = !!factory;
    if (!factory) return;
    try {
      this.worker = factory();
      this.worker.onmessage = (e: MessageEvent<NetRes>) => { const r = e.data, cb = this.pending.get(r.id); this.pending.delete(r.id); cb?.({ probs: r.probs, ran: r.ran, ms: r.ms }); };
    } catch { this.worker = null; (this as { supported: boolean }).supported = false; }
  }

  /** The image is copied (the caller keeps showing it); the answer comes back without a copy. */
  read(key: string, img: Float32Array): Promise<NetResult> {
    return new Promise((resolve) => {
      const id = this.seq++, copy = img.slice();
      this.pending.set(id, resolve);
      const req: NetReq = { id, key, img: copy };
      this.worker!.postMessage(req, [copy.buffer]);
    });
  }

  forget(key: string) { if (this.worker) { const req: NetReq = { id: 0, key, forget: true }; this.worker.postMessage(req); } }
  dispose() { this.worker?.terminate(); this.worker = null; this.pending.clear(); }
}

let shared: NetPool | null = null;
export const netPool = () => (shared ??= new NetPool());
