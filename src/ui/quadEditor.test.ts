import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openQuadEditor, squareToQuad } from "./quadEditor";
import type { GrayFrame } from "../vision/types";

describe("squareToQuad", () => {
  it("maps the unit square corners onto the quad, including a perspective one and a degenerate one", () => {
    const m = squareToQuad([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]);
    expect(m(0, 0)).toEqual({ x: 0, y: 0 }); expect(m(1, 1)).toEqual({ x: 10, y: 10 }); expect(m(0.5, 0.5)).toEqual({ x: 5, y: 5 });
    const p = squareToQuad([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 8, y: 10 }, { x: 2, y: 10 }]);
    expect(p(1, 1).x).toBeCloseTo(8); expect(p(0, 1).x).toBeCloseTo(2);
    const d = squareToQuad([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]);
    expect(Number.isFinite(d(0.5, 0.5).x)).toBe(true);
  });
});

describe("openQuadEditor", () => {
  let raf: FrameRequestCallback[] = [];
  beforeEach(() => {
    raf = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { raf.push(cb); return raf.length; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });
  afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ""; });

  const frame: GrayFrame = { width: 100, height: 50, data: new Uint8Array(100 * 50) } as unknown as GrayFrame;
  const open = (over: Partial<Parameters<typeof openQuadEditor>[0]> = {}) => {
    const changes: string[] = []; let done = 0;
    openQuadEditor({ title: "Corners", value: "", names: ["A", "B", "C", "D"], grid: 8, frame: () => frame, change: (v: string) => changes.push(v), done: () => done++, ...over } as never);
    const cv = document.querySelector("canvas")!;
    cv.getBoundingClientRect = () => ({ left: 0, top: 0, width: 720, height: 360, right: 720, bottom: 360, x: 0, y: 0, toJSON() {} });
    cv.setPointerCapture = vi.fn();
    return { changes, done: () => done, cv };
  };
  const ptr = (type: string, x: number, y: number) => { const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }); (e as unknown as { pointerId: number }).pointerId = 1; return e; };
  const key = (k: string, shiftKey = false) => document.dispatchEvent(new KeyboardEvent("keydown", { key: k, shiftKey, bubbles: true, cancelable: true }));

  it("builds a modal, paints a frame (running the animation loop) and drags the nearest handle", () => {
    const { changes, cv } = open();
    expect(document.querySelector(".qe-head")!.textContent).toBe("Corners");
    raf.shift()!(0); expect(raf.length).toBe(1);
    cv.dispatchEvent(ptr("pointerdown", 0, 0)); expect(changes.length).toBe(1);
    cv.dispatchEvent(ptr("pointermove", 720, 360)); cv.dispatchEvent(ptr("pointermove", 9999, -50));
    cv.dispatchEvent(ptr("pointerup", 0, 0)); cv.dispatchEvent(ptr("pointermove", 10, 10));
    expect(changes.length).toBe(3);
  });

  it("falls back to a 320x240 canvas without a frame and skips the grid when grid <= 1", () => {
    const { cv } = open({ frame: () => null, grid: 1 });
    expect(cv.height).toBe(540); raf.shift()!(0);
  });

  it("nudges with arrow keys, selects with 1-4, ignores other keys and Done keeps the value", () => {
    const { changes, done } = open({ value: "10,10;90,10;90,40;10,40" });
    key("ArrowLeft"); key("ArrowRight", true); key("ArrowUp"); key("ArrowDown", true); expect(changes.length).toBe(4);
    key("3"); key("x"); key("ArrowRight"); expect(changes.length).toBe(5);
    key("Enter"); expect(done()).toBe(1); expect(document.querySelector(".qe-back")).toBeNull(); expect(changes.length).toBe(5);
    key("Escape"); expect(done()).toBe(1);
    raf.forEach((cb) => cb(0));
  });

  it("closes only once even if a detached button is clicked again", () => {
    const o = open(); const ok = document.querySelector(".qe-btn.primary") as HTMLElement, cancel = document.querySelector(".qe-btn:nth-child(2)") as HTMLElement;
    ok.click(); cancel.click(); expect(o.done()).toBe(1);
  });
  it("Escape, Cancel and a backdrop click restore the starting value; Done button keeps; Reset reverts the corners", () => {
    let o = open({ value: "10,10;90,10;90,40;10,40" });
    key("Escape"); expect(o.changes.at(-1)).toBe("10,10;90,10;90,40;10,40"); expect(o.done()).toBe(1);
    o = open(); (document.querySelector(".qe-btn:nth-child(2)") as HTMLElement).click(); expect(o.done()).toBe(1);
    o = open(); const back = document.querySelector(".qe-back")!; back.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); expect(o.done()).toBe(1);
    o = open({ value: "10,10;90,10;90,40;10,40" }); key("ArrowLeft");
    (document.querySelector(".qe-btn") as HTMLElement).click(); expect(o.changes.at(-1)).toBe("10,10;90,10;90,40;10,40");
    (document.querySelector(".qe-btn.primary") as HTMLElement).click(); expect(o.done()).toBe(1);
    o = open(); document.querySelector(".qe")!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); expect(o.done()).toBe(0);
    (document.querySelector(".qe-btn") as HTMLElement).click(); expect(o.changes.length).toBe(1);
  });
});
