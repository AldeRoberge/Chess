/**
 * The bot's face: the app's cream knight (same artwork as the logo, KNIGHT_SVG) made cute. A calm eye and a few small
 * flowers tucked on its ear. Static markup, safe for innerHTML.
 */

/** The knight itself, in the logo's 64x64 box, facing right (the artwork is drawn facing left and mirrored). */
const KNIGHT = `<g transform="translate(66 0) scale(-1 1)"><g transform="translate(6 1) scale(.8)"><path d="m58 54.74-1.55-1.49c5.76-22.22-.61-33.41-7.13-38.91-3.03-2.56-6.88-3.98-11.18-4.15l-2.28-3.2a5.578 5.578 0 0 0-4.53-2.33c-1.57 0-3.07.67-4.12 1.83-2.03 2.24-3.02 5.01-2.9 7.89-3 2.44-3.98 5.63-4.23 6.64l-1.28 4.15c-.14.45-.38.86-.71 1.19l-3.84 3.93c-1.65 1.69-2.43 4-2.14 6.34a7.679 7.679 0 0 0 3.79 5.73l.77.42c1.33.73 2.84 1.12 4.37 1.12.99 0 1.97-.16 2.9-.48-3.36 3.34-4.48 6.98-4.85 9.15l-2.23 2.14c-.16.15-.3.31-.44.48a6.31 6.31 0 0 0-1.51 4.1v2.85c0 2.85 2.32 5.17 5.17 5.17h34.7c2.85 0 5.17-2.32 5.17-5.17v-2.85c0-1.49-.54-2.94-1.51-4.09-.14-.17-.28-.33-.44-.48Z" fill="#1a1a1a"/><path d="M55.37 57.78c-.05-.05-.08-.11-.13-.16l-3.27-3.14c6.1-21.19 1.05-31.8-5.23-37.09-2.99-2.53-6.87-3.43-10.64-3.18l-3.49-4.9c-.58-.81-1.76-.89-2.43-.14-1.21 1.34-2.58 3.74-1.49 7.13-.4.21-.78.43-1.15.67-2.97 1.93-3.59 5.09-3.59 5.09l-1.32 4.29c-.33 1.06-.9 2.02-1.67 2.81l-3.85 3.93a3.72 3.72 0 0 0 .71 5.77l.78.42c1.56.86 3.46.83 5-.06.81-.55 1.82-.67 2.76-.39 5.27 1.56 9.52-2.67 9.52-2.67-.45 4.76-2.94 6.05-4.83 7.04-8.29 4.32-8.15 11.29-8.15 11.29l-3.27 3.14-.13.16c-.37.43-.59.97-.59 1.54v2.85c0 .65.53 1.17 1.17 1.17h34.7c.65 0 1.17-.53 1.17-1.17v-2.85c0-.57-.22-1.11-.59-1.54Z" fill="#fff2d4"/><path d="M37.43 50.81c-4.37 0-8.46-1.11-11.97-3.04-2.63 3.45-2.57 6.72-2.57 6.72h29.07c1.07-3.72 1.79-7.12 2.23-10.21-4.27 4.03-10.2 6.54-16.77 6.54Z" fill="#ffdfb5"/><path d="M18.9 62.17c0 .65.53 1.17 1.17 1.17h34.71c.65 0 1.17-.53 1.17-1.17v-2.85c0-.57-.22-1.11-.59-1.54H19.49c-.37.43-.59.97-.59 1.54z" fill="#f4c38e"/>__FACE__</g></g>`;

/** A five-petal flower centred at (x, y), `r` across, in the artwork's own (unmirrored) coordinates. */
const flower = (x: number, y: number, r: number, petal: string, rot = 0) => {
  const p = [0, 72, 144, 216, 288].map((a) => { const t = ((a + rot) * Math.PI) / 180; return `<circle cx="${(x + Math.cos(t) * r * 0.62).toFixed(2)}" cy="${(y + Math.sin(t) * r * 0.62).toFixed(2)}" r="${(r * 0.48).toFixed(2)}" fill="${petal}"/>`; }).join("");
  return `<g>${p}<circle cx="${x}" cy="${y}" r="${(r * 0.34).toFixed(2)}" fill="#ffd34d"/></g>`;
};

/** Eye, cheek, smile and the ear's flowers: drawn over the knight in its own coordinates. */
const FACE = `<path d="M33.2 9.2c1.4-1.3 3.4-1.8 5.4-1.4" fill="none" stroke="#5aa86a" stroke-width="1.1" stroke-linecap="round"/><ellipse cx="29.5" cy="11.4" rx="2.2" ry="1" transform="rotate(-35 29.5 11.4)" fill="#6fc283"/><ellipse cx="36.6" cy="15.6" rx="2.1" ry=".95" transform="rotate(30 36.6 15.6)" fill="#6fc283"/>${flower(31.4, 8.6, 3.6, "#ff9ec0", 10)}${flower(26.6, 13.2, 3, "#c9a6ff", 30)}${flower(36.2, 11.6, 2.8, "#ffffff", 0)}${flower(33.4, 15.2, 2.3, "#ffb98a", 50)}<ellipse cx="29.4" cy="26.6" rx="2.5" ry="2.9" fill="#1a1a1a"/><circle cx="30.2" cy="25.6" r=".85" fill="#fff"/>`;

const knight = () => KNIGHT.replace("__FACE__", FACE);

/**
 * The cute knight as a standalone SVG. With `tile` it sits on the app's rounded checker-floor tile like the logo, tinted by
 * the theme's `--signal` (for markup in the page); without it the background is clear and nothing refers to a CSS variable
 * (for drawing on a canvas).
 */
export function botKnightSvg(tile = true, size = 64): string {
  const ns = ' xmlns="http://www.w3.org/2000/svg"';
  if (!tile) return `<svg${ns} width="${size}" height="${size}" viewBox="0 0 64 64">${knight()}</svg>`;
  const sq = (x: number, y: number, dark: boolean) => `<rect x="${x}" y="${y}" width="16" height="12" style="fill:color-mix(in srgb,var(--signal) ${dark ? "55%,#000" : "70%,#fff"})"/>`;
  const floor = [0, 16, 32, 48].flatMap((x, i) => [sq(x, 40, i % 2 === 0), sq(x, 52, i % 2 === 1)]).join("");
  return `<svg${ns} class="bot-knight" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="bkbg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:color-mix(in srgb,var(--signal) 40%,#000)"/><stop offset="1" style="stop-color:var(--signal)"/></linearGradient><clipPath id="bkc"><rect width="64" height="64" rx="14"/></clipPath></defs><rect width="64" height="64" rx="14" fill="url(#bkbg)"/><g clip-path="url(#bkc)">${floor}</g>${knight()}</svg>`;
}

let cached: HTMLImageElement | null = null;
/** The clear-background knight as an image for canvas drawing, or null until it has loaded (callers draw a plain head meanwhile). */
export function botKnightImage(): HTMLImageElement | null {
  if (typeof Image === "undefined") return null;
  if (!cached) { cached = new Image(); cached.src = `data:image/svg+xml,${encodeURIComponent(botKnightSvg(false, 256))}`; }
  return cached.complete && cached.naturalWidth > 0 ? cached : null;
}
