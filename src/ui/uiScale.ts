/**
 * Adapts the UI to the screen it runs on, so nobody has to fiddle with Windows or browser zoom.
 * - `--u` (>= 1) grows type and dialogs on big / UHD viewports (css px >= ~2000 wide), capped at 1.75.
 * - `html.compact` marks small viewports (short or narrow) so the CSS can tighten paddings and go full screen.
 * - `html.coarse` marks touch-first devices (bigger hit targets).
 */
export const uiScaleFor = (w: number, h: number) => Math.max(1, Math.min(1.75, Math.min(w / 1800, h / 1000)));
export const isCompact = (w: number, h: number) => w < 1100 || h < 800;

export function installUiScale(win: Window = window, doc: Document = document) {
  const root = doc.documentElement;
  const apply = () => {
    const w = win.innerWidth, h = win.innerHeight;
    root.style.setProperty("--u", uiScaleFor(w, h).toFixed(3));
    root.classList.toggle("compact", isCompact(w, h));
    root.classList.toggle("coarse", !!win.matchMedia?.("(pointer:coarse)").matches);
  };
  apply();
  win.addEventListener("resize", apply);
  return () => win.removeEventListener("resize", apply);
}
