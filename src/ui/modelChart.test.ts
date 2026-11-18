import { afterEach, describe, expect, it, vi } from "vitest";
import { openModelChart } from "./modelChart";
import type { ModelInfo } from "../core/types";

const base = { title: "Pick a model", current: "b", pick: vi.fn() };
const models: ModelInfo[] = [
  { id: "a", input: 1, output: 4 },
  { id: "b", input: 2.5, output: 10 },
  { id: "c" },
];

describe("openModelChart", () => {
  afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); });

  it("renders a row per model with scaled price bars, marking the current one", () => {
    openModelChart({ ...base, models });
    const rows = [...document.querySelectorAll<HTMLButtonElement>(".mc-row")];
    expect(rows.map((r) => r.querySelector(".mc-name")!.textContent)).toEqual(["a", "b", "c"]);
    expect(rows[1].classList.contains("on")).toBe(true);
    expect(rows[1].getAttribute("aria-selected")).toBe("true");
    expect(rows[0].getAttribute("aria-selected")).toBe("false");
    expect(rows[2].querySelector(".mc-cost")!.textContent).toBe("no price listed");
    const fills = rows[1].querySelectorAll<HTMLElement>(".mc-fill");
    expect(fills[0].style.width).toBe("25%");
    expect(fills[1].style.width).toBe("100%");
    expect(rows[1].textContent).toContain("in $2.50");
    expect(rows[1].textContent).toContain("out $10.00");
  });

  it("picks a model and closes when its row is clicked", () => {
    const pick = vi.fn();
    openModelChart({ ...base, models, pick });
    document.querySelectorAll<HTMLButtonElement>(".mc-row")[0].click();
    expect(pick).toHaveBeenCalledWith("a");
    expect(document.querySelector(".qe-back")).toBeNull();
  });

  it("closes on Escape and on Close, but not on other keys", () => {
    openModelChart({ ...base, models });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
    expect(document.querySelector(".qe-back")).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector(".qe-back")).toBeNull();

    openModelChart({ ...base, models });
    [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Close")!.click();
    expect(document.querySelector(".qe-back")).toBeNull();
  });

  it("closes when the backdrop is pressed, but not the box", () => {
    openModelChart({ ...base, models });
    const back = document.querySelector<HTMLElement>(".qe-back")!;
    back.querySelector<HTMLElement>(".qe")!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(document.querySelector(".qe-back")).not.toBeNull();
    back.dispatchEvent(new Event("pointerdown"));
    expect(document.querySelector(".qe-back")).toBeNull();
  });

  it("explains the empty state when there are no models", () => {
    openModelChart({ ...base, models: [] });
    expect(document.querySelector(".mc-list")!.textContent).toMatch(/No models yet/);
  });
});
