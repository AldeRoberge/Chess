import type { Graph } from "../core/graph";
import { loadPrefs, patchPrefs } from "../setup/prefs";
import { aggregateBoxes, delta, frameBoxes, hueOf, percentile, profiler, slowestFrame, toTrace, type FlameBox, type FrameRecord } from "../core/profiler";
import { CAT_COLOR } from "./editor";
import type { Tip } from "./tooltip";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
const ms = (v: number) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)) + " ms";
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const ROW = 20;
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
  private pauseBtn = el("button", "", "Pause");
  private mode: "frame" | "window" = "window";
  private depth = 1;
  private selected: number | null = null; // index into profiler.frames while pinned
  private zoom: FlameBox | null = null;
  private hits: { x: number; y: number; w: number; box: FlameBox }[] = [];
  private tlHits: { x: number; w: number; i: number }[] = [];
  private tlOver = -1; // frame index under the pointer on the timeline
  private sort: SortKey = "avg";
  private desc = true;
  /** User-resized column widths in px (empty = automatic layout). Drag a header edge; double-click to reset. */
  private colW: number[] = [];
  private open = new Set<string>();
  private lastDraw = 0;
  private lastTable = 0;
  private boxes: FlameBox[] = [];
  private total = 1;
  private base: Map<string, number> | null = null;
  private baseTick = 0;
  private baseBtn = el("button", "", "Set baseline");

  constructor(private graph: Graph, private hooks: PerfHooks) {
    const bar = el("div", "bar perf-bar");
    this.pauseBtn.onclick = () => { profiler.paused = !profiler.paused; this.pauseBtn.textContent = profiler.paused ? "Resume" : "Pause"; this.pauseBtn.classList.toggle("on", profiler.paused); this.draw(true); };
    const clear = el("button", "", "Clear"); clear.onclick = () => { profiler.reset(); this.selected = null; this.zoom = null; this.draw(true); };
    const worst = el("button", "", "Slowest frame"); worst.title = "Pin the slowest captured frame";
    worst.onclick = () => { const i = slowestFrame(profiler.frames); if (i < 0) return; this.selected = i; this.mode = "frame"; this.zoom = null; if (!profiler.paused) this.pauseBtn.click(); this.syncModeButtons(); this.draw(true); };
    const save = el("button", "", "Export trace"); save.title = "Download the capture as Chrome trace JSON (Perfetto, chrome://tracing)";
    save.onclick = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(toTrace(profiler.frames))], { type: "application/json" })); a.download = "chess-experience-trace.json"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
    this.baseBtn.title = "Remember today's per-node averages, then compare after a change";
    this.baseBtn.onclick = () => {
      if (this.base) { this.base = null; } else {
        this.base = new Map(); this.baseTick = 0;
        for (const id of graph.nodes.keys()) { const s = profiler.summarize(id); if (s) { this.base.set(id, s.avg); this.baseTick += s.avg; } }
      }
      this.baseBtn.textContent = this.base ? "Clear baseline" : "Set baseline"; this.baseBtn.classList.toggle("on", !!this.base); this.draw(true);
    };
    const bud = el("label", "perf-budget"); const bi = el("input"); bi.type = "number"; bi.min = "0"; bi.step = "0.5";
    profiler.budget = Math.max(0, loadPrefs().perfBudget ?? 0); bi.value = String(profiler.budget);
    bi.title = "Flag nodes whose average tick cost is above this many ms (0 = off)";
    bi.onchange = () => { profiler.budget = Math.max(0, Number(bi.value) || 0); patchPrefs({ perfBudget: profiler.budget }); this.draw(true); };
    bud.append(document.createTextNode("Node budget"), bi, document.createTextNode("ms"));
    const heat = el("label", "chk"); const hc = el("input"); hc.type = "checkbox"; hc.checked = hooks.heatOn(); hc.onchange = () => hooks.setHeat(hc.checked); heat.append(hc, document.createTextNode("Timings on nodes"));
    const seg = (items: readonly (readonly [string, string | number])[], get: () => string | number, set: (v: any) => void) => {
      const g = el("div", "seg");
      for (const [label, v] of items) { const b = el("button", "", label); b.onclick = () => { set(v); for (const x of g.children) x.classList.toggle("on", x === b); }; b.classList.toggle("on", get() === v); g.append(b); }
      return g;
    };
    bar.append(this.pauseBtn, clear, worst, save, this.baseBtn, bud,
      seg([["Window", "window"], ["Frame", "frame"]], () => this.mode, (v) => { this.mode = v; this.zoom = null; this.draw(true); }),
      seg(DETAIL.map(([l, d]) => [l, d] as const), () => this.depth, (v) => { this.depth = v; this.zoom = null; this.draw(true); }),
      heat);

    this.tip.hidden = true;
    const flameWrap = el("div", "perf-flame-wrap"); flameWrap.append(this.flame, this.tip);
    this.search.type = "text"; this.search.placeholder = "Filter nodes…"; this.search.className = "perf-search";
    this.search.oninput = () => this.drawTable(true);
    const tbar = el("div", "perf-tbar"); tbar.append(el("h4", "", "Nodes"), this.search);
    this.root.append(bar, this.kpis, el("h4", "", "Frame timeline"), this.timeline, el("h4", "", "Flamegraph"), this.crumb, flameWrap, tbar, this.table);

    this.timeline.onclick = (e) => {
      const r = this.timeline.getBoundingClientRect(), x = e.clientX - r.left;
      const hit = this.tlHits.find((t) => x >= t.x && x < t.x + t.w);
      if (!hit) return;
      this.selected = this.selected === hit.i ? null : hit.i; this.mode = this.selected === null ? "window" : "frame"; this.zoom = null;
      if (this.selected !== null && !profiler.paused) this.pauseBtn.click();
      this.syncModeButtons(); this.draw(true);
    };
    this.timeline.dataset.tipLive = "1";
    this.timeline.onmousemove = (e) => { const x = e.clientX - this.timeline.getBoundingClientRect().left; const i = this.tlHits.find((t) => x >= t.x && x < t.x + t.w)?.i ?? -1; if (i !== this.tlOver) { this.tlOver = i; this.drawTimeline(); } };
    this.timeline.onmouseleave = () => { this.tlOver = -1; this.drawTimeline(); };
    this.flame.onmousemove = (e) => this.hover(e);
    this.flame.onmouseleave = () => { this.tip.hidden = true; };
    this.flame.onclick = (e) => { const h = this.pick(e); if (h) { this.zoom = this.zoom === h.box ? null : h.box; this.draw(true); } };
    this.flame.ondblclick = () => { this.zoom = null; this.draw(true); };
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

  private syncModeButtons() { const segs = this.root.querySelectorAll(".perf-bar .seg"); segs[0]?.querySelectorAll("button").forEach((b, i) => b.classList.toggle("on", (i === 0) === (this.mode === "window"))); }

  private frames(): FrameRecord[] { return profiler.frames; }

  /** Called every animation frame while this tab is showing. */
  frame(now: number) {
    if (now - this.lastDraw > 250) { this.lastDraw = now; this.draw(false); }
  }

  private draw(force: boolean) {
    this.drawKpis();
    this.drawTimeline();
    this.drawFlame();
    this.drawTable(force);
  }

  private drawKpis() {
    const fr = this.frames(), n = fr.length, durs = fr.map((f) => f.dur);
    const span = n > 1 ? fr[n - 1].at - fr[Math.max(0, n - 61)].at : 0, count = Math.min(n - 1, 60);
    const fps = span > 0 ? (count / span) * 1000 : 0;
    const avg = n ? durs.reduce((a, b) => a + b, 0) / n : 0, p95 = percentile(durs, 0.95), worst = n ? Math.max(...durs) : 0;
    const long = durs.filter((d) => d > 16.7).length;
    let tick = 0; for (const s of this.graph.stats.values()) tick += s.ms;
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
    c.style.height = cssH + "px";
    const g = c.getContext("2d")!; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g, w, h: cssH };
  }

  private drawTimeline() {
    const { g, w, h } = this.fit(this.timeline, 84);
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
    g.font = "10px IBM Plex Mono, monospace"; g.textBaseline = "bottom";
    for (const [v, c] of [[16.7, "#35e0b4"], [33.3, "#ffb340"]] as const) {
      if (v > top) continue;
      g.strokeStyle = c; g.globalAlpha = 0.5; g.setLineDash([3, 4]); g.beginPath(); g.moveTo(0, y(v)); g.lineTo(w, y(v)); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
      g.fillStyle = c; g.fillText(v === 16.7 ? "60 fps" : "30 fps", 4, y(v) - 1);
    }
    g.fillStyle = "#8aa0b8"; g.textBaseline = "alphabetic"; g.fillText(fr.length ? `click a bar to inspect that frame · scale 0–${top.toFixed(0)} ms` : "no frames yet", 4, h - 1);
  }

  private currentBoxes(): { boxes: FlameBox[]; total: number } {
    const fr = this.frames();
    if (!fr.length) return { boxes: [], total: 1 };
    if (this.mode === "frame") {
      const f = this.selected !== null ? fr[this.selected] : fr[slowestFrame(fr)];
      if (!f) return { boxes: [], total: 1 };
      return { boxes: frameBoxes(f), total: f.dur };
    }
    const boxes = aggregateBoxes(fr);
    return { boxes, total: boxes.filter((b) => b.depth === 0).reduce((a, b) => a + b.w, 0) };
  }

  private drawFlame() {
    const { boxes, total } = this.currentBoxes();
    this.boxes = boxes; this.total = total;
    const vis = boxes.filter((b) => b.depth <= this.depth);
    const maxD = vis.reduce((a, b) => Math.max(a, b.depth), 0);
    const base = this.zoom ? this.zoom.depth : 0;
    const { g, w, h } = this.fit(this.flame, Math.max(1, maxD - base + 1) * ROW + 4);
    g.clearRect(0, 0, w, h);
    this.hits = [];
    const z = this.zoom, x0 = z ? z.x : 0, span = z ? z.w : total || 1;
    const inZoom = (b: FlameBox) => !z || (b.depth >= z.depth && b.path.startsWith(z.path) && b.x >= z.x - 1e-6 && b.x + b.w <= z.x + z.w + 1e-6);
    const q = this.search.value.trim().toLowerCase();
    g.font = "11px IBM Plex Mono, monospace"; g.textBaseline = "middle";
    for (const b of vis) {
      if (!inZoom(b)) continue;
      const x = ((b.x - x0) / span) * w, bw = (b.w / span) * w;
      if (bw < 0.6) continue;
      const y = (b.depth - base) * ROW;
      const dim = q && !b.name.toLowerCase().includes(q);
      const hot = b.node ? 58 : 46;
      g.globalAlpha = dim ? 0.25 : 1;
      g.fillStyle = `hsl(${hueOf(b.node ? b.name.replace(/ preview$/, "") : b.name)} ${b.node ? 55 : 38}% ${hot}%)`;
      g.fillRect(x, y, Math.max(0.6, bw - 1), ROW - 2);
      if (bw > 38) { g.fillStyle = "#04101c"; g.save(); g.beginPath(); g.rect(x, y, bw - 2, ROW); g.clip(); g.fillText(`${b.name}  ${ms(b.w)}`, x + 4, y + ROW / 2 - 1); g.restore(); }
      g.globalAlpha = 1;
      this.hits.push({ x, y, w: bw, box: b });
    }
    const label = this.mode === "window" ? `${this.frames().length} frames merged · widths are total time` : this.selected !== null ? `frame ${this.selected + 1} of ${this.frames().length} (pinned)` : "slowest captured frame";
    this.crumb.innerHTML = `<span>${esc(label)}</span>${z ? ` · <a href="#">${esc(z.path.split("/").join(" › "))}</a> <button class="link">reset zoom</button>` : ` · click a box to zoom, double-click to reset`}`;
    this.crumb.querySelector("button")?.addEventListener("click", () => { this.zoom = null; this.draw(true); });
    this.crumb.querySelector("a")?.addEventListener("click", (e) => e.preventDefault());
  }

  private pick(e: MouseEvent) {
    const r = this.flame.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    return this.hits.find((h) => x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + ROW);
  }

  private hover(e: MouseEvent) {
    const h = this.pick(e);
    if (!h) { this.tip.hidden = true; return; }
    const b = h.box, pct = this.total ? (b.w / this.total) * 100 : 0, n = Math.max(1, this.mode === "window" ? this.frames().length : 1);
    this.tip.innerHTML = `<b>${esc(b.name)}</b><span>${ms(b.w)} total · ${pct.toFixed(1)}%</span><span>${ms(b.self)} self</span><span>${b.calls} call${b.calls === 1 ? "" : "s"}${this.mode === "window" ? ` · ${ms(b.w / n)} per frame` : ""}</span>`;
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
