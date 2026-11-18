import { describe, expect, it } from "vitest";
import { blank, paintDial, paintLcd, paintPhone, rectQuad } from "../test/clockPaint";
import { readClock, readDial, readLcd, readPhone } from "./clockReader";

const R = { x: 40, y: 50, w: 200, h: 60 };
const noisy = (f: ReturnType<typeof blank>, amp: number, seed = 3) => { let s = seed; for (let i = 0; i < f.data.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; f.data[i] += ((s >>> 8) % 1000) / 1000 * amp - amp / 2; } return f; };

describe("LCD reader", () => {
  it.each(["12:34", "9:05", "10:00", "0:59", "58:17", "1:11"])("reads %s", (t) => {
    const f = blank(); paintLcd(f, R, t);
    const r = readLcd(f, rectQuad(R)), [m, s] = t.split(":").map(Number);
    expect(r.ms).toBe((m * 60 + s) * 1000); expect(r.conf).toBeGreaterThan(0.6);
  });
  it("reads light-on-dark (backlit) displays and hours", () => {
    const f = blank(); paintLcd(f, R, "1:02:45", 235, 25);
    expect(readLcd(f, rectQuad(R)).ms).toBe(3765000);
  });
  it("survives sensor noise, with a lower certainty than a clean read", () => {
    const clean = blank(); paintLcd(clean, R, "34:21");
    const n = noisy(blank(), 60); paintLcd(n, R, "34:21"); noisy(n, 40, 9);
    const a = readLcd(clean, rectQuad(R)), b = readLcd(n, rectQuad(R));
    expect(b.ms).toBe(2061000); expect(b.conf).toBeLessThanOrEqual(a.conf);
  });
  it("does not invent a time from a blank or unreadable region", () => {
    expect(readLcd(blank(), rectQuad(R)).ms).toBeNull();
    const f = blank(); paintLcd(f, R, "12:34"); noisy(f, 220, 5);
    const r = readLcd(f, rectQuad(R)); expect(r.ms === null || r.conf < 0.4).toBe(true);
  });
  it("rejects minutes/seconds that cannot exist", () => {
    const f = blank(); paintLcd(f, R, "12:78"); expect(readLcd(f, rectQuad(R)).ms).toBeNull();
  });
  it("a half-hidden display is read less certainly than a whole one", () => {
    const f = blank(); paintLcd(f, R, "12:34");
    const whole = readLcd(f, rectQuad(R));
    for (let y = R.y; y < R.y + 40; y++) for (let x = R.x + 120; x < R.x + 160; x++) f.data[y * f.width + x] = 190; // a finger over a digit
    const hidden = readLcd(f, rectQuad(R));
    expect(hidden.ms === null || hidden.ms !== whole.ms || hidden.conf < whole.conf).toBe(true);
  });
});

describe("phone reader", () => {
  it.each(["12:34", "5:08", "20:19", "3:46"])("reads %s", (t) => {
    const f = blank(); paintPhone(f, R, t);
    const r = readPhone(f, rectQuad(R)), [m, s] = t.split(":").map(Number);
    expect(r.ms).toBe((m * 60 + s) * 1000); expect(r.conf).toBeGreaterThan(0.5);
  });
});

describe("analog reader", () => {
  const D = { x: 100, y: 30, w: 120, h: 120 };
  it("converts hand position to time left before the 12 o'clock flag", () => {
    const f = blank(); paintDial(f, D, 11, 40); // 20 minutes to go
    const r = readDial(f, rectQuad(D));
    expect(r.ms).not.toBeNull(); expect(Math.abs(r.ms! - 20 * 60000)).toBeLessThanOrEqual(90000); expect(r.sigmaMs).toBeGreaterThan(10000);
  });
  it.each([[10, 15, 105], [11, 55, 5], [9, 30, 150]])("%i:%i is about %i minutes left", (h, m, left) => {
    const f = blank(); paintDial(f, D, h, m);
    const r = readDial(f, rectQuad(D)); expect(Math.abs(r.ms! - left * 60000)).toBeLessThanOrEqual(120000);
  });
  it("gives no reading for a blank dial, and a dial reading is never fully certain", () => {
    expect(readDial(blank(), rectQuad(D)).ms).toBeNull();
    const f = blank(); paintDial(f, D, 11, 20); expect(readDial(f, rectQuad(D)).conf).toBeLessThan(0.9);
  });
});

describe("readClock", () => {
  it("dispatches by kind and never throws on a degenerate quad", () => {
    const f = blank(); paintLcd(f, R, "7:07");
    expect(readClock("lcd", f, rectQuad(R)).ms).toBe(427000);
    expect(readClock("lcd", f, [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }]).ms).toBeNull();
  });
});
