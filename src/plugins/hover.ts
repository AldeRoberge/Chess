import type { HoverInfo } from "../core/types";
import type { TipRow } from "../ui/tooltip";
import { sqName, type BoardBelief, type GrayFrame } from "../vision/types";
import { detailLayout, fenPieces, fitRect } from "./shared";

/** Helpers for the "what is under the mouse" cards on node previews. */
export type P = { x: number; y: number };

export const pct = (v: number) => `${Math.round(v * 100)}%`;
export const tone = (v: number): "ok" | "warn" | "bad" => (v > 0.8 ? "ok" : v > 0.5 ? "warn" : "bad");
const PIECE: Record<string, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
export const pieceLabel = (ch: string | null | undefined) => (ch ? `${ch === ch.toUpperCase() ? "white" : "black"} ${PIECE[ch.toLowerCase()]}` : "empty");
export const isLightSquare = (sq: number) => ((sq % 8) + Math.floor(sq / 8)) % 2 === 0;

/** The part of a `withDetail` preview that holds the visual (the rest of the canvas lists rows). */
export function visualSize(w: number, h: number, base: [number, number]) {
  const l = detailLayout(w, h, base);
  return l ? { w: l.vw, h: l.vh } : { w, h };
}

/** Square under `p` on a `drawBoard` painted into a w×h box; null outside the board. */
export function boardSquareAt(p: P, w: number, h: number): number | null {
  const s = Math.min(w, h) / 8, ox = (w - s * 8) / 2, c = Math.floor((p.x - ox) / s), r = Math.floor(p.y / s);
  return c >= 0 && c < 8 && r >= 0 && r < 8 ? r * 8 + c : null;
}

/** Highlights one square (and its rank and file, faintly) on a `drawBoard`. Extra squares get a lighter tint. */
export function markSquares(ctx: CanvasRenderingContext2D, w: number, h: number, sq: number, color = "#ffe45c", others: number[] = [], otherColor = "#5cf0a8") {
  const s = Math.min(w, h) / 8, ox = (w - s * 8) / 2;
  const box = (i: number) => ({ x: ox + (i % 8) * s, y: Math.floor(i / 8) * s });
  ctx.save();
  const c = box(sq);
  ctx.fillStyle = "rgba(255,255,255,.07)"; ctx.fillRect(ox, c.y, s * 8, s); ctx.fillRect(c.x, 0, s, s * 8);
  for (const o of others) { const b = box(o); ctx.fillStyle = otherColor + "55"; ctx.fillRect(b.x, b.y, s, s); ctx.strokeStyle = otherColor; ctx.lineWidth = 1.2; ctx.strokeRect(b.x + 0.5, b.y + 0.5, s - 1, s - 1); }
  ctx.fillStyle = color + "40"; ctx.fillRect(c.x, c.y, s, s);
  ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.5, s / 10); ctx.strokeRect(c.x + 1, c.y + 1, s - 2, s - 2);
  ctx.restore();
}

export interface BoardHoverOpts {
  title: string; fen?: string;
  /** Squares the node flagged (tracker mismatches, ...), by index. */
  flagged?: number[]; flagLabel?: string;
  /** Rows for this square that only this node knows. */
  extra?: (sq: number) => TipRow[];
  /** Squares to light up besides the hovered one (legal moves, ...). */
  also?: (sq: number) => number[];
  body?: (sq: number) => string | undefined;
}

/** The card for one square of a board belief: what is tracked there, what the cameras see, and how sure it is. */
export function boardHover(p: P, w: number, h: number, b: BoardBelief | null | undefined, o: BoardHoverOpts): HoverInfo | null {
  const sq = boardSquareAt(p, w, h);
  if (sq === null) return null;
  const name = sqName(sq), piece = fenPieces(o.fen)[sq] ?? null;
  const rows: TipRow[] = [];
  if (o.fen) rows.push({ label: "Tracked piece", value: pieceLabel(piece) });
  let verdict = "";
  if (b) {
    const occ = b.occ[sq], seenPiece = occ > 0.5, white = b.white[sq];
    rows.push({ label: "Piece seen", value: `${pct(seenPiece ? occ : 1 - occ)} ${seenPiece ? "occupied" : "empty"}`, bar: seenPiece ? occ : 1 - occ, tone: tone(Math.abs(occ * 2 - 1)) });
    if (seenPiece) rows.push({ label: "Colour", value: `${white > 0.5 ? "white" : "black"} ${pct(white > 0.5 ? white : 1 - white)}`, bar: white > 0.5 ? white : 1 - white, tone: tone(Math.abs(white * 2 - 1)) });
    rows.push({ label: "Certainty", value: pct(b.conf[sq]), bar: b.conf[sq], tone: tone(b.conf[sq]) });
    if (o.fen) {
      const agree = (piece !== null) === seenPiece && (!piece || !seenPiece || (piece === piece.toUpperCase()) === white > 0.5);
      rows.push({ label: "Cameras vs. game", value: agree ? "agree" : "disagree", tone: agree ? "ok" : "bad" });
      // The red glow on a square is low certainty; a tinted disc on an empty square is something seen where the game has nothing.
      verdict = agree ? (b.conf[sq] < 0.5 ? " Red glow: the cameras are unsure about this square." : "")
        : !piece ? " The cameras see something here that the game says is empty (the tinted disc; red means they are unsure). If it is not part of a move, it is usually a tall piece leaning over from the next square, a shadow, or glare."
        : !seenPiece ? " The game has a piece here that the cameras do not see. A hand or a taller piece in front may be hiding it."
        : " The cameras see a piece of the other colour here.";
    }
    if (b.handOver) rows.push({ label: "Hand over board", value: "readings frozen", tone: "warn" });
  } else rows.push({ label: "Cameras", value: "no reading yet", tone: "warn" });
  if (o.flagged?.includes(sq)) rows.push({ label: o.flagLabel ?? "Flagged", value: "yes", tone: "bad" });
  if (o.extra) rows.push(...o.extra(sq));
  const also = o.also?.(sq) ?? [];
  return {
    title: name, tag: `${isLightSquare(sq) ? "light" : "dark"} square · ${o.title}`, color: "#ffe45c",
    body: (o.body?.(sq) ?? (piece ? `A ${pieceLabel(piece)} is on ${name}.` : `${name} is empty in the tracked game.`)) + verdict,
    rows, mark: (ctx) => markSquares(ctx, w, h, sq, "#ffe45c", also),
  };
}

/** Grayscale crop of `r` pixels around (cx, cy), for a magnifier inside the card. */
export function cropFrame(f: GrayFrame, cx: number, cy: number, r = 12) {
  const size = r * 2 + 1, data = new Uint8Array(size * size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const x = Math.round(cx) - r + i, y = Math.round(cy) - r + j;
    data[j * size + i] = x < 0 || y < 0 || x >= f.width || y >= f.height ? 0 : f.data[y * f.width + x];
  }
  return { width: size, height: size, data };
}

/** Where a camera image sits in a w×h preview, and the pixel under `p` (null off the image). */
export function framePixel(f: GrayFrame, p: P, w: number, h: number) {
  const r = fitRect(f.width, f.height, w, h), x = (p.x - r.x) / r.s, y = (p.y - r.y) / r.s;
  return { r, x, y, inside: x >= 0 && y >= 0 && x < f.width && y < f.height };
}

/** Crosshair + magnifier outline at a frame pixel, in preview coordinates. */
export function markPixel(ctx: CanvasRenderingContext2D, r: { x: number; y: number; s: number }, x: number, y: number, radius = 12, color = "#ffe45c") {
  const px = r.x + x * r.s, py = r.y + y * r.s, m = radius * r.s;
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = 1;
  ctx.strokeRect(px - m, py - m, m * 2, m * 2);
  ctx.beginPath(); ctx.moveTo(px - m * 1.6, py); ctx.lineTo(px - m * 0.4, py); ctx.moveTo(px + m * 0.4, py); ctx.lineTo(px + m * 1.6, py);
  ctx.moveTo(px, py - m * 1.6); ctx.lineTo(px, py - m * 0.4); ctx.moveTo(px, py + m * 0.4); ctx.lineTo(px, py + m * 1.6); ctx.stroke();
  ctx.restore();
}

/** Card for a plain camera image: the pixel under the pointer, its brightness, a magnified crop, and frame-wide stats. */
export function frameHover(p: P, w: number, h: number, base: [number, number], f: GrayFrame | null | undefined, title: string, extra: TipRow[] = []): HoverInfo | null {
  const v = visualSize(w, h, base);
  if (p.x > v.w || p.y > v.h) return null;
  if (!f) return { title, tag: "no picture", body: "This camera is not producing frames right now.", rows: extra };
  const { r, x, y, inside } = framePixel(f, p, v.w, v.h);
  if (!inside) return null;
  const lum = f.data[Math.floor(y) * f.width + Math.floor(x)];
  let lo = 255, hi = 0, sum = 0;
  const step = Math.max(1, Math.floor(f.data.length / 4000));
  for (let i = 0, n = 0; i < f.data.length; i += step, n++) { const q = f.data[i]; if (q < lo) lo = q; if (q > hi) hi = q; sum += q; if (n === 3999) break; }
  const mean = sum / Math.min(4000, Math.ceil(f.data.length / step));
  return {
    title: `pixel ${Math.floor(x)}, ${Math.floor(y)}`, tag: title, color: "#9fb8ff",
    body: `Brightness ${lum} of 255 here. The magnifier shows the 25×25 pixels around the pointer, exactly as this node sees them.`,
    rows: [
      { label: "Brightness", value: `${lum} / 255`, bar: lum / 255 },
      { label: "Frame brightness", value: `${Math.round(mean)} avg · ${lo}–${hi}` },
      { label: "Position", value: `${pct(x / f.width)} across · ${pct(y / f.height)} down` },
      { label: "Frame", value: `${f.width}×${f.height}` },
      ...extra,
    ],
    preview: { frame: cropFrame(f, x, y) },
    mark: (ctx) => markPixel(ctx, r, x, y),
  };
}
