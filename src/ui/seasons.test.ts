import { describe, expect, it } from "vitest";
import { currentSeason, easterSunday, msUntilTomorrow, seasonOn, seasonOverride, SEASONS } from "./seasons";

const on = (y: number, m: number, d: number) => seasonOn(new Date(y, m - 1, d))?.id ?? null;

describe("seasonOn", () => {
  it("is the plain logo outside every holiday", () => {
    expect([on(2026, 1, 15), on(2026, 5, 20), on(2026, 8, 1), on(2026, 9, 30), on(2026, 11, 20)]).toEqual([null, null, null, null, null]);
  });

  it("starts and ends each fixed holiday on the right day", () => {
    expect([on(2026, 12, 1), on(2026, 12, 26)]).toEqual(["christmas", "christmas"]);
    expect([on(2026, 11, 30), on(2026, 12, 27)]).toEqual([null, "newyear"]);
    expect([on(2026, 10, 14), on(2026, 10, 15), on(2026, 10, 31), on(2026, 11, 1), on(2026, 11, 2)]).toEqual([null, "halloween", "halloween", "halloween", null]);
    expect([on(2026, 2, 6), on(2026, 2, 7), on(2026, 2, 14), on(2026, 2, 15)]).toEqual([null, "valentine", "valentine", null]);
    expect([on(2026, 3, 9), on(2026, 3, 10), on(2026, 3, 17), on(2026, 3, 18)]).toEqual([null, "stpatrick", "stpatrick", null]);
  });

  it("keeps New Year's logo across the year boundary", () => {
    expect([on(2026, 12, 31), on(2027, 1, 1), on(2027, 1, 2), on(2027, 1, 3)]).toEqual(["newyear", "newyear", "newyear", null]);
  });

  it("follows Easter, which moves every year", () => {
    expect(easterSunday(2026)).toEqual(new Date(2026, 3, 5));
    expect(easterSunday(2027)).toEqual(new Date(2027, 2, 28));
    expect(easterSunday(2038)).toEqual(new Date(2038, 3, 25));
    expect([on(2026, 3, 28), on(2026, 3, 29), on(2026, 4, 5), on(2026, 4, 6), on(2026, 4, 7)]).toEqual([null, "easter", "easter", "easter", null]);
    expect([on(2027, 3, 21), on(2027, 3, 28), on(2027, 3, 29), on(2027, 3, 30)]).toEqual(["easter", "easter", "easter", null]);
  });

  it("gives a holiday that overlaps Easter week to the earlier rule", () => {
    // Easter 2024 was Mar 31, so its week starts Mar 24 and never touches Mar 17; Easter 2008 was Mar 23, so its week began Mar 16.
    expect(on(2008, 3, 16)).toBe("stpatrick");
    expect(on(2008, 3, 17)).toBe("stpatrick");
    expect(on(2008, 3, 18)).toBe("easter");
  });

  it("is not thrown by daylight saving changes", () => {
    expect(seasonOn(new Date(2026, 2, 8, 23, 30))).toBeNull(); // US spring-forward evening
    expect(seasonOn(new Date(2026, 10, 1, 0, 30))?.id).toBe("halloween"); // US fall-back night
  });

  it("returns a known season every time", () => {
    for (let day = 0; day < 366; day++) {
      const season = seasonOn(new Date(2028, 0, 1 + day));
      expect(season === null || SEASONS.includes(season)).toBe(true);
    }
  });
});

describe("seasonOverride and currentSeason", () => {
  it("previews a holiday from the query string", () => {
    expect(seasonOverride("?season=halloween")?.id).toBe("halloween");
    expect(seasonOverride("?foo=1&season=christmas")?.id).toBe("christmas");
  });

  it("forces the plain logo with season=none", () => {
    expect(seasonOverride("?season=none")).toBeNull();
    expect(currentSeason(new Date(2026, 11, 10), "?season=none")).toBeNull();
  });

  it("ignores a missing or unknown value", () => {
    expect(seasonOverride("")).toBeUndefined();
    expect(seasonOverride("?season=arbor-day")).toBeUndefined();
    expect(currentSeason(new Date(2026, 11, 10), "?season=arbor-day")?.id).toBe("christmas");
  });

  it("uses the date when nothing is forced", () => {
    expect(currentSeason(new Date(2026, 9, 31), "")?.id).toBe("halloween");
    expect(currentSeason(new Date(2026, 9, 31), "?season=valentine")?.id).toBe("valentine");
  });
});

describe("msUntilTomorrow", () => {
  it("waits until just after the next local midnight", () => {
    expect(msUntilTomorrow(new Date(2026, 5, 10, 23, 59, 0))).toBe(61_000);
    expect(msUntilTomorrow(new Date(2026, 5, 10, 0, 0, 0))).toBe(86_400_000 + 1000);
  });

  it("crosses a month and a year", () => {
    expect(msUntilTomorrow(new Date(2026, 11, 31, 23, 0, 0))).toBe(3_601_000);
  });
});
