/// <reference lib="webworker" />
import { FrameCleaner, type CleanOptions } from "./cleaner";
import type { GrayFrame } from "./types";

export type CleanReq = { id: number; key: string; frame: GrayFrame; opts: CleanOptions } | { id: 0; key: string; forget: true };
export interface CleanRes { id: number; analysis: GrayFrame; cleaned: GrayFrame }

/** Board-reader picture clean-up off the main thread. Each reader keeps its own frame history here. */
const cleaners = new Map<string, FrameCleaner>();
const ctx = self as unknown as { onmessage: ((e: MessageEvent<CleanReq>) => void) | null; postMessage(m: CleanRes, t: Transferable[]): void };
ctx.onmessage = (e) => {
  const req = e.data;
  if ("forget" in req) { cleaners.delete(req.key); return; }
  let c = cleaners.get(req.key);
  if (!c) cleaners.set(req.key, (c = new FrameCleaner()));
  const r = c.run(req.frame, req.opts);
  // The analysis frame stays in the history for averaging, so it is copied; the cleaned one is new and moves.
  const analysis = { ...r.analysis, data: r.analysis.data.slice() };
  const transfer: Transferable[] = [analysis.data.buffer];
  if (r.cleaned.data.buffer !== r.analysis.data.buffer && !c.recent.some((f) => f.data.buffer === r.cleaned.data.buffer)) transfer.push(r.cleaned.data.buffer);
  ctx.postMessage({ id: req.id, analysis, cleaned: r.cleaned }, transfer);
};
