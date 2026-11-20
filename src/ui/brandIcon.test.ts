import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KNIGHT_SVG, knightSvg, syncFavicon } from "./brandIcon";
import { DEFAULT_LOOK, SEASON_LOOKS } from "./seasonArt";
import { SEASONS } from "./seasons";

const faviconHref = () => decodeURIComponent(document.querySelector<HTMLLinkElement>('link[rel="icon"]')!.href.replace(/^data:image\/svg\+xml,/, ""));
const touchHref = () => new URL(document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')!.href).pathname;
const withDate = (y: number, m: number, d: number, search = "") => {
  vi.setSystemTime(new Date(y, m - 1, d, 12));
  window.history.replaceState(null, "", `/${search}`);
};

beforeEach(() => {
  vi.useFakeTimers();
  document.head.innerHTML = '<link rel="icon" href="/knight.svg"><link rel="apple-touch-icon" href="/apple-touch-icon.png">';
  document.documentElement.style.setProperty("--signal", "#1769c2");
});
afterEach(() => {
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
  document.body.innerHTML = "";
});

describe("knightSvg", () => {
  it("draws every season as valid SVG with the knight in it", () => {
    for (const season of SEASONS) {
      for (const opts of [{}, { standalone: true }, { standalone: true, square: true }]) {
        const doc = new DOMParser().parseFromString(knightSvg(SEASON_LOOKS[season.id], opts), "image/svg+xml");
        expect(doc.querySelector("parsererror"), season.id).toBeNull();
        expect(doc.documentElement.getAttribute("viewBox")).toBe("0 0 64 64");
        expect(doc.querySelectorAll("path").length).toBeGreaterThan(5);
      }
    }
  });

  it("gives holiday looks plain colours so they render outside the app", () => {
    for (const season of SEASONS) expect(knightSvg(SEASON_LOOKS[season.id])).not.toContain("--signal");
    expect(knightSvg(DEFAULT_LOOK)).toContain("--signal");
  });

  it("makes each holiday look different from the plain logo and from each other", () => {
    const all = [knightSvg(), ...SEASONS.map((s) => knightSvg(SEASON_LOOKS[s.id]))];
    expect(new Set(all).size).toBe(all.length);
  });

  it("keeps the knight's eye where the splash eyelid expects it", () => {
    for (const season of SEASONS) expect(knightSvg(SEASON_LOOKS[season.id])).toContain('d="M33.74 23.98c');
  });

  it("is an inline icon by default, a standalone image on request, and square for iOS", () => {
    expect(knightSvg()).toMatch(/^<svg class="brand-knight" width="24" height="24"/);
    expect(knightSvg(DEFAULT_LOOK, { standalone: true })).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 64 64">/);
    expect(knightSvg()).toContain('rx="14"');
    expect(knightSvg(DEFAULT_LOOK, { square: true })).not.toContain("rx=");
  });
});

describe("touch icon files", () => {
  it("has a rendered PNG for every season (run npm run icons after changing the art)", () => {
    expect(existsSync(resolve("public/apple-touch-icon.png"))).toBe(true);
    for (const season of SEASONS) expect(existsSync(resolve(`public/touch-icons/${season.id}.png`)), season.id).toBe(true);
  });
});

describe("syncFavicon", () => {
  it("tints the plain favicon with the theme colour", () => {
    withDate(2026, 6, 10);
    syncFavicon();
    expect(faviconHref()).toContain("#1769c2");
    expect(touchHref()).toBe("/apple-touch-icon.png");
  });

  it("wears the holiday logo in season, on the tab and for the home screen", () => {
    withDate(2026, 12, 10);
    syncFavicon();
    expect(faviconHref()).toContain(SEASON_LOOKS.christmas.bg[0]);
    expect(KNIGHT_SVG).toContain(SEASON_LOOKS.christmas.bg[0]);
    expect(touchHref()).toBe("/touch-icons/christmas.png");
  });

  it("swaps the logos already on the page when the season changes, and back again", () => {
    withDate(2026, 10, 30);
    syncFavicon();
    document.body.innerHTML = `<a class="brand">${KNIGHT_SVG}</a>`;
    expect(document.querySelector(".brand")!.innerHTML).toContain(SEASON_LOOKS.halloween.bg[1]);

    withDate(2026, 11, 20);
    syncFavicon();
    expect(document.querySelector(".brand")!.innerHTML).not.toContain(SEASON_LOOKS.halloween.bg[1]);
    expect(document.querySelectorAll(".brand svg.brand-knight")).toHaveLength(1);
    expect(touchHref()).toBe("/apple-touch-icon.png");
  });

  it("changes by itself when the page is left open past midnight", () => {
    withDate(2026, 12, 26);
    syncFavicon();
    expect(touchHref()).toBe("/touch-icons/christmas.png");
    vi.advanceTimersByTime(12 * 60 * 60 * 1000 + 2000); // from noon to just past midnight, when Dec 27 begins
    expect(touchHref()).toBe("/touch-icons/newyear.png");
  });

  it("previews a holiday with ?season= and the plain logo with ?season=none", () => {
    withDate(2026, 6, 10, "?season=valentine");
    syncFavicon();
    expect(touchHref()).toBe("/touch-icons/valentine.png");
    withDate(2026, 12, 10, "?season=none");
    syncFavicon();
    expect(touchHref()).toBe("/apple-touch-icon.png");
    expect(faviconHref()).toContain("#1769c2");
  });
});
