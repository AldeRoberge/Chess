/** A small panel under a button that explains a slow job. It only appears once the job has run for `delayMs`, so quick runs stay quiet. */
export class AlignProgressPanel {
  private el: HTMLElement | null = null; private timer = 0; private last: { done: number; total: number; fraction: number; label: string; running: number; waiting: number } | null = null;
  constructor(private anchor: HTMLElement, private delayMs = 900) {}

  start() { this.stop(); this.last = null; this.timer = window.setTimeout(() => { this.timer = 0; this.show(); }, this.delayMs); }

  update(done: number, total: number, info: { fraction: number; label: string; running: number; waiting: number }) {
    this.last = { done, total, ...info };
    if (this.el) this.render();
  }

  stop() {
    if (this.timer) { clearTimeout(this.timer); this.timer = 0; }
    this.el?.remove(); this.el = null;
  }

  private show() {
    const el = document.createElement("div");
    el.className = "alignprog"; el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite");
    el.innerHTML = `<b>Aligning your boards</b><p class="ap-what"></p><div class="ap-bar"><i></i></div><p class="ap-sub"></p><p class="ap-note">Each camera picture is searched for the board's square edges, then lined up with them. Several boards run at once, so this can take a few seconds. You can keep using the app.</p>`;
    document.body.appendChild(el); this.el = el;
    const r = this.anchor.getBoundingClientRect();
    el.style.top = `${r.bottom + 6}px`;
    el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - el.offsetWidth - 8))}px`;
    this.render();
  }

  private render() {
    const el = this.el, s = this.last; if (!el) return;
    el.querySelector<HTMLElement>(".ap-what")!.textContent = s?.label || "Starting…";
    el.querySelector<HTMLElement>(".ap-bar i")!.style.width = `${Math.round((s?.fraction ?? 0) * 100)}%`;
    el.querySelector<HTMLElement>(".ap-sub")!.textContent = s
      ? `${s.done} of ${s.total} board${s.total === 1 ? "" : "s"} done · ${s.running} working${s.waiting ? `, ${s.waiting} waiting` : ""}`
      : "";
  }
}
