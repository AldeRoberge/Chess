import { DEFAULT_LOOK, SEASON_LOOKS } from "./seasonArt.ts";
import type { Look } from "./seasonArt.ts";
import { currentSeason, msUntilTomorrow } from "./seasons.ts";
import type { Season } from "./seasons.ts";

/** The knight's artwork, facing right; the eye colour is the only part a look changes. */
const knightArt = (eye: string) => `<g transform="translate(66 0) scale(-1 1)"><g transform="translate(6 1) scale(.8)"><path d="m58 54.74-1.55-1.49c5.76-22.22-.61-33.41-7.13-38.91-3.03-2.56-6.88-3.98-11.18-4.15l-2.28-3.2a5.578 5.578 0 0 0-4.53-2.33c-1.57 0-3.07.67-4.12 1.83-2.03 2.24-3.02 5.01-2.9 7.89-3 2.44-3.98 5.63-4.23 6.64l-1.28 4.15c-.14.45-.38.86-.71 1.19l-3.84 3.93c-1.65 1.69-2.43 4-2.14 6.34a7.679 7.679 0 0 0 3.79 5.73l.77.42c1.33.73 2.84 1.12 4.37 1.12.99 0 1.97-.16 2.9-.48-3.36 3.34-4.48 6.98-4.85 9.15l-2.23 2.14c-.16.15-.3.31-.44.48a6.31 6.31 0 0 0-1.51 4.1v2.85c0 2.85 2.32 5.17 5.17 5.17h34.7c2.85 0 5.17-2.32 5.17-5.17v-2.85c0-1.49-.54-2.94-1.51-4.09-.14-.17-.28-.33-.44-.48Z" style="fill:#1a1a1a"/><path d="M55.37 57.78c-.05-.05-.08-.11-.13-.16l-3.27-3.14c6.1-21.19 1.05-31.8-5.23-37.09-2.99-2.53-6.87-3.43-10.64-3.18l-3.49-4.9c-.58-.81-1.76-.89-2.43-.14-1.21 1.34-2.58 3.74-1.49 7.13-.4.21-.78.43-1.15.67-2.97 1.93-3.59 5.09-3.59 5.09l-1.32 4.29c-.33 1.06-.9 2.02-1.67 2.81l-3.85 3.93a3.72 3.72 0 0 0 .71 5.77l.78.42c1.56.86 3.46.83 5-.06.81-.55 1.82-.67 2.76-.39 5.27 1.56 9.52-2.67 9.52-2.67-.45 4.76-2.94 6.05-4.83 7.04-8.29 4.32-8.15 11.29-8.15 11.29l-3.27 3.14-.13.16c-.37.43-.59.97-.59 1.54v2.85c0 .65.53 1.17 1.17 1.17h34.7c.65 0 1.17-.53 1.17-1.17v-2.85c0-.57-.22-1.11-.59-1.54Z" style="fill:#fff2d4"/><path d="M33.74 23.98c-.04-.53-.47-.96-1-1-1.04-.09-2.15.29-2.99 1.13s-1.22 1.94-1.13 2.99c.04.53.47.96 1 1 1.04.09 2.15-.29 2.99-1.13s1.22-1.94 1.13-2.99" style="fill:${eye}"/><path d="M37.43 50.81c-4.37 0-8.46-1.11-11.97-3.04-2.63 3.45-2.57 6.72-2.57 6.72h29.07c1.07-3.72 1.79-7.12 2.23-10.21-4.27 4.03-10.2 6.54-16.77 6.54Z" style="fill:#ffdfb5"/><path d="M18.9 62.17c0 .65.53 1.17 1.17 1.17h34.71c.65 0 1.17-.53 1.17-1.17v-2.85c0-.57-.22-1.11-.59-1.54H19.49c-.37.43-.59.97-.59 1.54z" style="fill:#f4c38e"/></g></g>`;

/**
 * The Chess XP knight: a cream knight on a checkerboard floor, facing right. By default it is tinted by the app theme (--signal); around a holiday it wears that holiday's look (see seasons.ts and seasonArt.ts).
 * `standalone` gives a self-contained image (favicon, PNG export) instead of an inline icon, and `square` drops the rounded corners for the iOS home-screen icon, which rounds them itself and paints transparent pixels black.
 * Static markup, safe for innerHTML. Same artwork as public/knight.svg.
 */
export function knightSvg(look: Look = DEFAULT_LOOK, opts: { standalone?: boolean; square?: boolean } = {}): string {
  const rx = opts.square ? "" : ' rx="14"';
  const [dark, light] = look.floor;
  const square = (x: number, y: number, fill: string) => `<rect x="${x}" y="${y}" width="16" height="12" style="fill:${fill}"/>`;
  const floor = square(0, 40, dark) + square(0, 52, light) + square(16, 40, light) + square(16, 52, dark) + square(32, 40, dark) + square(32, 52, light) + square(48, 40, light) + square(48, 52, dark);
  const open = opts.standalone ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` : `<svg class="brand-knight" width="24" height="24" viewBox="0 0 64 64" aria-hidden="true">`;
  return `${open}<defs><linearGradient id="kbg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:${look.bg[0]}"/><stop offset="1" style="stop-color:${look.bg[1]}"/></linearGradient></defs><rect width="64" height="64"${rx} fill="url(#kbg)"/><clipPath id="kc"><rect width="64" height="64"${rx}/></clipPath><g clip-path="url(#kc)">${floor}</g>${look.back ?? ""}${knightArt(look.eye)}${look.front ?? ""}</svg>`;
}

const lookFor = (season: Season | null): Look => (season ? SEASON_LOOKS[season.id] : DEFAULT_LOOK);

/** The inline logo for the season right now. A live binding: syncFavicon replaces it when the season changes, so importers always read the current one. */
export let KNIGHT_SVG = knightSvg(lookFor(currentSeason()));

/** The iOS home-screen icon (180x180 PNG, see scripts/make-touch-icons.mjs) for a season, or the plain one. */
const touchIconUrl = (season: Season | null) => `${import.meta.env.BASE_URL}${season ? `touch-icons/${season.id}.png` : "apple-touch-icon.png"}`;

let shown = currentSeason()?.id ?? "";
let midnight: ReturnType<typeof setTimeout> | undefined;

/**
 * Point the tab favicon and the home-screen icon at the logo for today, and swap it in the logos already on the page when a holiday starts or ends. Call after the theme attributes are applied.
 * It re-runs itself just after local midnight, so a page left open overnight still changes. Without a holiday the favicon follows the theme (--signal).
 */
export function syncFavicon() {
  if (typeof document === "undefined") return;
  const season = currentSeason();
  const signal = getComputedStyle(document.documentElement).getPropertyValue("--signal").trim();
  clearTimeout(midnight);
  midnight = setTimeout(syncFavicon, msUntilTomorrow(new Date()));

  KNIGHT_SVG = knightSvg(lookFor(season));
  if ((season?.id ?? "") !== shown) {
    shown = season?.id ?? "";
    document.querySelectorAll("svg.brand-knight").forEach((logo) => { logo.outerHTML = KNIGHT_SVG; });
  }
  const touch = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
  if (touch) touch.href = touchIconUrl(season);
  if (!season && !signal) return;
  const svg = knightSvg(lookFor(season), { standalone: true }).replace(/var\(--signal\)/g, signal);
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (link) link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
