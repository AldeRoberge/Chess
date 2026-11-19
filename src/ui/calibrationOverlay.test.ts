import { describe, expect, it, vi } from "vitest";
import { CalibrationOverlay } from "./calibrationOverlay";

describe("CalibrationOverlay", () => {
  it("shows Calibration in progress with the progress, then the result, and hides when cleared", () => {
    const onDismiss = vi.fn(), o = new CalibrationOverlay(onDismiss);
    expect(o.el.hidden).toBe(true);
    o.render({ cam: "A", phase: "running", label: "Trying layout 1 of 3", progress: 0.4 });
    expect(o.el.hidden).toBe(false);
    expect(o.el.textContent).toContain("Calibration in progress...");
    expect(o.el.textContent).toContain("Camera A: Trying layout 1 of 3");
    expect((o.el.querySelector(".cal-bar i") as HTMLElement).style.width).toBe("40%");
    o.render({ cam: "A", phase: "running", label: "Trying layout 1 of 3", progress: 0.4 }); // unchanged: no work
    o.render({ cam: "A", phase: "failed", label: "Could not find the board.", progress: 1 });
    expect(o.el.dataset.phase).toBe("failed");
    expect(o.el.textContent).toContain("Calibration failed");
    o.render({ cam: "A", phase: "done", label: "Board found.", progress: 1 });
    expect(o.el.textContent).toContain("Calibration finished");
    o.render(null);
    expect(o.el.hidden).toBe(true);
    o.el.remove();
  });
  it("Dismiss tells the reader to stop and hides the window", () => {
    const onDismiss = vi.fn(), o = new CalibrationOverlay(onDismiss);
    o.render({ cam: "B", phase: "running", label: "Looking for the board…", progress: 0 });
    o.el.querySelector("button")!.click();
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(o.el.hidden).toBe(true);
    o.el.remove();
  });
});
