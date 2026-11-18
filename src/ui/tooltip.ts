/**
 * Tooltips: one floating card, driven by delegated hover / focus, so any element can opt in without wiring.
 *
 * Declare in markup:  data-tip="Title"  data-tip-body="..."  data-tip-tag="Category"  data-tip-color="#5cc8ff"
 *                     data-tip-keys="Esc,B"  data-tip-hint="..."  data-tip-rows="Label:Value|Label:Value:0.8"
 *                     (a third rows part, 0..1, draws a meter; values cannot contain ":" or "|")
 * Or compute lazily: tooltips.add((el) => Tip | null). Resolvers see every ancestor of the hovered element,
 * innermost first, so a pin wins over its node. Plain `title` attributes are adopted (and silenced) automatically.
 * Open cards re-resolve every 250 ms, so live values (fidelity, latency, signals) tick while you read them.
 */
export interface TipRow { label: string; value: string; bar?: number; tone?: "ok" | "warn" | "bad" }
/** What a signal is carrying right now: a camera image and/or a short list of fields. */
export interface TipPreview { frame?: { width: number; height: number; data: ArrayLike<number> }; items?: [string, string][]; more?: number }
/** An empty title means "describe the element under the pointer": the element is highlighted instead of named. */
export interface Tip { title: string; body?: string; tag?: string; color?: string; rows?: TipRow[]; keys?: string[]; hint?: string; preview?: TipPreview | null }
export type TipResolver = (el: Element) => Tip | null;

export const SHOW_DELAY = 380;
const WARM_MS = 260;
const LIVE_MS = 250;
const MARGIN = 8;

export function parseTip(el: HTMLElement): Tip | null {
  const d = el.dataset;
  if (!d.tip) return null;
  const rows = d.tipRows?.split("|").map((r) => {
    const [label, value = "", bar] = r.split(":");
    const b = bar === undefined ? NaN : Number(bar);
    return { label, value, bar: Number.isNaN(b) ? undefined : b };
  });
  return { title: d.tip, body: d.tipBody, tag: d.tipTag, color: d.tipColor, rows, keys: d.tipKeys?.split(","), hint: d.tipHint };
}

const KIND: Record<string, string> = { button: "button", select: "menu", textarea: "text", a: "link", summary: "toggle" };
/** Every control gets a card: its aria-label, placeholder or visible text, so nothing is silent. */
export function fallbackTip(e: HTMLElement): Tip | null {
  const tag = e.tagName.toLowerCase(), type = (e as HTMLInputElement).type;
  const control = tag in KIND || tag === "input" || e.getAttribute("role") === "button" || e.getAttribute("role") === "tab";
  if (!control) return null;
  const kind = tag === "input" ? (type === "checkbox" ? "checkbox" : type === "range" ? "slider" : "field") : KIND[tag] ?? "button";
  const name = e.getAttribute("aria-label") || (e as HTMLInputElement).placeholder || (e.textContent ?? "").replace(/\s+/g, " ").trim() || e.closest("label")?.textContent?.trim();
  if (!name || name.length > 60) return null;
  return { title: name, tag: kind };
}

export interface Box { x: number; y: number; w: number; h: number }

/** Below the anchor if it fits, otherwise above; always clamped inside the viewport. */
export function placeTip(a: Box, size: { w: number; h: number }, vp: { w: number; h: number }, align: "center" | "start", gap = 10) {
  let y = a.y + a.h + gap, side: "below" | "above" = "below";
  if (y + size.h > vp.h - MARGIN && a.y - gap - size.h >= MARGIN) { y = a.y - gap - size.h; side = "above"; }
  const x = align === "center" ? a.x + a.w / 2 - size.w / 2 : a.x;
  return { x: Math.max(MARGIN, Math.min(x, vp.w - size.w - MARGIN)), y: Math.max(MARGIN, y), side };
}

const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = "") => {
  const e = document.createElement(tag); e.className = cls; if (text) e.textContent = text; return e;
};

export class Tooltips {
  readonly el: HTMLElement;
  private resolvers: TipResolver[] = [];
  private src: Element | null = null;
  private pending: Element | null = null;
  private suppressed: Element | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private live: ReturnType<typeof setInterval> | undefined;
  private hiddenAt = -1e9;
  private px = 0;
  private py = 0;
  private follow = false;
  private raf = 0;
  private off: (() => void)[] = [];

  constructor(private doc: Document = document) {
    this.el = mk("div", "tip"); this.el.setAttribute("role", "tooltip"); this.el.id = "tip";
    doc.body.append(this.el);
    const on = (t: EventTarget, type: string, fn: (e: any) => void, cap = false) => { t.addEventListener(type, fn, cap); this.off.push(() => t.removeEventListener(type, fn, cap)); };
    on(doc, "pointerover", this.over);
    on(doc, "pointermove", (e: MouseEvent) => {
      this.px = e.clientX; this.py = e.clientY;
      if (!this.src) return;
      if (this.follow) this.place();
      if (this.src.hasAttribute("data-tip-live") && !this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.refresh(); }); // content depends on where the pointer is
    });
    on(doc, "pointerout", (e: MouseEvent) => { if (!e.relatedTarget) this.hide(); });
    on(doc, "pointerdown", () => this.dismiss(), true);
    on(doc, "wheel", () => this.hide(), true);
    on(doc, "scroll", () => this.hide(), true);
    on(doc, "keydown", (e: KeyboardEvent) => { if (e.key === "Escape") this.dismiss(); });
    on(doc, "focusin", this.focus);
    on(doc, "focusout", () => this.hide());
  }

  add(fn: TipResolver) { this.resolvers.push(fn); return this; }

  destroy() { this.hide(); this.off.forEach((f) => f()); this.off = []; this.el.remove(); }

  /** Innermost explicit tip wins; an element's generic fallback (its own name) only applies if no ancestor has a real one. */
  private find(from: EventTarget | null | undefined): { el: Element; tip: Tip } | null {
    let fallback: { el: Element; tip: Tip } | null = null;
    for (let e = from instanceof Element ? from : null; e && e !== this.doc.body && e !== this.doc.documentElement; e = e.parentElement) {
      if (e === this.el) return null;
      if (e instanceof HTMLElement && e.title && !e.dataset.tip) { e.dataset.tip = e.title; e.removeAttribute("title"); }
      let tip = e instanceof HTMLElement ? parseTip(e) : null;
      for (let i = 0; !tip && i < this.resolvers.length; i++) tip = this.resolvers[i](e);
      if (tip) return { el: e, tip };
      if (!fallback && e instanceof HTMLElement) { const t = fallbackTip(e); if (t) fallback = { el: e, tip: t }; }
    }
    return fallback;
  }

  private over = (ev: Event) => {
    const f = this.find(ev.target);
    if (!f) { this.suppressed = null; this.hide(); return; }
    if (f.el === this.src || f.el === this.pending || f.el === this.suppressed) return;
    this.suppressed = null;
    clearTimeout(this.timer);
    this.pending = f.el;
    if (this.src || Date.now() - this.hiddenAt < WARM_MS || f.el.hasAttribute("data-tip-live")) this.show(f.el, f.tip);
    else this.timer = setTimeout(() => this.show(f.el, f.tip), SHOW_DELAY);
  };

  private focus = (ev: Event) => {
    const t = ev.target as Element;
    let visible = true;
    try { visible = t.matches(":focus-visible"); } catch { /* old engines: treat as keyboard focus */ }
    const f = visible ? this.find(t) : null;
    if (f) this.show(f.el, f.tip);
  };

  private show(el: Element, tip: Tip) {
    this.hide(true);
    this.setSrc(el); this.pending = null;
    const r = el.getBoundingClientRect();
    this.follow = r.width > 240 || r.height > 90 || el.hasAttribute("data-tip-live");
    this.render(tip);
    this.place();
    this.el.classList.add("on");
    el.setAttribute("aria-describedby", "tip");
    this.live = setInterval(() => this.refresh(), LIVE_MS);
  }

  private refresh() {
    if (!this.src) return;
    const at = this.src.isConnected ? this.src : (this.doc.elementFromPoint?.(this.px, this.py) ?? null);
    const f = this.find(at);
    if (!f) { this.hide(); return; }
    if (f.el !== this.src) this.setSrc(f.el);
    this.render(f.tip);
    this.place();
  }

  private render(t: Tip) {
    const head = mk("div", "tip-head");
    const dot = mk("span", "tip-dot"); if (t.color) { dot.style.background = t.color; dot.style.setProperty("--c", t.color); }
    // An empty title means the card describes the element under the pointer, which is already highlighted.
    head.append(dot);
    if (t.title) head.append(mk("span", "tip-title", t.title));
    if (t.tag) head.append(mk("span", "tip-tag", t.tag));
    const kids: HTMLElement[] = [head];
    if (t.body) kids.push(mk("p", "tip-body", t.body));
    if (t.rows?.length) {
      const g = mk("div", "tip-rows");
      for (const r of t.rows) {
        g.append(mk("span", "tip-k", r.label));
        const v = mk("span", "tip-v" + (r.tone ? " " + r.tone : ""), r.value);
        if (r.bar !== undefined) {
          const bar = mk("i", "tip-bar"), fill = document.createElement("b");
          fill.style.width = Math.round(Math.max(0, Math.min(1, r.bar)) * 100) + "%"; bar.append(fill); v.append(bar);
        }
        g.append(v);
      }
      kids.push(g);
    }
    if (t.preview) kids.push(this.renderPreview(t.preview));
    if (t.keys?.length || t.hint) {
      const foot = mk("div", "tip-foot");
      for (const k of t.keys ?? []) foot.append(mk("kbd", "", k));
      if (t.hint) foot.append(mk("span", "tip-hint", t.hint));
      kids.push(foot);
    }
    this.el.replaceChildren(...kids);
  }

  private renderPreview(p: TipPreview) {
    const box = mk("div", "tip-prev");
    const f = p.frame;
    if (f && f.width > 0 && f.height > 0 && f.data.length >= f.width * f.height) {
      const c = document.createElement("canvas"); c.className = "tip-img"; c.width = f.width; c.height = f.height;
      c.style.aspectRatio = `${f.width} / ${f.height}`;
      try {
        const ctx = c.getContext("2d");
        if (ctx) {
          const img = ctx.createImageData(f.width, f.height);
          for (let i = 0, n = f.width * f.height; i < n; i++) { const v = f.data[i]; img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
          ctx.putImageData(img, 0, 0);
        }
      } catch { /* no canvas (tests): the card still shows its size */ }
      box.append(c);
    }
    if (p.items?.length) {
      const g = mk("div", "tip-items");
      for (const [k, v] of p.items) g.append(mk("span", "tip-ik", k), mk("span", "tip-iv", v));
      box.append(g);
    }
    if (p.more) box.append(mk("div", "tip-more", `+ ${p.more} more`));
    return box;
  }

  private place() {
    if (!this.src) return;
    const win = this.doc.defaultView!;
    const size = { w: this.el.offsetWidth, h: this.el.offsetHeight };
    const r = this.src.getBoundingClientRect();
    const a: Box = this.follow ? { x: this.px + 14, y: this.py + 6, w: 0, h: 14 } : { x: r.left, y: r.top, w: r.width, h: r.height };
    const p = placeTip(a, size, { w: win.innerWidth, h: win.innerHeight }, this.follow ? "start" : "center");
    this.el.style.transform = `translate(${Math.round(p.x)}px,${Math.round(p.y)}px)`;
    this.el.dataset.side = p.side;
  }

  /** Hide and stay hidden until the pointer leaves this element (used on click / drag / Esc). */
  private dismiss() { this.suppressed = this.src ?? this.pending; this.hide(); }

  /** Moves the open card (and the subtle highlight behind it) to a new source element. */
  private setSrc(el: Element | null) {
    this.src?.classList.remove("tip-src");
    this.src = el;
    el?.classList.add("tip-src");
  }

  private hide(quiet = false) {
    clearTimeout(this.timer); clearInterval(this.live);
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    this.pending = null;
    if (this.src) { this.src.removeAttribute("aria-describedby"); this.setSrc(null); if (!quiet) this.hiddenAt = Date.now(); }
    this.el.classList.remove("on");
  }
}

let current: Tooltips | null = null;
/** Installs the single document-wide tooltip (replacing any earlier one, e.g. across test boots). */
export function installTooltips(doc: Document = document): Tooltips {
  current?.destroy();
  return (current = new Tooltips(doc));
}
