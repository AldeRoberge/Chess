import { withIcon, setLabel } from "./icons";
import type { CalibrationView } from "../vision/autoCalibrate";

/** Quiet, opt-in calibration notification in the top menu. */
export class CalibrationOverlay {
  readonly el: HTMLDivElement;
  private last = "";
  private title = document.createElement("strong");
  private label = document.createElement("span");
  private bar = document.createElement("div");
  private fill = document.createElement("i");
  private accept = document.createElement("button");
  private dismiss = document.createElement("button");
  constructor(onDismiss: () => void, parent: HTMLElement = document.body, onAccept: () => void = () => {}) {
    this.el = document.createElement("div"); this.el.className = "cal-notification";
    this.el.setAttribute("role", "status"); this.el.hidden = true;
    this.title.className = "cal-title"; this.label.className = "cal-label";
    this.bar.className = "cal-bar"; this.bar.append(this.fill);
    this.accept.type = this.dismiss.type = "button";
    this.accept.className = "cal-accept"; this.accept.textContent = "\u{1f4a1}";
    this.accept.title = "Do you want to auto calibrate";
    this.accept.setAttribute("aria-label", this.accept.title);
    this.accept.onclick = () => { this.accept.disabled = true; onAccept(); };
    this.dismiss.className = "qe-btn"; withIcon(this.dismiss, "x");
    this.dismiss.onclick = () => { onDismiss(); this.render(null); };
    this.el.append(this.accept, this.title, this.label, this.bar, this.dismiss); parent.append(this.el);
  }
  render(v: CalibrationView | null) {
    const key = v ? `${v.cam}|${v.phase}|${v.label}|${Math.round(v.progress * 100)}` : "";
    if (key === this.last) return;
    this.last = key; this.el.hidden = !v;
    if (!v) return;
    this.el.dataset.phase = v.phase;
    this.accept.hidden = v.phase !== "suggested"; this.accept.disabled = false;
    this.title.textContent = v.phase === "suggested" ? "Do you want to auto calibrate" : v.phase === "running" ? "Calibration in progress..." : v.phase === "done" ? "Calibration finished" : "Calibration failed";
    this.label.textContent = `Camera ${v.cam}: ${v.label}`; this.label.hidden = v.phase === "suggested";
    this.bar.hidden = v.phase !== "running";
    this.fill.style.width = `${Math.round(Math.max(0, Math.min(1, v.progress)) * 100)}%`;
    setLabel(this.dismiss, v.phase === "suggested" || v.phase === "running" ? "Dismiss" : "Close");
  }
}
