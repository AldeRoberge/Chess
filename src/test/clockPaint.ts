import { glyph5x7 } from "../vision/clockReader";
import type { GrayFrame } from "../vision/types";

export interface Rect { x: number; y: number; w: number; h: number }
export const rectQuad = (r: Rect) => [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];

export const blank = (w = 320, h = 200, v = 190): GrayFrame => ({ width: w, height: h, data: new Uint8ClampedArray(w * h).fill(v), t: 0 });
const put = (f: GrayFrame, x0: number, y0: number, x1: number, y1: number, v: number) => {
  for (let y = Math.max(0, Math.round(y0)); y < Math.min(f.height, Math.round(y1)); y++) for (let x = Math.max(0, Math.round(x0)); x < Math.min(f.width, Math.round(x1)); x++) f.data[y * f.width + x] = v;
};

const SEG = ["1111110", "0110000", "1101101", "1111001", "0110011", "1011011", "1011111", "1110000", "1111111", "1111011"];
const BOX: [number, number, number, number][] = [[0.2, 0, 0.8, 0.14], [0.8, 0.1, 1, 0.48], [0.8, 0.52, 1, 0.9], [0.2, 0.86, 0.8, 1], [0, 0.52, 0.2, 0.9], [0, 0.1, 0.2, 0.48], [0.2, 0.43, 0.8, 0.57]];

/** Paint "m:ss" as a seven-segment display filling `r` (digit height = 70% of r.h), dark ink on a light face by default. */
export function paintLcd(f: GrayFrame, r: Rect, text: string, ink = 25, face = 195) {
  put(f, r.x, r.y, r.x + r.w, r.y + r.h, face);
  const H = r.h * 0.7, cw = H * 0.55, gap = H * 0.3, y0 = r.y + (r.h - H) / 2;
  let x = r.x + r.w * 0.06;
  for (const ch of text) {
    if (ch === ":") { put(f, x + gap * 0.1, y0 + H * 0.28, x + gap * 0.1 + H * 0.1, y0 + H * 0.38, ink); put(f, x + gap * 0.1, y0 + H * 0.62, x + gap * 0.1 + H * 0.1, y0 + H * 0.72, ink); x += gap * 0.6; continue; }
    SEG[Number(ch)].split("").forEach((on, i) => { if (on === "1") { const [a, b, c, d] = BOX[i]; put(f, x + a * cw, y0 + b * H, x + c * cw, y0 + d * H, ink); } });
    x += cw + gap;
  }
}

/** Paint "m:ss" in a large dot-matrix style, light digits on a dark screen by default. */
export function paintPhone(f: GrayFrame, r: Rect, text: string, ink = 235, face = 30) {
  put(f, r.x, r.y, r.x + r.w, r.y + r.h, face);
  const H = r.h * 0.7, cw = H * 0.6, gap = H * 0.3, y0 = r.y + (r.h - H) / 2;
  let x = r.x + r.w * 0.06;
  for (const ch of text) {
    if (ch === ":") { put(f, x + gap * 0.1, y0 + H * 0.28, x + gap * 0.1 + H * 0.1, y0 + H * 0.38, ink); put(f, x + gap * 0.1, y0 + H * 0.62, x + gap * 0.1 + H * 0.1, y0 + H * 0.72, ink); x += gap * 0.6; continue; }
    glyph5x7(Number(ch)).forEach((row, ry) => row.split("").forEach((c, rx) => { if (c === "1") put(f, x + (rx * cw) / 5, y0 + (ry * H) / 7, x + ((rx + 1) * cw) / 5, y0 + ((ry + 1) * H) / 7, ink); }));
    x += cw + gap;
  }
}

/** Paint a dial face with hour and minute hands at `hours:minutes` on the clock, in the square `r`. */
export function paintDial(f: GrayFrame, r: Rect, hours: number, minutes: number, ink = 25, face = 200) {
  put(f, r.x, r.y, r.x + r.w, r.y + r.h, face);
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, S = Math.min(r.w, r.h);
  const hand = (deg: number, len: number, th: number) => {
    const a = (deg * Math.PI) / 180, dx = Math.sin(a), dy = -Math.cos(a);
    for (let t = 0; t <= len; t += 0.5) put(f, cx + dx * t - th / 2, cy + dy * t - th / 2, cx + dx * t + th / 2, cy + dy * t + th / 2, ink);
  };
  hand(((hours % 12) * 30) + minutes / 2, S * 0.27, Math.max(2, S * 0.045));
  hand(minutes * 6, S * 0.41, Math.max(2, S * 0.03));
}
