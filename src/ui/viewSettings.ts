import { loadPrefs, patchPrefs } from "../setup/prefs";

/** Render quality and display helpers for the game previews (table board, 3D view, node board previews). */
export interface RenderSettings { scale: number; fps: number; aa: boolean; shadows: "off" | "low" | "high"; quality: "low" | "medium" | "high" | "custom" }
export interface DisplaySettings { coords: boolean; legalMoves: boolean; hints: boolean; lastMove: boolean; frusta: boolean }
export interface ViewSettings { render: RenderSettings; display: DisplaySettings }

export const PRESETS: Record<"low" | "medium" | "high", Omit<RenderSettings, "quality">> = {
  low: { scale: 0.5, fps: 30, aa: false, shadows: "off" },
  medium: { scale: 0.75, fps: 60, aa: true, shadows: "low" },
  high: { scale: 1, fps: 0, aa: true, shadows: "high" },
};
export const SHADOW_MAP: Record<RenderSettings["shadows"], number> = { off: 0, low: 512, high: 2048 };
export const DEFAULTS: ViewSettings = {
  render: { ...PRESETS.high, scale: 1.5, quality: "high" },
  display: { coords: true, legalMoves: true, hints: true, lastMove: true, frusta: true },
};

let cur: ViewSettings = merge(loadPrefs().view2);
const subs = new Set<(s: ViewSettings) => void>();

function merge(p: Partial<ViewSettings> | undefined): ViewSettings {
  return { render: { ...DEFAULTS.render, ...(p?.render ?? {}) }, display: { ...DEFAULTS.display, ...(p?.display ?? {}) } };
}
const save = () => { patchPrefs({ view2: cur }); subs.forEach((f) => f(cur)); };

export const viewSettings = () => cur;
export const onViewSettings = (f: (s: ViewSettings) => void) => { subs.add(f); return () => subs.delete(f); };

/** Changes individual render values; the quality label becomes "custom" unless it still matches a preset. */
export function setRender(p: Partial<Omit<RenderSettings, "quality">>) {
  const r = { ...cur.render, ...p };
  const match = (["low", "medium", "high"] as const).find((k) => (Object.keys(PRESETS[k]) as (keyof typeof PRESETS.low)[]).every((f) => PRESETS[k][f] === r[f]));
  cur = { ...cur, render: { ...r, quality: match ?? "custom" } }; save();
}
export function setQuality(q: "low" | "medium" | "high") { cur = { ...cur, render: { ...PRESETS[q], quality: q } }; save(); }
export function setDisplay(p: Partial<DisplaySettings>) { cur = { ...cur, display: { ...cur.display, ...p } }; save(); }
export function resetViewSettings() { cur = merge(undefined); save(); }

/** Device-pixel scale for a canvas: "native" (0) follows the screen, otherwise the chosen factor, never above the screen's own ratio. */
export const pixelRatio = (scale: number, dpr = devicePixelRatio) => (scale <= 0 ? dpr : Math.min(dpr, scale));

/** FPS cap gate: true when enough time has passed since `last` to draw again (0 = uncapped). */
export const dueFrame = (now: number, last: number, fps: number) => fps <= 0 || now - last >= 1000 / fps - 1;
