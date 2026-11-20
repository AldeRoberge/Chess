import { describe, expect, it } from "vitest";
import { chooseHidden } from "./editor";

describe("chooseHidden", () => {
  it("hides nothing while previews fit the budget", () => {
    expect(chooseHidden(new Map([["a", 2], ["b", 3]]), () => false, 6).size).toBe(0);
  });
  it("hides the costliest first, only as many as needed", () => {
    const hide = chooseHidden(new Map([["a", 1], ["b", 9], ["c", 4]]), () => false, 6);
    expect([...hide]).toEqual(["b"]);
  });
  it("never hides cheap or hovered previews", () => {
    expect(chooseHidden(new Map([["a", 1], ["b", 1], ["c", 1]]), () => false, 0.5).size).toBe(0);
    expect(chooseHidden(new Map([["a", 9]]), (id) => id === "a", 1).size).toBe(0);
  });
});
