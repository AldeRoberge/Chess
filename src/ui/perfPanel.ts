import type { Graph } from "../core/graph";
import { icon, setLabel, withIcon } from "./icons";
import { loadPrefs, patchPrefs } from "../setup/prefs";
import { aggregateBoxes, delta, frameBoxes, hueOf, panView, percentile, profiler, slowestFrame, toTrace, zoomView, type FlameBox, type FrameRecord, type View } from "../core/profiler";
import { CAT_COLOR } from "./editor";
import type { Tip } from "./tooltip";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
const ms = (v: number) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)) + " ms";
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const ROW = 28; // flamegraph row pitch in CSS px; the filled bar is ROW - 3 tall
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** A rounded card with a title row; `tools` sit on the right of the title. */
const card = (title: string, tools: HTMLElement | null, ...body: HTMLElement[]) => {
  const c = el("section", "perf-card"), h = el("header", "perf-card-h");
  h.append(el("h3", "", title)); if (tools) h.append(tools);
  c.append(h, ...body);
  return c;
};
/** Small stroke icons for the flamegraph toolbar (24x24 grid). */
const svgIcon = (body: string) => `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON = {
  zoomIn: svgIcon('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M11 8v6M8 11h6"/>'),
  zoomOut: svgIcon('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6"/>'),
  left: svgIcon('<path d="M15 6l-6 6 6 6"/>'),
  right: svgIcon('<path d="M9 6l6 6-6 6"/>'),
  fit: svgIcon('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
};
const DETAIL = [["Overview", 0], ["Nodes", 1], ["Lines", 99]] as const;
type SortKey = "name" | "avg" | "p95" | "max" | "last";

export interface PerfHooks {
  reveal(id: string): void;
  setHeat(on: boolean): void;
  heatOn(): boolean;
}

/** Performance tab: KPIs, frame timeline, flamegraph (one frame or the whole window) and a per-node cost table. */
export class PerfPanel {
  root = el("div", "panel perf");
  private kpis = el("div", "perf-kpis");
  private timeline = el("canvas", "perf-timeline");
  private flame = el("canvas", "perf-flame");
  private crumb = el("div", "perf-crumb");
  private tip = el("div", "perf-tip");
  private table = el("div", "perf-table");
  private search = el("input");
  private pauseBtn = withIcon(el("button", "", "Pause"), "pause", 14);
  private mode: "frame" | "window" = "window";
  private depth = 1;
  private selected: number | null = null; // index into profiler.frames while pinned
  /** Visible window over the graph's width (fractions), plus the box last zoomed to for the crumb. */
  private view: View = { a: 0, w: 1 };
  private focusPath = "";
  private anim = 0; // requestAnimationFrame id of a running glide, 0 when idle
  private drag: { x: number; a: number; id: number; moved: boolean; mini: boolean } | null = null;
  private over: FlameBox | null = null; // box under the pointer, outlined
  private crumbText = el("span");
  private crumbPath = el("span", "perf-crumb-path");
  private mini = el("canvas", "perf-mini");
  private status = el("span", "perf-status");
  private modeSeg: HTMLElement | null = null;
  private hits: { x: number; y: number; w: number; box: FlameBox }[] = [];
  private tlHits: { x: number; w: number; i: number }[] = [];
  private tlOver = -1; // frame index under the pointer on the timeline
  private sort: SortKey = "avg";
  private desc = true;
  /** User-resized column widths in px (empty = automatic layout). Drag a header edge; double-click to reset. */
  private colW: number[] = [];
  private open = new Set<string>();
  private lastDraw = 0;
  private lastTable = -Infinity;
  private boxes: FlameBox[] = [];
  private total = 1;
  private base: Map<string, number> | null = null;
  private baseTick = 0;
  private baseBtn = withIcon(el("button", "", "Set baseline"), "flag", 14);

  constructor(private graph: Graph, private hooks: PerfHooks) {
    const bar = el("div", "perf-actions");
    this.pauseBtn.onclick = () => { profiler.paused = !profiler.paused; setLabel(this.pauseBtn, profiler.paused ? "Resume" : "Pause"); this.pauseBtn.querySelector(".ic")!.outerHTML = icon(profiler.paused ? "play" : "pause", 14); this.pauseBtn.classList.toggle("on", profiler.paused); this.draw(true); };
    const clear = withIcon(el("button", "", "Clear"), "trash", 14); clear.onclick = () => { profiler.reset(); this.selected = null; this.resetView(); this.draw(true); };
    const worst = withIcon(el("button", "", "Slowest frame"), "bolt", 14); worst.title = "Pin the slowest captured frame";
    worst.onclick = () => { const i = slowestFrame(profiler.frames); if (i < 0) return; this.selected = i; this.mode = "frame"; this.resetView(); if (!profiler.paused) this.pauseBtn.click(); this.syncModeButtons(); this.draw(true); };
    const save = withIcon(el("button", "", "Export trace"), "export", 14); save.title = "Download the capture as Chrome trace JSON (Perfetto, chrome://tracing)";
    save.onclick = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(toTrace(profiler.frames))], { type: "application/json" })); a.download = "chess-experience-trace.json"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
    this.baseBtn.title = "Remember today's per-node averages, then compare after a change";
    this.baseBtn.onclick = () => {
      if (this.base) { this.base = null; } else {
        this.base = new Map(); this.baseTick = 0;
        for (const id of graph.nodes.keys()) { const s = profiler.summarize(id); if (s) { this.base.set(id, s.avg); this.baseTick += s.avg; } }
      }
      setLabel(this.baseBtn, this.base ? "Clear baseline" : "Set baseline"); this.baseBtn.classList.toggle("on", !!this.base); this.draw(true);
    };
    const bud = el("label", "perf-budget"); const bi = el("input"); bi.type = "number"; bi.min = "0"; bi.step = "0.5";
    profiler.budget = Math.max(0, loadPrefs().perfBudget ?? 0); bi.value = String(profiler.budget);
    bi.title = "Flag nodes whose average tick cost is above this many ms (0 = off)";
    bi.onchange = () => { profiler.budget = Math.max(0, Number(bi.value) || 0); patchPrefs({ perfBudget: profiler.budget }); this.draw(true); };
    bud.append(document.createTextNode("Node budget"), bi, document.createTextNode("ms"));
    const heat = el("label", "chk"); const hc = el("input"); hc.type = "checkbox"; hc.checked = hooks.heatOn(); hc.onchange = () => hooks.setHeat(hc.checked); heat.append(hc, document.createTextNode("Timings on nodes"));
    const seg = (items: readonly (readonly [string, string | number])[], get: () => string | number, set: (v: any) => void) => {
      const g = el("div", "seg");
      for (const [label, v] of items) { const b = withIcon(el("button", "", label), "gauge", 14); b.onclick = () => { set(v); for (const x of g.children) x.classList.toggle("on", x === b); }; b.classList.toggle("on", get() === v); g.append(b); }
      return g;
    };
    bar.append(this.pauseBtn, clear, worst, save, this.baseBtn, bud, heat);
    const modeSeg = seg([["Window", "window"], ["Frame", "frame"]], () => this.mode, (v) => { this.mode = v; this.resetView(); this.draw(true); });
    modeSeg.dataset.role = "mode";
    const depthSeg = seg(DETAIL.map(([l, d]) => [l, d] as const), () => this.depth, (v) => { this.depth = v; this.resetView(); this.draw(true); });
    const head = el("div", "perf-head"), title = el("div", "perf-title");
    title.append(el("h2", "", "Performance"), this.status);
    head.append(title, bar);

    this.tip.hidden = true;
    this.flame.tabIndex = 0;
    this.flame.setAttribute("role", "img");
    this.flame.setAttribute("aria-label", "Flamegraph. Wheel to zoom, drag to pan, click a box to focus it, double-click to show everything. Plus, minus, zero and arrow keys also work.");
    const zb = (label: string, svg: string, act: () => void) => { const b = el("button"); b.type = "button"; b.title = label; b.setAttribute("aria-label", label); b.innerHTML = svg; b.onclick = act; return b; };
    const zbar = el("div", "perf-zbar");
    zbar.append(
      zb("Zoom in (+)", ICON.zoomIn, () => this.zoomBy(0.5)),
      zb("Zoom out (−)", ICON.zoomOut, () => this.zoomBy(2)),
      zb("Pan left (←)", ICON.left, () => this.panBy(-0.25)),
      zb("Pan right (→)", ICON.right, () => this.panBy(0.25)),
      zb("Show everything (0)", ICON.fit, () => this.showAll()),
    );
    const crumbRow = el("div", "perf-frow");
    this.crumb.append(this.crumbText, this.crumbPath);
    crumbRow.append(this.crumb, zbar);
    const flameWrap = el("div", "perf-flame-wrap"); flameWrap.append(this.flame, this.tip, this.mini);
    this.search.type = "search"; this.search.placeholder = "Filter nodes…"; this.search.className = "perf-search";
    this.search.oninput = () => this.drawTable(true);
    const flameTools = el("div", "perf-card-tools"); flameTools.append(modeSeg, depthSeg, zbar);
    const flameCard = card("Flamegraph", flameTools, crumbRow, flameWrap);
    const nodesCard = card("Nodes", this.search, this.table);
    this.root.append(head, this.kpis, card("Frame timeline", null, this.timeline), flameCard, nodesCard);
    this.modeSeg = modeSeg;

    this.timeline.onclick = (e) => {
      const r = this.timeline.getBoundingClientRect(), x = e.clientX - r.left;
      const hit = this.tlHits.find((t) => x >= t.x && x < t.x + t.w);
      if (!hit) return;
      this.selected = this.selected === hit.i ? null : hit.i; this.mode = this.selected === null ? "window" : "frame"; this.resetView();
      if (this.selected !== null && !profiler.paused) this.pauseBtn.click();
      this.syncModeButtons(); this.draw(true);
    };
    this.timeline.dataset.tipLive = "1";
    this.timeline.onmousemove = (e) => { const x = e.clientX - this.timeline.getBoundingClientRect().left; const i = this.tlHits.find((t) => x >= t.x && x < t.x + t.w)?.i ?? -1; if (i !== this.tlOver) { this.tlOver = i; this.drawTimeline(); } };
    this.timeline.onmouseleave = () => { this.tlOver = -1; this.drawTimeline(); };
    // Flamegraph: wheel zooms at the pointer, shift-wheel or a sideways trackpad pans, drag pans, a click (no drag) zooms to the box.
    this.flame.addEventListener("wheel", (e) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.flame.clientWidth : 1;
      const dx = e.deltaX * unit, dy = e.deltaY * unit;
      this.stopAnim();
      if (e.shiftKey || Math.abs(dx) > Math.abs(dy)) {
        const d = e.shiftKey && !dx ? dy : dx;
        this.view = panView(this.view, d / this.flame.clientWidth); // pixels across the canvas, as a share of the visible window
      } else {
        const r = this.flame.getBoundingClientRect();
        this.view = zoomView(this.view, Math.exp(dy * 0.0015), clamp((e.clientX - r.left) / r.width, 0, 1));
      }
      this.paint();
    }, { passive: false });
    this.flame.onpointerdown = (e) => {
      if (e.button !== 0) return;
      this.flame.focus(); this.stopAnim();
      this.flame.setPointerCapture(e.pointerId);
      this.drag = { x: e.clientX, a: this.view.a, id: e.pointerId, moved: false, mini: false };
    };
    this.flame.onpointermove = (e) => {
      const d = this.drag;
      if (!d || d.mini) { this.hover(e); return; }
      const dx = e.clientX - d.x;
      if (!d.moved && Math.abs(dx) < 4) return;
      if (!d.moved) { d.moved = true; this.flame.classList.add("drag"); this.tip.hidden = true; }
      this.view.a = clamp(d.a - (dx / this.flame.clientWidth) * this.view.w, 0, 1 - this.view.w);
      this.paint();
    };
    this.flame.onpointerup = (e) => {
      const d = this.drag; this.drag = null; this.flame.classList.remove("drag");
      if (!d || d.moved) return;
      const h = this.pick(e);
      if (h) this.zoomTo(h.box);
    };
    this.flame.onpointercancel = () => { this.drag = null; this.flame.classList.remove("drag"); };
    this.flame.onpointerleave = () => { if (this.drag) return; this.tip.hidden = true; if (this.over) { this.over = null; this.drawFlame(); } };
    this.flame.onkeydown = (e) => {
      if (e.key === "+" || e.key === "=") this.zoomBy(0.5);
      else if (e.key === "-" || e.key === "_") this.zoomBy(2);
      else if (e.key === "ArrowLeft") this.panBy(-0.2);
      else if (e.key === "ArrowRight") this.panBy(0.2);
      else if (e.key === "0" || e.key === "Escape") this.showAll();
      else return;
      e.preventDefault();
    };
    this.flame.ondblclick = () => this.showAll();
    // Minimap: press anywhere to centre the view there, then drag.
    const miniTo = (e: PointerEvent) => {
      const r = this.mini.getBoundingClientRect();
      this.view.a = clamp((e.clientX - r.left) / r.width - this.view.w / 2, 0, 1 - this.view.w);
      this.paint();
    };
    this.mini.onpointerdown = (e) => { this.stopAnim(); this.mini.setPointerCapture(e.pointerId); this.drag = { x: e.clientX, a: this.view.a, id: e.pointerId, moved: true, mini: true }; miniTo(e); };
    this.mini.onpointermove = (e) => { if (this.drag?.mini) miniTo(e); };
    this.mini.onpointerup = () => { this.drag = null; };
    this.mini.onpointercancel = () => { this.drag = null; };
    this.table.addEventListener("pointerdown", (e) => {
      const h = (e.target as HTMLElement).closest<HTMLElement>(".rz");
      if (!h) return;
      e.preventDefault(); e.stopPropagation();
      const ths = [...this.table.querySelectorAll<HTMLElement>("thead th")], i = ths.indexOf(h.parentElement as HTMLElement);
      if (i < 0) return;
      if (this.colW.length !== ths.length) this.colW = ths.map((c) => Math.round(c.getBoundingClientRect().width));
      const x0 = e.clientX, w0 = this.colW[i];
      h.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        this.colW[i] = Math.max(36, Math.round(w0 + ev.clientX - x0));
        this.drawTable(true);
        this.table.querySelectorAll<HTMLElement>(".rz")[i]?.classList.add("on");
      };
      const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); this.table.querySelectorAll(".rz.on").forEach((r) => r.classList.remove("on")); };
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    });
    this.table.addEventListener("dblclick", (e) => { if ((e.target as HTMLElement).closest(".rz")) { this.colW = []; this.drawTable(true); } });
    this.table.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".rz")) return;
      const t = e.target as HTMLElement, th = t.closest<HTMLElement>("th[data-s]"), row = t.closest<HTMLElement>("tr[data-id]");
      if (th) { const k = th.dataset.s as SortKey; if (this.sort === k) this.desc = !this.desc; else { this.sort = k; this.desc = k !== "name"; } this.drawTable(true); }
      else if (row) {
        const id = row.dataset.id!;
        if (t.closest(".perf-x")) { if (this.open.has(id)) this.open.delete(id); else this.open.add(id); this.drawTable(true); }
        else hooks.reveal(id);
      }
    });
  }

  /** Hover cards for the timeline bars and the node cost table. */
  tips = (e: Element): Tip | null => {
    if (e === this.timeline) {
      const f = this.frames()[this.tlOver];
      if (!f) return null;
      const top = new Map<string, number>();
      for (const sp of f.spans) if (sp.depth === 0) top.set(sp.name, (top.get(sp.name) ?? 0) + sp.dur);
      const parts = [...top].sort((a, b) => b[1] - a[1]).slice(0, 5), other = f.dur - [...top.values()].reduce((a, b) => a + b, 0);
      const fps = f.dur > 0 ? 1000 / f.dur : 0;
      return {
        title: `Frame ${this.tlOver + 1} of ${this.frames().length}`, tag: ms(f.dur), color: f.dur > 33.3 ? "#ff5a6e" : f.dur > 16.7 ? "#ffb340" : "#35e0b4",
        body: f.dur > 16.7 ? "This frame missed the 60 fps budget. The colours are the biggest sections of work in it." : "This frame was inside the 60 fps budget. The colours are the biggest sections of work in it.",
        rows: [{ label: "Cost", value: ms(f.dur), bar: Math.min(1, f.dur / 33.3), tone: f.dur > 33.3 ? "bad" : f.dur > 16.7 ? "warn" : "ok" }, { label: "Would run at", value: `${fps.toFixed(0)} fps` },
          ...parts.map(([n, d]) => ({ label: n, value: ms(d), bar: f.dur ? d / f.dur : 0 })), ...(other > 0.05 ? [{ label: "Everything else", value: ms(other), bar: f.dur ? other / f.dur : 0 }] : [])],
        hint: "Click to pin this frame in the flamegraph",
      };
    }
    const row = e instanceof HTMLElement ? e.closest<HTMLElement>("tr[data-id]") : null;
    if (row && e instanceof HTMLElement && this.table.contains(e)) {
      const n = this.graph.nodes.get(row.dataset.id ?? ""), spec = n && this.graph.registry.get(n.type), sm = n && profiler.summarize(n.id);
      if (!n || !spec) return null;
      const all = [...this.graph.nodes.keys()].reduce((a, id) => a + (profiler.summarize(id)?.avg ?? 0), 0) || 1;
      if (!sm) return { title: spec.title, tag: spec.category, color: CAT_COLOR[spec.category], body: "No timing captured for this node yet." };
      const over = profiler.budget > 0 && sm.avg > profiler.budget;
      return {
        title: spec.title, tag: spec.category, color: CAT_COLOR[spec.category],
        body: `Averaged over the last ${sm.samples} ticks. ${n.bypass ? "This node is bypassed, so it costs almost nothing. " : ""}${over ? `It is over your ${profiler.budget} ms budget.` : ""}`,
        rows: [{ label: "Average", value: ms(sm.avg), bar: Math.min(1, sm.avg / 66), tone: over ? "bad" : undefined }, { label: "Slowest 5%", value: ms(sm.p95) }, { label: "Worst", value: ms(sm.max) }, { label: "Last tick", value: ms(sm.last) },
          { label: "Share of graph", value: `${((sm.avg / all) * 100).toFixed(0)}%`, bar: sm.avg / all }],
        hint: "Click to find it on the canvas",
      };
    }
    return null;
  };

  private syncModeButtons() { this.modeSeg?.querySelectorAll("button").forEach((b, i) => b.classList.toggle("on", (i === 0) === (this.mode === "window"))); }

  private frames(): FrameRecord[] { return profiler.frames; }

  /** Called every animation frame while this tab is showing. */
  frame(now: number) {
    if (now - this.lastDraw > 250) { this.lastDraw = now; this.draw(false); }
  }

  private draw(force: boolean) {
    const cb = this.currentBoxes(); this.boxes = cb.boxes; this.total = cb.total;
    const n = this.frames().length;
    this.status.className = "perf-status" + (profiler.paused ? " paused" : profiler.enabled ? " live" : "");
    this.status.textContent = profiler.paused ? `Paused · ${n} frames` : profiler.enabled ? `Live · ${n} frames` : n ? `Stopped · ${n} frames` : "Idle";
    this.drawKpis();
    this.drawTimeline();
    this.paint();
    this.drawTable(force);
  }

  /** Cheap repaint of the flamegraph, minimap and crumb. Used by animation and panning, so it never re-lays out the capture. */
  private paint() { this.drawFlame(); this.drawMini(); this.updateCrumb(); }

  private stopAnim() { if (this.anim) { cancelAnimationFrame(this.anim); this.anim = 0; } }

  /** Glide the visible window to `to` over a short ease-out, so zooms and jumps feel continuous. */
  private go(to: View) {
    this.stopAnim();
    const from = { ...this.view }, t0 = performance.now(), dur = 280;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      this.view = { a: from.a + (to.a - from.a) * e, w: from.w + (to.w - from.w) * e };
      this.paint();
      this.anim = k < 1 ? requestAnimationFrame(step) : 0;
    };
    this.anim = requestAnimationFrame(step);
  }

  private zoomBy(factor: number, anchor = 0.5) { this.go(zoomView(this.view, factor, anchor)); }
  private panBy(frac: number) { this.go(panView(this.view, frac)); }

  /** Zoom so `b` fills the view, with a little margin on each side. */
  private zoomTo(b: FlameBox) {
    const span = this.total || 1, w0 = b.w / span, pad = 0.01;
    const w = clamp(w0 * (1 + 2 * pad), 1e-5, 1), a = clamp(b.x / span + w0 / 2 - w / 2, 0, 1 - w);
    this.focusPath = b.path;
    this.go({ a, w });
  }

  /** Back to the whole graph (animated). */
  private showAll() { this.focusPath = ""; this.go({ a: 0, w: 1 }); }

  /** Jump to the whole graph without animating; used when the mode or depth changes. */
  private resetView() { this.view = { a: 0, w: 1 }; this.focusPath = ""; }

  private smoothed = new Map<string, number>();

  private drawKpis() {
    const fr = this.frames(), n = fr.length, durs = fr.map((f) => f.dur);
    const span = n > 1 ? fr[n - 1].at - fr[Math.max(0, n - 61)].at : 0, count = Math.min(n - 1, 60);
    const fps = span > 0 ? (count / span) * 1000 : 0;
    // Exponential smoothing so the readouts glide instead of jumping on every redraw.
    const smooth = (key: string, v: number) => { const p = this.smoothed.get(key), r = p === undefined || !n ? v : p + (v - p) * 0.15; this.smoothed.set(key, r); return r; };
    const avg = smooth("avg", n ? durs.reduce((a, b) => a + b, 0) / n : 0), p95 = smooth("p95", percentile(durs, 0.95)), worst = smooth("worst", n ? Math.max(...durs) : 0);
    const long = durs.filter((d) => d > 16.7).length;
    let rawTick = 0; for (const s of this.graph.stats.values()) rawTick += s.ms;
    const tick = smooth("tick", rawTick);
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const WHAT: Record<string, string> = {
      "Frame rate": "How many screen frames per second the app draws. 60 is smooth; under 30 feels laggy.",
      "Frame cost": "Average time to produce one frame. It must stay under 16.7 ms to hold 60 fps.",
      "p95 frame": "95% of frames were faster than this. It shows the hiccups an average hides.",
      "Graph tick": "Time to run every node once. The graph runs at 15 Hz, so it has 66 ms before the next tick.",
      "Slow frames": "Share of captured frames that took longer than 16.7 ms (a missed 60 fps frame).",
      "JS heap": "Memory the page's JavaScript is using right now.",
    };
    const card = (label: string, value: string, sub: string, lvl = "") => `<div class="kpi ${lvl}" data-tip="${esc(label)}" data-tip-tag="${esc(value)}" data-tip-body="${esc(WHAT[label] ?? "")}" data-tip-hint="${esc(sub)}" data-tip-color="${lvl === "bad" ? "#ff5a6e" : lvl === "warn" ? "#ffb340" : "#35e0b4"}"><small>${label}</small><b>${value}</b><span>${sub}</span></div>`;
    this.kpis.innerHTML = [
      card("Frame rate", fps ? fps.toFixed(0) + " fps" : "—", n ? `${n} frames captured` : profiler.enabled ? "capturing…" : "idle", fps && fps < 30 ? "bad" : fps && fps < 50 ? "warn" : ""),
      card("Frame cost", ms(avg), `of 16.7 ms budget · ${((avg / 16.7) * 100).toFixed(0)}%`, avg > 16.7 ? "bad" : avg > 10 ? "warn" : ""),
      card("p95 frame", ms(p95), `worst ${ms(worst)}`, p95 > 33 ? "bad" : p95 > 16.7 ? "warn" : ""),
      card("Graph tick", ms(tick), `of 66 ms · ${((tick / 66) * 100).toFixed(0)}% · 15 Hz${this.base ? ` · ${delta(this.baseTick, tick).ms >= 0 ? "+" : ""}${delta(this.baseTick, tick).ms.toFixed(2)} vs base` : ""}`, tick > 66 ? "bad" : tick > 40 ? "warn" : ""),
      card("Slow frames", `${n ? Math.round((long / n) * 100) : 0}%`, `${long} over 16.7 ms`, long / Math.max(1, n) > 0.2 ? "warn" : ""),
      card("JS heap", mem ? (mem.usedJSHeapSize / 1048576).toFixed(0) + " MB" : "n/a", `${this.graph.nodes.size} nodes · ${this.graph.edges.length} wires`),
    ].join("");
  }

  private fit(c: HTMLCanvasElement, cssH: number) {
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth || 600;
    const bw = Math.round(w * dpr), bh = Math.round(cssH * dpr);
    if (c.width !== bw || c.height !== bh) { c.width = bw; c.height = bh; }
    if (c.style.height !== cssH + "px") c.style.height = cssH + "px"; // the glide repaints every frame; skip a no-op style write
    const g = c.getContext("2d")!; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g, w, h: cssH };
  }

  private drawTimeline() {
    const { g, w, h } = this.fit(this.timeline, 112);
    g.clearRect(0, 0, w, h);
    const fr = this.frames(), cap = profiler.maxFrames, bw = w / cap;
    const top = Math.max(33.4, percentile(fr.map((f) => f.dur), 0.98) * 1.15);
    const y = (v: number) => h - 12 - (Math.min(v, top) / top) * (h - 16);
    this.tlHits = [];
    fr.forEach((f, i) => {
      const x = (cap - fr.length + i) * bw;
      this.tlHits.push({ x, w: bw, i });
      // stack the depth-0 sections, remainder grey
      let acc = 0;
      for (const s of f.spans) {
        if (s.depth !== 0) continue;
        g.fillStyle = `hsl(${hueOf(s.name)} 55% 52%)`;
        g.fillRect(x, y(acc + s.dur), Math.max(1, bw - 0.5), y(acc) - y(acc + s.dur)); acc += s.dur;
      }
      if (f.dur > acc) { g.fillStyle = "#4a5568"; g.fillRect(x, y(f.dur), Math.max(1, bw - 0.5), y(acc) - y(f.dur)); }
      if (this.tlOver === i) { g.fillStyle = "rgba(255,255,255,.18)"; g.fillRect(x - 1, 2, bw + 2, h - 14); }
      if (this.selected === i) { g.strokeStyle = "#fff"; g.lineWidth = 1.5; g.strokeRect(x - 0.5, 2, bw + 1, h - 14); }
    });
    g.font = "12px IBM Plex Mono, monospace"; g.textBaseline = "bottom";
    for (const [v, c] of [[16.7, "#35e0b4"], [33.3, "#ffb340"]] as const) {
      if (v > top) continue;
      g.strokeStyle = c; g.globalAlpha = 0.5; g.setLineDash([3, 4]); g.beginPath(); g.moveTo(0, y(v)); g.lineTo(w, y(v)); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
      g.fillStyle = c; g.fillText(v === 16.7 ? "60 fps" : "30 fps", 4, y(v) - 1);
    }
    g.fillStyle = "#8aa0b8"; g.textBaseline = "alphabetic"; g.fillText(fr.length ? `click a bar to inspect that frame · scale 0–${top.toFixed(0)} ms` : "no frames yet", 4, h - 1);
  }

  /** Flamegraph layout, cached until the capture changes (it is redrawn every 250 ms, the capture only grows once per frame). */
  private boxCache: { key: string; out: { boxes: FlameBox[]; total: number } } | null = null;
  private currentBoxes(): { boxes: FlameBox[]; total: number } {
    const fr = this.frames();
    if (!fr.length) return { boxes: [], total: 1 };
    const key = `${this.mode}|${this.selected}|${profiler.version}`;
    if (this.boxCache?.key === key) return this.boxCache.out;
    let out: { boxes: FlameBox[]; total: number };
    if (this.mode === "frame") {
      const f = this.selected !== null ? fr[this.selected] : fr[slowestFrame(fr)];
      out = f ? { boxes: frameBoxes(f), total: f.dur } : { boxes: [], total: 1 };
    } else {
      const boxes = aggregateBoxes(fr);
      out = { boxes, total: boxes.filter((b) => b.depth === 0).reduce((a, b) => a + b.w, 0) };
    }
    this.boxCache = { key, out };
    return out;
  }

  private drawFlame() {
    const vis = this.boxes.filter((b) => b.depth <= this.depth);
    const rows = vis.reduce((a, b) => Math.max(a, b.depth), 0) + 1;
    const { g, w, h } = this.fit(this.flame, Math.max(rows, 4) * ROW + 6); // keep a sensible minimum height while a capture is shallow or empty
    g.clearRect(0, 0, w, h);
    this.hits = [];
    // the visible window in ms: boxes outside it are culled, so zooming keeps the frame cheap
    const span = this.total || 1, x0 = this.view.a * span, vs = this.view.w * span;
    const q = this.search.value.trim().toLowerCase();
    g.font = "600 13px IBM Plex Mono, monospace"; g.textBaseline = "middle";
    const barH = ROW - 3, rr = (x: number, y: number, bw: number, bh: number) => { g.beginPath(); if (g.roundRect) g.roundRect(x, y, bw, bh, Math.min(4, bw / 2)); else g.rect(x, y, bw, bh); };
    for (const b of vis) {
      if (b.x + b.w < x0 || b.x > x0 + vs) continue;
      const x = ((b.x - x0) / vs) * w, bw = (b.w / vs) * w;
      if (bw < 0.6) continue;
      const y = b.depth * ROW + 1;
      const dim = q && !b.name.toLowerCase().includes(q);
      g.globalAlpha = dim ? 0.25 : 1;
      // light, fairly saturated bars with near-black text: roughly 7:1 contrast or better on every hue
      g.fillStyle = `hsl(${hueOf(b.node ? b.name.replace(/ preview$/, "") : b.name)} ${b.node ? 62 : 45}% ${b.node ? 68 : 72}%)`;
      rr(x, y, Math.max(0.6, bw - 1.5), barH); g.fill();
      if (bw > 44) {
        // labels stay readable when the box starts off-screen to the left
        const cx = Math.max(x, 0), cw = Math.min(x + bw, w) - cx - 10;
        g.fillStyle = "#06101d"; g.save(); g.beginPath(); g.rect(cx, y, cw + 4, barH); g.clip(); g.fillText(`${b.name}  ${ms(b.w)}`, cx + 7, y + barH / 2 + 0.5); g.restore();
      }
      if (b === this.over) { g.strokeStyle = "#fff"; g.lineWidth = 2; rr(x + 1, y + 1, Math.max(0.6, bw - 3.5), barH - 2); g.stroke(); }
      g.globalAlpha = 1;
      this.hits.push({ x, y: b.depth * ROW, w: bw, box: b });
    }
  }

  /** Overview strip: every top-level section, with the part of the graph currently in view bright and the rest dimmed. Drag it to pan. */
  private drawMini() {
    const { g, w, h } = this.fit(this.mini, 30);
    g.clearRect(0, 0, w, h);
    const span = this.total || 1;
    for (const b of this.boxes) {
      if (b.depth !== 0) continue;
      g.fillStyle = `hsl(${hueOf(b.name)} 50% 50%)`;
      g.fillRect((b.x / span) * w, 3, Math.max(0.6, (b.w / span) * w), h - 6);
    }
    const x = this.view.a * w, vw = this.view.w * w;
    g.fillStyle = "rgba(4,10,20,.6)"; g.fillRect(0, 0, x, h); g.fillRect(x + vw, 0, w - x - vw, h);
    g.strokeStyle = "#fff"; g.lineWidth = 1; g.strokeRect(x + 0.5, 0.5, Math.max(1, vw - 1), h - 1);
  }

  /** Crumb: what is pinned, the zoom factor and the visible range, or the controls hint when the whole graph is shown. */
  private updateCrumb() {
    const label = this.mode === "window" ? `${this.frames().length} frames merged · widths are total time` : this.selected !== null ? `frame ${this.selected + 1} of ${this.frames().length} (pinned)` : "slowest captured frame";
    const span = this.total || 1, zoom = 1 / this.view.w;
    const range = zoom > 1.001 ? ` · ×${zoom >= 10 ? zoom.toFixed(0) : zoom.toFixed(1)} · ${ms(this.view.a * span)} – ${ms((this.view.a + this.view.w) * span)}` : " · wheel to zoom, drag to pan, click a box to focus";
    // Called on every glide frame: write each text only when it changed.
    const text = label + range, path = this.focusPath ? ` › ${this.focusPath.split("/").join(" › ")}` : "";
    if (this.crumbText.textContent !== text) this.crumbText.textContent = text;
    if (this.crumbPath.textContent !== path) this.crumbPath.textContent = path;
  }

  private pick(e: MouseEvent) {
    const r = this.flame.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    return this.hits.find((h) => x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + ROW);
  }

  private hover(e: MouseEvent) {
    const h = this.pick(e), b0 = h ? h.box : null;
    if (b0 !== this.over) { this.over = b0; this.drawFlame(); }
    if (!h) { this.tip.hidden = true; return; }
    const b = h.box, pct = this.total ? (b.w / this.total) * 100 : 0, n = Math.max(1, this.mode === "window" ? this.frames().length : 1);
    this.tip.innerHTML = `<b>${esc(b.name)}</b><span>${ms(b.w)} total · ${pct.toFixed(1)}%</span><span>${ms(b.self)} self</span><span>${b.calls} call${b.calls === 1 ? "" : "s"}${this.mode === "window" ? ` · ${ms(b.w / n)} per frame` : ""}</span><span class="perf-hint">click to zoom here</span>`;
    this.tip.hidden = false;
    const wr = this.flame.parentElement!.getBoundingClientRect();
    this.tip.style.left = Math.min(wr.width - 190, Math.max(0, e.clientX - wr.left + 12)) + "px";
    this.tip.style.top = e.clientY - wr.top + 14 + "px";
  }

  private drawTable(force: boolean) {
    const t = performance.now();
    if (!force && (t - this.lastTable < 600 || this.table.matches(":hover"))) return;
    this.lastTable = t;
    const q = this.search.value.trim().toLowerCase();
    const rows = [...this.graph.nodes.values()].map((n) => {
      const spec = this.graph.registry.get(n.type)!, s = profiler.summarize(n.id);
      return { id: n.id, title: spec.title, cat: spec.category, bypass: !!n.bypass, s };
    }).filter((r) => !q || r.title.toLowerCase().includes(q) || r.cat.toLowerCase().includes(q));
    const val = (r: (typeof rows)[number]) => (this.sort === "name" ? r.title : r.s ? r.s[this.sort] : -1);
    rows.sort((a, b) => { const x = val(a), y = val(b); const c = typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number); return this.desc ? -c : c; });
    const total = rows.reduce((a, r) => a + (r.s?.avg ?? 0), 0) || 1, top = Math.max(0.001, ...rows.map((r) => r.s?.avg ?? 0));
    const th = (k: SortKey, label: string) => `<th data-s="${k}" class="${this.sort === k ? "on" : ""}">${label}${this.sort === k ? (this.desc ? " ↓" : " ↑") : ""}</th>`;
    const body: string[] = [];
    for (const r of rows) {
      const s = r.s, share = s ? s.avg / total : 0, rel = s ? s.avg / top : 0, open = this.open.has(r.id);
      body.push(`<tr data-id="${esc(r.id)}" class="${r.bypass ? "byp" : ""}${profiler.budget > 0 && s && s.avg > profiler.budget ? " over" : ""}"><td class="n"><button class="perf-x" aria-label="Show lines">${open ? "▾" : "▸"}</button><i style="background:${CAT_COLOR[r.cat] ?? "#555"}"></i>${esc(r.title)}<small>${esc(r.id)}</small></td>`
        + `<td>${s ? s.avg.toFixed(2) : "–"}</td><td>${s ? s.p95.toFixed(2) : "–"}</td><td>${s ? s.max.toFixed(2) : "–"}</td><td>${s ? s.last.toFixed(2) : "–"}</td>`
        + `${this.deltaCell(r.id, s?.avg)}<td class="sh"><span class="bar"><i style="width:${(share * 100).toFixed(1)}%;background:hsl(${Math.round(130 - 130 * rel)} 70% 55%)"></i></span>${(share * 100).toFixed(0)}%</td><td class="sp">${this.spark(r.id)}</td></tr>`);
      if (open) body.push(this.lineRows(r.id));
    }
    const rz = '<span class="rz" aria-hidden="true"></span>';
    const ncols = this.base ? 8 : 7;
    if (this.colW.length !== ncols) this.colW = [];
    const fixed = this.colW.length === ncols;
    const cols = fixed ? `<colgroup>${this.colW.map((w) => `<col style="width:${w}px">`).join("")}</colgroup>` : "";
    const tstyle = fixed ? ` class="fixed" style="width:${this.colW.reduce((a, w) => a + w, 0)}px"` : "";
    this.table.innerHTML = `<table${tstyle}>${cols}<thead><tr>${th("name", "Node").replace("</th>", rz + "</th>")}${th("avg", "avg ms").replace("</th>", rz + "</th>")}${th("p95", "p95").replace("</th>", rz + "</th>")}${th("max", "max").replace("</th>", rz + "</th>")}${th("last", "last").replace("</th>", rz + "</th>")}${this.base ? `<th>Δ base${rz}</th>` : ""}<th>share${rz}</th><th>last 120 ticks${rz}</th></tr></thead><tbody>${body.join("") || `<tr><td colspan="8" class="empty">No nodes</td></tr>`}</tbody></table>`;
  }

  private deltaCell(id: string, avg: number | undefined) {
    if (!this.base) return "";
    const b = this.base.get(id);
    if (avg === undefined) return `<td class="d">–</td>`;
    if (b === undefined) return `<td class="d">new</td>`;
    const d = delta(b, avg), mark = Math.abs(d.ms) < 0.05 ? "" : d.ms > 0 ? " up" : " down";
    return `<td class="d${mark}">${d.ms >= 0 ? "+" : ""}${d.ms.toFixed(2)}${d.pct === null ? "" : ` (${d.pct >= 0 ? "+" : ""}${d.pct.toFixed(0)}%)`}</td>`;
  }

  private spark(id: string) {
    const v = profiler.series(id);
    if (v.length < 2) return "";
    const mx = Math.max(0.5, ...v), pts = v.map((x, i) => `${((i / 119) * 100).toFixed(1)},${(18 - (x / mx) * 16).toFixed(1)}`).join(" ");
    return `<svg viewBox="0 0 100 20" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.2" vector-effect="non-scaling-stroke"/></svg>`;
  }

  /** Line-by-line: every named inner span a node reported, averaged over the captured window. */
  private lineRows(id: string): string {
    const agg = new Map<string, { total: number; calls: number; frames: number }>();
    for (const f of this.frames()) {
      const seen = new Set<string>();
      for (const s of f.spans) {
        if (s.node !== id || s.depth < 2) continue;
        const a = agg.get(s.name) ?? { total: 0, calls: 0, frames: 0 };
        a.total += s.dur; a.calls++; if (!seen.has(s.name)) { seen.add(s.name); a.frames++; }
        agg.set(s.name, a);
      }
    }
    if (!agg.size) return `<tr class="lines"><td colspan="8">${profiler.enabled ? "No inner spans reported yet. Nodes can wrap work in <code>rt.span(name, fn)</code>." : "Open this tab while the graph runs to capture inner spans."}</td></tr>`;
    return [...agg].sort((a, b) => b[1].total - a[1].total).map(([name, a]) => `<tr class="lines"><td class="n"><span class="ln">${esc(name)}</span></td><td>${(a.total / a.calls).toFixed(2)}</td><td colspan="2">${a.calls} call${a.calls === 1 ? "" : "s"}</td><td colspan="3">${ms(a.total)} total over ${a.frames} frame${a.frames === 1 ? "" : "s"}</td></tr>`).join("");
  }
}
