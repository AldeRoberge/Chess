/** App look: a theme (token set) plus a light / dark / system mode, applied as data attributes on <html>. */
export interface AppTheme { id: string; name: string }
export type ModePref = "dark" | "light" | "system";

export const APP_THEMES: AppTheme[] = [
  { id: "classic", name: "Classic" },
  { id: "nodes", name: "Nodes" },
  { id: "engine", name: "Engine" },
  { id: "studio", name: "Studio" },
  { id: "glass", name: "Glass" },
];
export const MODES: ModePref[] = ["dark", "light", "system"];

const THEME_KEY = "ce-app-theme", MODE_KEY = "ce-app-mode";
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };

export const resolveMode = (pref: ModePref, systemDark: boolean): "dark" | "light" => (pref === "system" ? (systemDark ? "dark" : "light") : pref);
export const pickTheme = (id: string | null) => APP_THEMES.find((t) => t.id === id) ?? APP_THEMES[0];
export const pickMode = (m: string | null): ModePref => (MODES.find((x) => x === m) ?? "dark");

let theme = pickTheme(read(THEME_KEY));
let mode = pickMode(read(MODE_KEY));
const subs = new Set<() => void>();

export const appTheme = () => theme;
export const appMode = () => mode;
const systemDark = () => (typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)").matches : true);

export function applyAppTheme() {
  const d = document.documentElement;
  d.dataset.theme = theme.id;
  d.dataset.mode = resolveMode(mode, systemDark());
  subs.forEach((f) => f());
}
export function setAppTheme(id: string) { theme = pickTheme(id); write(THEME_KEY, theme.id); applyAppTheme(); }
export function setAppMode(m: ModePref) { mode = pickMode(m); write(MODE_KEY, mode); applyAppTheme(); }
export const nextMode = (m: ModePref): ModePref => MODES[(MODES.indexOf(m) + 1) % MODES.length];
export function onAppTheme(f: () => void) { subs.add(f); return () => subs.delete(f); }

/** Re-resolve when the OS scheme flips while the mode is "system". */
export function watchSystemScheme() {
  if (typeof matchMedia !== "function") return;
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (mode === "system") applyAppTheme(); });
}
