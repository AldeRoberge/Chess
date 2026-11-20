import type { Graph } from "../core/graph";
import { fmtCorners, frameScale, parseCorners } from "../plugins/shared";
import type { GrayFrame, Pt } from "../vision/types";
import { findCheckerCorners, orientBoardCorners } from "../vision/findBoard";
import { labelHints } from "../vision/boardLabels";
import { AlignBatch, type AlignJob, rememberedLayouts } from "./autoAlign";

const isBoardQuad = (names: string[] | undefined) => names?.length === 4 && names[0] === "a8" && names[1] === "h8" && names[2] === "h1" && names[3] === "a1";

/** Aligns the grid of every camera board in the workflow at once (up to 8 at a time on a strong machine). Resolves with how many boards were aligned. */
export function alignAllBoards(graph: Graph, onProgress?: (done: number, total: number, info: { fraction: number; label: string; running: number; waiting: number }) => void): Promise<{ total: number; aligned: number }> {
  const jobs: AlignJob[] = [], target = new Map<string, { id: string; sx: number; sy: number }>();
  for (const n of graph.nodes.values()) {
    if (n.bypass) continue;
    const spec = graph.registry.get(n.type);
    const p = spec?.params?.find((d): d is Extract<typeof d, { kind: "text" }> => d.kind === "text" && !!d.quad && isBoardQuad(d.quad.names) && d.quad.grid > 1);
    const fr = p ? spec?.frameOf?.(graph.states.get(n.id)) as GrayFrame | null | undefined : null;
    if (!p || !fr) continue;
    const sc = frameScale(fr.width, fr.height), stored = parseCorners(String(n.params[p.id]));
    let seed: Pt[] | null = null;
    try { const q = findCheckerCorners(fr); seed = q ? orientBoardCorners(fr, q) : null; } catch { seed = null; }
    const own = stored ? stored.map((pt) => ({ x: pt.x * sc.sx, y: pt.y * sc.sy })) : null;
    jobs.push({ id: n.id, frame: fr, start: seed ?? own, prior: rememberedLayouts(fr.width, fr.height), labels: labelHints(fr) });
    target.set(n.id, { id: p.id, ...sc });
  }
  if (!jobs.length) return Promise.resolve({ total: 0, aligned: 0 });
  const batch = new AlignBatch(jobs);
  return new Promise((resolve) => {
    const tick = () => {
      const more = batch.step(12);
      const s = batch.status;
      onProgress?.(jobs.length - batch.pending, jobs.length, { fraction: Math.min(1, s.work / jobs.length), label: s.label, running: s.running, waiting: s.waiting });
      if (more) { requestAnimationFrame(tick); return; }
      let aligned = 0;
      for (const [id, r] of batch.results) {
        const t = target.get(id), n = graph.nodes.get(id);
        if (!t || !n || r.phase !== "done" || r.corners.length !== 4) continue;
        n.params[t.id] = fmtCorners(r.corners.map((pt) => ({ x: pt.x / t.sx, y: pt.y / t.sy }))); aligned++;
      }
      resolve({ total: jobs.length, aligned });
    };
    requestAnimationFrame(tick);
  });
}
