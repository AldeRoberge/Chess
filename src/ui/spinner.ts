import { glyph } from "./icons";
import "./spinner.css";

/**
 * Chess-themed loading spinners. Every kind is an inline SVG that takes its colour from CSS (`color`, default `--signal`),
 * so it follows the app theme. Use `spinner()` for a DOM node, `spinnerHTML()` inside innerHTML templates,
 * `withSpinner()` for "<spinner> Connecting…" status lines, and `drawSpinner()` on a canvas.
 */
export const SPINNERS = ["knight", "board", "rook", "pawn", "orbit", "clock"] as const;
export type SpinKind = (typeof SPINNERS)[number];

/** A piece glyph placed at (x, y) in the 24x24 box, `s` times its natural size. The wrapper is left free for CSS animation. */
const piece = (name: string, x: number, y: number, s: number) =>
  `<g transform="translate(${x} ${y}) scale(${s})" stroke-width="${(1.8 / s).toFixed(1)}">${glyph(name)}</g>`;

/** A 3x3 checkerboard of 7-unit squares, offset 1.5. */
const squares = (cls: string) => {
  let out = "";
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++)
    out += `<rect class="${cls}" x="${1.5 + 7 * c}" y="${1.5 + 7 * r}" width="7" height="7" rx="1" style="--d:${(r + c) * 0.15}s" opacity="${(r + c) % 2 ? 0.14 : 0.32}"/>`;
  return out;
};

const SHAPES: Record<SpinKind, string> = {
  // a knight tours the 3x3 board in eight L-shaped hops
  knight: `${squares("cs-sq0")}<g class="cs-hop">${piece("knight", 1.4, 1.4, 0.3)}</g>`,
  // the squares light up in a diagonal wave
  board: squares("cs-sq"),
  // a rook circles the ring, leaving a trail
  rook: `<circle cx="12" cy="12" r="9" fill="none" opacity=".18" stroke-width="2"/><g class="cs-orb"><circle cx="12" cy="12" r="9" fill="none" stroke-width="2" stroke-dasharray="14 43" transform="rotate(180 12 12)"/><g class="cs-up">${piece("rook", 8, -1, 0.34)}</g></g>`,
  // a pawn marches up the file and promotes
  pawn: `<rect x="6.6" y="1.6" width="10.8" height="6.8" rx="1" opacity=".32"/><rect x="6.6" y="8.4" width="10.8" height="6.8" rx="1" opacity=".14"/><rect x="6.6" y="15.2" width="10.8" height="6.8" rx="1" opacity=".32"/><g class="cs-march">${piece("pawn", 6.6, 13.2, 0.45)}</g><g class="cs-crown">${piece("queen", 6.6, -0.4, 0.45)}</g>`,
  // a queen with pieces orbiting her
  orbit: `<circle cx="12" cy="12" r="10" fill="none" opacity=".16"/><circle cx="12" cy="12" r="7" fill="none" opacity=".16"/>${piece("queen", 7.2, 7.4, 0.4)}<g class="cs-o1"><circle cx="12" cy="2" r="1.7" fill="currentColor" stroke="none"/></g><g class="cs-o2"><circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none"/></g>`,
  // a chess clock whose hand ticks round
  clock: `<circle cx="12" cy="13.5" r="8.5" fill="none"/><path d="M9 2.5h6M12 2.5v2.5M12 13.5 15 15.5"/><g class="cs-hand"><path d="M12 13.5V7.5"/></g>`,
};

/** Markup for a decorative spinner (hidden from assistive tech: put the text label beside it). */
export const spinnerHTML = (kind: SpinKind = "knight", size = 20): string =>
  `<span class="chess-spin cs-${kind}" aria-hidden="true" style="--spin-size:${size}px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${SHAPES[kind]}</svg></span>`;

/** A standalone spinner element that announces `label` to screen readers. */
export function spinner(kind: SpinKind = "knight", opts: { size?: number; label?: string } = {}): HTMLElement {
  const t = document.createElement("template");
  t.innerHTML = spinnerHTML(kind, opts.size);
  const s = t.content.firstElementChild as HTMLElement;
  s.removeAttribute("aria-hidden"); s.setAttribute("role", "img"); s.setAttribute("aria-label", opts.label ?? "Loading");
  return s;
}

/** An inline "spinner + text" status, e.g. withSpinner("Connecting…"). */
export function withSpinner(text: string, kind: SpinKind = "knight", size = 16): HTMLElement {
  const row = document.createElement("span");
  row.className = "cs-row";
  row.innerHTML = spinnerHTML(kind, size);
  row.append(text);
  return row;
}

const TOUR: [number, number][] = [[0, 0], [1, 2], [2, 0], [0, 1], [2, 2], [1, 0], [0, 2], [2, 1]];
/**
 * Canvas version of the knight spinner, for preview canvases: a 3x3 board with a dot hopping its knight tour.
 * `(x, y)` is the top-left, `size` the width and height, `t` the time in ms. Draws in the current fill colour.
 */
export function drawSpinner(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, t: number, color = "#6fb8ff") {
  const u = size / 3, hop = 450, i = Math.floor(t / hop), f = (t % hop) / hop;
  const a = TOUR[i % 8], b = TOUR[(i + 1) % 8], e = f * f * (3 - 2 * f); // smoothstep between squares
  ctx.save();
  ctx.fillStyle = color;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) { ctx.globalAlpha = (r + c) % 2 ? 0.14 : 0.32; ctx.fillRect(x + c * u + 1, y + r * u + 1, u - 2, u - 2); }
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(x + (a[0] + (b[0] - a[0]) * e + 0.5) * u, y + (a[1] + (b[1] - a[1]) * e + 0.5) * u, u * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
