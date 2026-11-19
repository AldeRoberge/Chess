import type { CalibrationView } from "../vision/autoCalibrate";

/**
 * The "Calibration in progress..." window. A board reader that lost the board publishes what it is doing on the bus;
 * this shows it, with a progress bar and a Dismiss button, and goes away when the reader clears it.
 */
export class CalibrationOverlay {
  readonly el: HTMLDivElement;
  private title: HTMLElement; private label: HTMLElement; private fill: HTMLElement; private btn: HTMLButtonElement;
  private last = "";
  constructor(onDismiss: () => void, parent: HTMLElement = document.body) {
    const el = this.el = document.createElement("div");
    el.className = "cal-win"; el.setAttribute("role", "dialog"); el.setAttribute("aria-live", "polite"); el.hidden = true;
    this.title = document.createElement("strong"); this.title.className = "cal-title";
    this.label = document.createElement("span"); this.label.className = "cal-label";
    const bar = document.createElement("div"); bar.className = "cal-bar"; this.fill = document.createElement("i"); bar.append(this.fill);
    this.btn = document.createElement("button"); this.btn.type = "button"; this.btn.className = "qe-btn"; this.btn.textContent = "Dismiss";
    this.btn.title = "Stop calibrating. It will not start again on its own until the board reads well.";
    this.btn.onclick = () => { onDismiss(); this.render(null); };
    el.append(this.title, this.label, bar, this.btn);
    parent.append(el);
  }
  /** Call every frame with the bus value; only touches the DOM when something changed. */
  render(v: CalibrationView | null) {
    const key = v ? `${v.phase}|${v.label}|${Math.round(v.progress * 100)}|${v.cam}` : "";
    if (key === this.last) return;
    this.last = key;
    this.el.hidden = !v;
    if (!v) return;
    this.el.dataset.phase = v.phase;
    this.title.textContent = v.phase === "running" ? "Calibration in progress..." : v.phase === "done" ? "Calibration finished" : "Calibration failed";
    this.label.textContent = `Camera ${v.cam}: ${v.label}`;
    this.fill.style.width = `${Math.round(Math.max(0, Math.min(1, v.progress)) * 100)}%`;
    this.btn.textContent = v.phase === "running" ? "Dismiss" : "Close";
  }
}
