import { boardTheme } from "../ui/boardThemes";
import { pieceImage } from "../ui/pieceSets";
import { RIGS, rigCorners } from "../sim/rigs";
import type { BoardBelief, GrayFrame, Pt } from "../vision/types";

export const CAM_PRESETS: Record<string, Pt[]> = Object.fromEntries(Object.entries(RIGS).map(([k, r]) => [k, rigCorners(r)]));

export const parseCorners = (s: string): Pt[] | null => {
  const pts = s.split(";").map((p) => p.split(",").map(Number));
  return pts.length === 4 && pts.every((p) => p.length === 2 && p.every(Number.isFinite)) ? pts.map(([x, y]) => ({ x, y })) : null;
};
export const fmtCorners = (c: Pt[]) => c.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(";");

/** Plain grey copy of a frame, built once per frame object and shared by every preview that shows it (camera + reader previews, 15x/s). */
const frameCache = new WeakMap<GrayFrame, HTMLCanvasElement>();
let scratch: ImageData | null = null;
function frameCanvas(f: GrayFrame): HTMLCanvasElement {
  let c = frameCache.get(f);
  if (c) return c;
  if (!scratch || scratch.width !== f.width || scratch.height !== f.height) scratch = new ImageData(f.width, f.height);
  const d = new Uint32Array(scratch.data.buffer); // one 32-bit write per pixel (little-endian ABGR)
  for (let i = 0; i < f.data.length; i++) { const v = f.data[i]; d[i] = 0xff000000 | (v << 16) | (v << 8) | v; } // R = G = B: neutral grey
  c = document.createElement("canvas"); c.width = f.width; c.height = f.height;
  c.getContext("2d")!.putImageData(scratch, 0, 0);
  frameCache.set(f, c);
  return c;
}

/** Where a fw×fh image lands inside a w×h box: uniform scale `s`, centred (letterboxed), so it never stretches. */
export interface FitRect { x: number; y: number; s: number }
export function fitRect(fw: number, fh: number, w: number, h: number): FitRect {
  const s = Math.min(w / fw, h / fh);
  return { x: (w - fw * s) / 2, y: (h - fh * s) / 2, s };
}

/** Draws the frame uniformly scaled and centred in the box; returns the placed rect so overlays can map onto it. */
export function drawFrame(ctx: CanvasRenderingContext2D, w: number, h: number, f: GrayFrame | null | undefined, off = "offline"): FitRect | null {
  ctx.fillStyle = "#07090d"; ctx.fillRect(0, 0, w, h);
  if (!f) { ctx.fillStyle = "#566"; ctx.font = "12px system-ui"; ctx.fillText(off, 8, h / 2); return null; }
  const r = fitRect(f.width, f.height, w, h);
  ctx.drawImage(frameCanvas(f), r.x, r.y, f.width * r.s, f.height * r.s);
  return r;
}

const GLYPH: Record<string, string> = { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚" };
export function fenPieces(fen: string | undefined): (string | null)[] {
  const out: (string | null)[] = [];
  for (const ch of (fen ?? "").split(" ")[0]) { if (ch === "/") continue; if (ch >= "1" && ch <= "8") for (let k = 0; k < +ch; k++) out.push(null); else out.push(ch); }
  return out.length === 64 ? out : [];
}

/** Board preview: themed squares, a piece glyph per tracked piece (from `fen`), plain discs for pieces seen but not identified. */
export function drawBoard(ctx: CanvasRenderingContext2D, w: number, h: number, b: { occ: ArrayLike<number>; white: ArrayLike<number>; conf?: ArrayLike<number> } | null | undefined, opts: { diff?: number[]; lifted?: string; fen?: string } = {}) {
  const th = boardTheme();
  ctx.fillStyle = th.surround; ctx.fillRect(0, 0, w, h);
  const s = Math.min(w, h) / 8;
  const ox = (w - s * 8) / 2;
  const pcs = fenPieces(opts.fen);
  for (let i = 0; i < 64; i++) {
    const x = ox + (i % 8) * s, y = Math.floor(i / 8) * s;
    ctx.fillStyle = ((i % 8) + Math.floor(i / 8)) % 2 ? th.dark : th.light;
    ctx.fillRect(x, y, s, s);
    const conf = b?.conf?.[i] ?? 1, seen = !!b && b.occ[i] > 0.5, pc = pcs[i];
    if (pc && (seen || !b)) {
      const white = pc === pc.toUpperCase();
      ctx.globalAlpha = 0.45 + 0.55 * conf;
      const img = pieceImage((white ? "w" : "b") + pc.toLowerCase());
      if (img) ctx.drawImage(img, x, y, s, s);
      else {
        ctx.font = `${s * 0.86}px "Segoe UI Symbol", serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillStyle = white ? "#fdfdfd" : "#262421"; ctx.strokeStyle = white ? "#3b3a37" : "#0d0d0d"; ctx.lineWidth = white ? 1.4 : 0.8;
        const g = GLYPH[pc.toLowerCase()]; ctx.strokeText(g, x + s / 2, y + s * 0.55); ctx.fillText(g, x + s / 2, y + s * 0.55);
      }
      ctx.globalAlpha = 1;
    } else if (seen) {
      ctx.globalAlpha = 0.45 + 0.55 * conf;
      ctx.fillStyle = b!.white[i] > 0.5 ? "#fdfdfd" : "#262421"; ctx.strokeStyle = b!.white[i] > 0.5 ? "#3b3a37" : "#0d0d0d";
      ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, s * 0.3, 0, 7); ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (b && conf < 0.5) { ctx.fillStyle = "rgba(255,170,60,.45)"; ctx.fillRect(x + s * 0.35, y + s * 0.35, s * 0.3, s * 0.3); }
  }
  ctx.strokeStyle = "#ff5a6e"; ctx.lineWidth = 2;
  for (const i of opts.diff ?? []) ctx.strokeRect(ox + (i % 8) * s + 1, Math.floor(i / 8) * s + 1, s - 2, s - 2);
  ctx.lineWidth = 1;
}

export type { BoardBelief };

export type DetailRow = [label: string, value: string, color?: string];
/** Compact one-line text for any value (used by the detail panels). */
export function brief(v: unknown, max = 120): string {
  if (v == null) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(3);
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (ArrayBuffer.isView(v)) return `${(v as any).constructor.name}[${(v as any).length}]`;
  if (Array.isArray(v)) return v.length ? `[${v.length}] ${brief(v[v.length - 1], max)}` : "[0]";
  try { const s = JSON.stringify(v, (_k, x) => (ArrayBuffer.isView(x) ? `${(x as any).constructor.name}[${(x as any).length}]` : x)); return s.length > max ? s.slice(0, max) + "…" : s; } catch { return String(v); }
}
export const objRows = (o: Record<string, unknown> | null | undefined): DetailRow[] => Object.entries(o ?? {}).map(([k, v]) => [k, brief(v)]);

/** Label / value rows filling a rectangle; rows that do not fit are dropped, long values are cut. */
export function drawRows(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rows: DetailRow[]) {
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.font = `500 12px "IBM Plex Mono",ui-monospace,monospace`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  const lh = 15, fit = Math.max(0, Math.floor((h - 6) / lh)), lab = Math.min(110, w * 0.38);
  rows.slice(0, fit).forEach(([l, v, c], i) => {
    const yy = y + 4 + 11 + i * lh;
    ctx.fillStyle = "#6f7f9f"; ctx.fillText(l, x + 6, yy);
    ctx.fillStyle = c ?? "#d5def2";
    let t = v; while (t.length > 1 && ctx.measureText(t).width > w - lab - 12) t = t.slice(0, -2);
    ctx.fillText(t === v ? t : t + "…", x + 6 + lab, yy);
  });
  ctx.restore();
}

/**
 * Preview that grows into more information instead of just zooming: at about its default size the visual fills the
 * canvas; once the node is expanded the visual keeps a sensible size and the extra space lists live details.
 */
export function detailLayout(w: number, h: number, base: [number, number]): { vw: number; vh: number; side: boolean } | null {
  const [bw, bh] = base, aspect = bw / bh;
  if (Math.min(w / bw, h / bh) <= 1.5) return null;
  const side = w / h >= aspect * 1.3;
  const vw = side ? Math.min(w - 170, h * aspect) : w, vh = side ? h : Math.min(h - 90, w / aspect);
  return vw < 80 || vh < 60 ? null : { vw, vh, side };
}

export function withDetail(ctx: CanvasRenderingContext2D, w: number, h: number, base: [number, number], paint: (w: number, h: number) => void, rows: () => DetailRow[]) {
  const L = detailLayout(w, h, base);
  if (!L) return paint(w, h);
  const { vw, vh, side } = L;
  ctx.fillStyle = "#07090d"; ctx.fillRect(0, 0, w, h);
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, vw, vh); ctx.clip(); paint(vw, vh); ctx.restore();
  if (side) drawRows(ctx, vw, 0, w - vw, h, rows()); else drawRows(ctx, 0, vh, w, h - vh, rows());
}
