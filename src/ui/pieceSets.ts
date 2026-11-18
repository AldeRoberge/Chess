export interface PieceSet { id: string; name: string; license: string }

/** Open-source sets only (see public/pieces/CREDITS.md). Images live in public/pieces/<id>/<colour><type>.svg (bb, bk, … wr). */
export const PIECE_SETS: PieceSet[] = [
  { id: "chessnut", name: "Chessnut", license: "Apache-2.0" },
  { id: "rhosgfx", name: "Rhos", license: "CC0" },
  { id: "fantasy", name: "Fantasy", license: "MIT" },
  { id: "celtic", name: "Celtic", license: "MIT" },
  { id: "spatial", name: "Spatial", license: "MIT" },
  { id: "firi", name: "Firi", license: "CC BY 4.0" },
];

export interface PieceColors { white: string | null; black: string | null }

const KEY = "chess-piece-set", CKEY = "chess-piece-colors";
let current = PIECE_SETS[0];
let colors: PieceColors = { white: null, black: null };
try {
  const id = localStorage.getItem(KEY); current = PIECE_SETS.find((s) => s.id === id) ?? current;
  const c = JSON.parse(localStorage.getItem(CKEY) ?? "null"); if (c) colors = { white: c.white ?? null, black: c.black ?? null };
} catch { /* storage unavailable */ }
const subs = new Set<() => void>();
const cache = new Map<string, HTMLImageElement>();
const tinted = new Map<string, HTMLCanvasElement>();
const base = () => { try { return (import.meta as any).env?.BASE_URL ?? "/"; } catch { return "/"; } };

export const pieceSet = () => current;
export const pieceColors = () => colors;
export function setPieceSet(id: string) {
  const s = PIECE_SETS.find((x) => x.id === id); if (!s) return;
  current = s; try { localStorage.setItem(KEY, id); } catch { /* ignore */ }
  subs.forEach((f) => f());
}
/** Tint the white and/or black pieces (null = original colours). */
export function setPieceColors(c: Partial<PieceColors>) {
  colors = { ...colors, ...c }; tinted.clear();
  try { localStorage.setItem(CKEY, JSON.stringify(colors)); } catch { /* ignore */ }
  subs.forEach((f) => f());
}
export function onPieceStyle(f: () => void) { subs.add(f); return () => subs.delete(f); }

/** White pieces are multiplied by the colour; dark ones take its hue and keep their shading. */
function tint(img: HTMLImageElement, color: string, white: boolean) {
  const c = document.createElement("canvas"); c.width = c.height = 256;
  const g = c.getContext("2d"); if (!g) return null;
  g.drawImage(img, 0, 0, 256, 256);
  g.globalCompositeOperation = white ? "multiply" : "color"; g.fillStyle = color; g.fillRect(0, 0, 256, 256);
  g.globalCompositeOperation = "destination-in"; g.drawImage(img, 0, 0, 256, 256);
  return c;
}

/** The drawable image for a piece (`code` like "wn"), or null while it loads (callers fall back to a glyph). */
export function pieceImage(code: string, set = current.id): HTMLImageElement | HTMLCanvasElement | null {
  if (typeof Image === "undefined") return null;
  const key = `${set}/${code}`;
  let img = cache.get(key);
  if (!img) { img = new Image(); img.src = `${base()}pieces/${set}/${code}.svg`; cache.set(key, img); }
  if (!(img.complete && img.naturalWidth > 0)) return null;
  const white = code[0] === "w", col = white ? colors.white : colors.black;
  if (!col) return img;
  let t = tinted.get(key);
  if (!t) { t = tint(img, col, white) ?? undefined; if (t) tinted.set(key, t); }
  return t ?? img;
}
