/** Holiday calendar for the seasonal logo (see brandIcon.ts). Pure date maths, no DOM, so it also runs under node for scripts/make-touch-icons.mjs. */
export type SeasonId = "newyear" | "valentine" | "stpatrick" | "easter" | "halloween" | "christmas";
export interface Season { id: SeasonId; name: string }

export const SEASONS: readonly Season[] = [
  { id: "newyear", name: "New Year" },
  { id: "valentine", name: "Valentine's Day" },
  { id: "stpatrick", name: "St. Patrick's Day" },
  { id: "easter", name: "Easter" },
  { id: "halloween", name: "Halloween" },
  { id: "christmas", name: "Christmas" },
];
const byId = (id: SeasonId) => SEASONS.find((s) => s.id === id)!;

/** Easter Sunday (Gregorian calendar, Meeus/Jones/Butcher algorithm), as a local date at midnight. */
export function easterSunday(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

const mmdd = (d: Date) => (d.getMonth() + 1) * 100 + d.getDate();
/** Whether month-day `v` (as MMDD) is within [from, to]; a range with from > to wraps over New Year. */
const within = (v: number, from: number, to: number) => (from <= to ? v >= from && v <= to : v >= from || v <= to);
const dayNumber = (d: Date) => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);

/** The holiday whose logo applies on `date` (local time), or null for the plain logo. Earlier rows win where two overlap. */
export function seasonOn(date: Date): Season | null {
  const v = mmdd(date);
  if (within(v, 1227, 102)) return byId("newyear"); // Dec 27 to Jan 2
  if (within(v, 207, 214)) return byId("valentine"); // the week up to Feb 14
  if (within(v, 310, 317)) return byId("stpatrick"); // the week up to Mar 17
  const sinceEaster = dayNumber(date) - dayNumber(easterSunday(date.getFullYear()));
  if (sinceEaster >= -7 && sinceEaster <= 1) return byId("easter"); // the week before Easter Sunday, plus Easter Monday
  if (within(v, 1015, 1101)) return byId("halloween"); // Oct 15 to Nov 1
  if (within(v, 1201, 1226)) return byId("christmas"); // Dec 1 to Dec 26
  return null;
}

/** `?season=halloween` previews a holiday's logo and `?season=none` forces the plain one. undefined means no override. */
export function seasonOverride(search: string): Season | null | undefined {
  const value = new URLSearchParams(search).get("season");
  if (value === null) return undefined;
  if (value === "none") return null;
  return SEASONS.find((s) => s.id === value) ?? undefined;
}

export function currentSeason(now: Date = new Date(), search: string = typeof location === "undefined" ? "" : location.search): Season | null {
  const forced = seasonOverride(search);
  return forced === undefined ? seasonOn(now) : forced;
}

/** Milliseconds until just after the next local midnight, when the season may change. */
export function msUntilTomorrow(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime() + 1000;
}
