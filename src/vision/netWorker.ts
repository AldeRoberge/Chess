/// <reference lib="webworker" />
import { BoardCache, BoardCnn, type BoardCnnJson } from "./boardCnn";
import weights from "./boardCnn.weights.json";

export type NetReq = { id: number; key: string; img: Float32Array } | { id: 0; key: string; forget: true };
export interface NetRes { id: number; probs: Float32Array; ran: boolean; ms: number }

/** Neural board reading off the main thread. Each reader keeps its own cache here, so a still board costs nothing. */
const caches = new Map<string, BoardCache>();
let net: BoardCnn | null = null;

/** One request in, one answer out (null for a forget). Exported so tests can drive it without a Worker. */
export function handle(req: NetReq): NetRes | null {
  if ("forget" in req) { caches.delete(req.key); return null; }
  net ??= new BoardCnn(weights as unknown as BoardCnnJson);
  let cache = caches.get(req.key);
  if (!cache) caches.set(req.key, (cache = new BoardCache(net)));
  const t0 = performance.now(), probs = cache.classify(req.img).slice();
  return { id: req.id, probs, ran: cache.ran, ms: performance.now() - t0 };
}

if (typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope) {
  const ctx = self as unknown as { onmessage: ((e: MessageEvent<NetReq>) => void) | null; postMessage(m: NetRes, t: Transferable[]): void };
  ctx.onmessage = (e) => { const r = handle(e.data); if (r) ctx.postMessage(r, [r.probs.buffer]); };
}
