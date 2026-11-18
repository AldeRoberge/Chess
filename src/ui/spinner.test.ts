import { afterEach, describe, expect, it } from "vitest";
import { SPINNERS, drawSpinner, spinner, spinnerHTML, withSpinner } from "./spinner";

afterEach(() => { document.body.innerHTML = ""; });

describe("spinner", () => {
  it("renders every kind as a decorative svg with a size", () => {
    for (const k of SPINNERS) {
      document.body.innerHTML = spinnerHTML(k, 30);
      const s = document.querySelector<HTMLElement>(".chess-spin")!;
      expect(s.classList.contains(`cs-${k}`)).toBe(true);
      expect(s.getAttribute("aria-hidden")).toBe("true");
      expect(s.style.getPropertyValue("--spin-size")).toBe("30px");
      expect(s.querySelector("svg")!.innerHTML.length).toBeGreaterThan(50);
    }
  });
  it("defaults to a 20px knight", () => {
    document.body.innerHTML = spinnerHTML();
    const s = document.querySelector<HTMLElement>(".chess-spin")!;
    expect(s.classList.contains("cs-knight")).toBe(true); expect(s.style.getPropertyValue("--spin-size")).toBe("20px");
  });
  it("spinner() is announced with a label, defaulting to Loading", () => {
    const a = spinner(); expect(a.getAttribute("role")).toBe("img"); expect(a.getAttribute("aria-label")).toBe("Loading"); expect(a.hasAttribute("aria-hidden")).toBe(false);
    const b = spinner("rook", { size: 40, label: "Scanning" }); expect(b.getAttribute("aria-label")).toBe("Scanning"); expect(b.style.getPropertyValue("--spin-size")).toBe("40px");
  });
  it("withSpinner puts the text beside a decorative spinner", () => {
    const r = withSpinner("Connecting…"); expect(r.textContent).toBe("Connecting…");
    expect(r.querySelector(".chess-spin")!.getAttribute("aria-hidden")).toBe("true");
    expect(withSpinner("Hi", "pawn", 12).querySelector<HTMLElement>(".chess-spin")!.style.getPropertyValue("--spin-size")).toBe("12px");
  });
});

describe("drawSpinner", () => {
  it("draws the board and the hopping knight, at any point in the tour", () => {
    const ctx = document.createElement("canvas").getContext("2d")!;
    for (const t of [0, 200, 450, 3500, 99999]) drawSpinner(ctx, 10, 10, 30, t);
    drawSpinner(ctx, 0, 0, 30, 0, "#fff");
    expect(ctx.fillStyle).toBeDefined();
  });
});
