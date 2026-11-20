/**
 * Watches how long each part of a frame takes and, when the page struggles, picks the single change
 * that would save the most time. Pure: the app feeds it samples and maps the action ids it returns to real
 * changes, so the rules can be tested without a DOM.
 */
export interface PerfSample {
  /** Smoothed time between animation frames (ms). */
  frameMs: number;
  /** Smoothed cost of one graph tick (ms), the work every node does together. */
  tickMs: number;
  /** Smoothed cost of the node editor's per-frame repaint (ms). */
  editorMs: number;
  /** Smoothed cost of the open tab's painting: the table, the 3D view, the log... (ms). */
  viewMs: number;
  /** Open tab: 0 table, 1 3D, 2 log, 3 perf, 4 assistant. */
  tab: number;
  /** The node editor is hidden (simple view). */
  simple: boolean;
  heat: boolean;
  /** Node editor is already in its simplified drawing mode. */
  lite: boolean;
  quality: "low" | "medium" | "high" | "custom";
  /** Backing-store scale of the game previews (0 = native). */
  scale: number;
  /** Preview frame cap (0 = uncapped). */
  fps: number;
  /** The costliest node by average tick time. */
  hot?: { title: string; avg: number };
}

export type TipAction = "lite" | "hide-nodes" | "table-tab" | "quality-low" | "quality-medium" | "fps-30" | "heat-off" | "open-perf" | "close-perf";

export interface Tip {
  id: string;
  title: string;
  body: string;
  /** Roughly how many ms per frame this should win back (for ranking and for the message). */
  saves: number;
  actions: { label: string; act: TipAction }[];
  /** Safe and reversible, so the app may apply the first action itself and offer Undo. */
  auto?: boolean;
}

/** Frame time above which the page is considered slow (about 42 fps). */
export const SLOW_MS = 24;
/** A struggling page must stay struggling this long before anything is suggested. */
export const SUSTAIN_MS = 4000;
/** Minimum gap between two notifications. */
export const GAP_MS = 45000;

const r1 = (n: number) => (Math.round(n * 10) / 10).toString();

/** Every applicable suggestion for this sample, costliest first. Ignores timing; see `PerfAdvisor` for when to speak. */
export function suggestions(s: PerfSample): Tip[] {
  const out: Tip[] = [];
  if (!s.simple && !s.lite && s.editorMs > 3) out.push({
    id: "lite-nodes", saves: s.editorMs * 0.8, auto: true,
    title: "Nodes simplified to save time",
    body: `The node editor spends ${r1(s.editorMs)} ms per frame redrawing live previews and wires. Previews now refresh a few times a second and heat bars are off.`,
    actions: [{ label: "Simplify", act: "lite" }, { label: "Hide node editor", act: "hide-nodes" }],
  });
  if (s.tab === 1 && s.viewMs > 6) out.push({
    id: "three-d", saves: s.viewMs * 0.9,
    title: "The 3D view is the costliest part of a frame",
    body: `Drawing the 3D scene takes ${r1(s.viewMs)} ms per frame. Go back to the Table tab while you play, or lower the render quality.`,
    actions: [{ label: "Back to Table", act: "table-tab" }, { label: "Lower 3D quality", act: "quality-low" }],
  });
  if (s.tab === 0 && s.viewMs > 5 && (s.scale === 0 || s.scale > 0.75 || s.fps === 0)) out.push({
    id: "table-quality", saves: s.viewMs * 0.5,
    title: "The table is drawn at full quality",
    body: `Painting the board takes ${r1(s.viewMs)} ms per frame at scale ${s.scale || "native"}${s.fps === 0 ? " with no frame cap" : ""}. Medium looks nearly the same and costs about half.`,
    actions: [{ label: "Medium quality", act: "quality-medium" }, ...(s.fps === 0 || s.fps > 30 ? [{ label: "Cap at 30 fps", act: "fps-30" as const }] : [])],
  });
  if (s.hot && s.hot.avg > 8) out.push({
    id: "heavy-node", saves: s.hot.avg * 0.25,
    title: `${s.hot.title} is the slowest node`,
    body: `It takes ${r1(s.hot.avg)} ms on average every graph tick (15 per second). Lowering its resolution or sampling rate, or bypassing it when unused, speeds up every frame it lands on.`,
    actions: [{ label: "Open Performance", act: "open-perf" }],
  });
  if (s.tab === 3) out.push({
    id: "perf-open", saves: 2,
    title: "The Performance tab is recording",
    body: "Capturing spans and drawing the flamegraph costs a little on every frame. Switch to another tab when you are not profiling.",
    actions: [{ label: "Back to Table", act: "table-tab" }],
  });
  if (s.heat && !s.simple) out.push({
    id: "heat", saves: 1.5,
    title: "Node timing bars are on",
    body: "Heat bars and sparklines repaint on every node several times a second.",
    actions: [{ label: "Turn off", act: "heat-off" }],
  });
  return out.sort((a, b) => b.saves - a.saves);
}

export class PerfAdvisor {
  private slowSince = -1;
  private lastShown = -Infinity;
  /** Tip id -> time it may speak again (Infinity = muted for the session). */
  private until = new Map<string, number>();

  /** True while the page is slow: frames take too long, or one graph tick alone eats most of a frame budget. */
  static struggling(s: PerfSample) { return s.frameMs > SLOW_MS || s.tickMs > 40; }

  /** Call about once a second (or every HUD refresh). Returns the notification to show now, if any. */
  feed(now: number, s: PerfSample): Tip | null {
    if (!PerfAdvisor.struggling(s)) { this.slowSince = -1; return null; }
    if (this.slowSince < 0) this.slowSince = now;
    if (now - this.slowSince < SUSTAIN_MS || now - this.lastShown < GAP_MS) return null;
    const tip = suggestions(s).find((t) => (this.until.get(t.id) ?? 0) <= now);
    if (!tip) return null;
    this.lastShown = now;
    // The same tip may come back later if it is still the best idea, but not within a few minutes.
    this.until.set(tip.id, now + 180000);
    return tip;
  }

  /** "Don't suggest this again" for the rest of the session. */
  mute(id: string) { this.until.set(id, Infinity); }
}
