export interface BoardTheme { id: string; name: string; light: string; dark: string; hi: string; surround: string }

export const BOARD_THEMES: BoardTheme[] = [
  { id: "green", name: "Green", light: "#eeeed2", dark: "#769656", hi: "rgba(255,255,51,.5)", surround: "#302e2b" },
  { id: "brown", name: "Brown", light: "#f0d9b5", dark: "#b58863", hi: "rgba(255,255,51,.5)", surround: "#2b2118" },
  { id: "blue", name: "Blue", light: "#dee3e6", dark: "#8ca2ad", hi: "rgba(255,255,51,.5)", surround: "#262d33" },
  { id: "purple", name: "Purple", light: "#efefef", dark: "#8877b7", hi: "rgba(255,255,51,.5)", surround: "#2a2636" },
  { id: "tan", name: "Tan", light: "#ecdab9", dark: "#ae8a68", hi: "rgba(255,255,51,.5)", surround: "#2b231b" },
  { id: "slate", name: "Slate", light: "#c8c8c8", dark: "#5f6670", hi: "rgba(255,230,80,.55)", surround: "#1d2025" },
  { id: "red", name: "Red", light: "#f1e0d6", dark: "#b25454", hi: "rgba(255,255,51,.5)", surround: "#2e1f1f" },
];

const KEY = "chess-board-theme";
let current = BOARD_THEMES[0];
try { const id = localStorage.getItem(KEY); current = BOARD_THEMES.find((t) => t.id === id) ?? current; } catch { /* storage unavailable */ }
const subs = new Set<(t: BoardTheme) => void>();

export const boardTheme = () => current;
export function setBoardTheme(id: string) {
  const t = BOARD_THEMES.find((x) => x.id === id); if (!t) return;
  current = t;
  try { localStorage.setItem(KEY, id); } catch { /* ignore */ }
  subs.forEach((f) => f(t));
}
export function onBoardTheme(f: (t: BoardTheme) => void) { subs.add(f); return () => subs.delete(f); }
