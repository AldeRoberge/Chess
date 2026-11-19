import type { Graph } from "../core/graph";
import { nodeIcon, paramIcon, portIcon } from "./icons";
import { onPieceStyle, pieceImage } from "./pieceSets";
import { pixelRatio, viewSettings } from "./viewSettings";
import { registerContextMenu, type CtxItem } from "./contextMenu";
import { renderItems } from "./menus/viewMenu";
import { GroupLayer } from "./groups";
import { NODE_H, NODE_W } from "../core/groups";
import { profiler, type NodeSummary } from "../core/profiler";
import type { NodeInstance, NodeSpec, ParamDef, PortType } from "../core/types";
import { drawRows, fmtCorners, frameScale, objRows, parseCorners } from "../plugins/shared";
import { portsCompatible } from "../core/types";
import { openQuadEditor } from "./quadEditor";
import { openModelChart } from "./modelChart";
import type { GrayFrame } from "../vision/types";
import { previewPoint, setPreviewPointer, setPreviewSize } from "./previewHover";

export const PORT_COLOR: Record<PortType, string> = {
  frame: "#5aa9ff", obs: "#35e0b4", board: "#ffd35a", game: "#ff8a5a", pointer: "#c68bff", pose: "#ff6bd1",
  seat: "#a3e635", event: "#ff5a6e", text: "#7fd4ff", scene: "#8aff9c", clock: "#ffa94d", world: "#4fd1c5", player: "#f472b6", action: "#fde047", fx: "#5cf2ff", any: "#9aa4b8",
};
export const CAT_COLOR: Record<string, string> = {
  Source: "#4a8fd9", Vision: "#3fb59a", Game: "#d98c4a", Narration: "#4fb0d0", Scene: "#62c27a", Output: "#7c8aa0", Tracking: "#c76fb0", Experience: "#9a78e0", Effects: "#2fd3e6",
};

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };

interface View { x: number; y: number; k: number }
interface NodeView { heat: { bar: HTMLElement; spark: HTMLCanvasElement; txt: HTMLElement }; el: HTMLElement; preview?: HTMLCanvasElement; generic?: boolean; fid: HTMLElement; ms: HTMLElement; err: HTMLElement; params: Map<string, (v: any) => void>; statKey?: string; seen?: Map<string, unknown>; pins: Map<string, HTMLElement> }

/** Blueprint / TouchDesigner style graph editor on plain DOM + SVG (no framework, no canvas layout cost). */
export class NodeEditor {
  root = h("div", "ne");
  private world = h("div", "ne-world");
  private svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  private views = new Map<string, NodeView>();
  private view: View = { x: 40, y: 30, k: 0.85 };
  private selected = new Set<string>();
  private drag: { from: { node: string; port: string }; x: number; y: number } | null = null;
  private dirty = true;
  private palette: HTMLElement;
  private lastWire = 0;
  private lastPrev = 0;
  private lastHeat = 0;
  private heat = false;
  onChange: () => void = () => {};
  /** Called after the user pans or zooms, so the view can be remembered. */
  onView: () => void = () => {};
  getView(): View { return { ...this.view }; }
  setView(v: View) { this.view = { x: v.x, y: v.y, k: Math.min(1.6, Math.max(0.3, v.k)) }; this.applyView(); this.dirty = true; }

  /** Titled, coloured sections behind the nodes. */
  private layer: GroupLayer;
  /** Wrap the selected nodes (or the middle of the view) in a new section. */
  addGroup() {
    const r = this.root.getBoundingClientRect();
    return this.layer.add([...this.selected], { x: (r.width / 2 - this.view.x) / this.view.k, y: (r.height / 2 - this.view.y) / this.view.k });
  }
  /** Re-lay the patch out in role bands with a section each (input, analysis, game, output). */
  organize() { this.layer.organize(); }

  constructor(private graph: Graph) {
    this.layer = new GroupLayer({
      graph, scale: () => this.view.k,
      box: (id) => { const n = this.graph.nodes.get(id); if (!n) return null; const el = this.views.get(id)?.el; return { x: n.x, y: n.y, w: n.w ?? (el?.offsetWidth || NODE_W), h: n.h ?? (el?.offsetHeight || NODE_H) }; },
      place: (id) => { const n = this.graph.nodes.get(id), v = this.views.get(id); if (n && v) { v.el.style.left = n.x + "px"; v.el.style.top = n.y + "px"; if (n.w !== undefined) this.applySize(n); this.dirty = true; } },
      track: (el, e, move, end) => this.track(el, e, move, end),
      changed: () => { this.dirty = true; this.onChange(); },
    });
    this.svg.classList.add("ne-wires");
    this.svg.addEventListener("click", (ev) => { // one delegated listener: wires are rebuilt every few hundred ms
      const id = (ev.target as SVGElement).dataset?.e;
      if (id && ev.altKey) { this.graph.disconnect(id); this.dirty = true; this.onChange(); }
    });
    this.world.append(this.layer.el, this.svg);
    this.root.append(this.world);
    this.palette = h("div", "ne-palette"); this.palette.hidden = true; this.root.append(this.palette);
    this.bindInteraction();
    this.rebuild();
  }

  rebuild() {
    for (const v of this.views.values()) v.el.remove();
    this.views.clear();
    this.layer.render();
    for (const n of this.graph.nodes.values()) this.addView(n);
    this.dirty = true;
  }

  private spec(n: NodeInstance) { return this.graph.registry.get(n.type)!; }

  private addView(n: NodeInstance) {
    const spec = this.spec(n);
    const el = h("div", "ne-node"); el.dataset.id = n.id;
    el.style.setProperty("--cat", CAT_COLOR[spec.category] ?? "#555");
    const head = h("div", "ne-head");
    const ico = h("span", "ne-ico"); ico.innerHTML = nodeIcon(n.type, spec.category, 18);
    head.append(ico, h("span", "ne-title", spec.title));
    const fid = h("span", "ne-fid", ""), ms = h("span", "ne-ms", "");
    const byp = h("button", "ne-btn", "⏻"); byp.type = "button"; byp.setAttribute("aria-label", "Bypass"); byp.dataset.tip = "Bypass"; byp.dataset.tipBody = "Pass this node through without processing it.";
    byp.onclick = (e) => { e.stopPropagation(); n.bypass = !n.bypass; el.classList.toggle("bypass", !!n.bypass); this.onChange(); };
    const del = h("button", "ne-btn", "✕"); del.type = "button"; del.setAttribute("aria-label", "Delete node"); del.dataset.tip = "Delete node"; del.dataset.tipBody = "Removes the node and every wire attached to it."; del.dataset.tipTag = "destructive"; del.dataset.tipColor = "#ff7070";
    del.onclick = (e) => { e.stopPropagation(); this.removeNode(n.id); };
    const exp = h("button", "ne-btn", "⤢"); exp.type = "button"; exp.setAttribute("aria-label", "Expand"); exp.dataset.tip = "Expand"; exp.dataset.tipBody = "Toggle a larger node. Drag the bottom-right corner to resize freely.";
    exp.onclick = (e) => { e.stopPropagation(); if (n.w || n.h) { delete n.w; delete n.h; } else { n.w = 480; n.h = 400; } this.applySize(n); this.dirty = true; this.onChange(); };
    const acts = h("span", "ne-acts"); acts.append(byp, del, exp);
    head.append(fid, acts);
    el.classList.toggle("bypass", !!n.bypass);
    el.append(head);

    const body = h("div", "ne-body");
    const pinsRow = h("div", "ne-pins");
    const ins = h("div", "ne-col"), outs = h("div", "ne-col right");
    const pins = new Map<string, HTMLElement>();
    for (const p of spec.inputs) {
      const row = h("div", "ne-pin in"), dot = h("span", "ne-dot"); dot.style.background = PORT_COLOR[p.type]; dot.dataset.node = n.id; dot.dataset.port = p.id; dot.dataset.dir = "in"; dot.innerHTML = portIcon(p.type);
      row.append(dot, h("span", "ne-pl", p.label ?? p.id)); ins.append(row); pins.set("in:" + p.id, dot);
    }
    for (const p of spec.outputs) {
      const row = h("div", "ne-pin out"), dot = h("span", "ne-dot"); dot.style.background = PORT_COLOR[p.type]; dot.dataset.node = n.id; dot.dataset.port = p.id; dot.dataset.dir = "out"; dot.innerHTML = portIcon(p.type);
      row.append(h("span", "ne-pl", p.label ?? p.id), dot); outs.append(row); pins.set("out:" + p.id, dot);
    }
    pinsRow.append(ins, outs); body.append(pinsRow);

    let preview: HTMLCanvasElement | undefined;
    if (spec.preview) {
      preview = h("canvas", "ne-preview");
      const [w, hh] = spec.previewSize ?? [160, 100];
      preview.width = w; preview.height = hh; preview.style.aspectRatio = `${w} / ${hh}`; body.append(preview);
      this.watchPreview(n.id, preview, w, hh);
    }
    const params = new Map<string, (v: any) => void>();
    if (spec.params?.length) {
      const box = h("div", "ne-params");
      let listed = false;
      for (const p of spec.params) {
        if ((p.kind === "bool" && p.optional) || (p.kind === "number" && p.group)) { if (!listed) { listed = true; box.append(this.optionalList(n, spec.params, params)); } continue; }
        box.append(this.paramRow(n, p, params));
      }
      body.append(box);
    }
    const err = h("div", "ne-err"); body.append(err);
    el.append(body);
    const foot = h("div", "ne-foot"); foot.append(ms); el.append(foot); // latency lives below so titles keep their width
    const heat = h("div", "ne-heat"), heatTxt = h("span", "ne-heat-t"), spark = h("canvas", "ne-spark");
    { const d = Math.min(3, Math.max(1, Math.ceil(window.devicePixelRatio || 1))); spark.width = 120 * d; spark.height = 24 * d; spark.style.width = "120px"; spark.style.height = "24px"; } // sharp on hi-dpi
    const track = h("div", "ne-heat-bar"); track.append(h("i"));
    heat.append(track, spark, heatTxt); el.append(heat);
    const grip = h("div", "ne-grip"); grip.dataset.tip = "Resize"; el.append(grip);
    grip.addEventListener("pointerdown", (e) => {
      if (e.button > 0) return;
      e.stopPropagation(); e.preventDefault();
      const sx = e.clientX, sy = e.clientY, w0 = el.offsetWidth, h0 = el.offsetHeight;
      this.track(grip, e, (ev) => {
        n.w = Math.max(320, Math.round(w0 + (ev.clientX - sx) / this.view.k));
        n.h = Math.max(el.querySelector<HTMLElement>(".ne-head")!.offsetHeight + 60, Math.round(h0 + (ev.clientY - sy) / this.view.k));
        this.applySize(n); this.dirty = true;
      }, () => this.onChange());
    });
    el.style.left = n.x + "px"; el.style.top = n.y + "px";
    this.world.append(el);
    this.views.set(n.id, { el, preview, fid, ms, err, params, pins, heat: { bar: track.firstElementChild as HTMLElement, spark, txt: heatTxt } });
    this.applySize(n);

    head.addEventListener("pointerdown", (e) => {
      if ((e.target as HTMLElement).tagName === "BUTTON") return;
      if (e.button > 0) return;
      e.stopPropagation(); e.preventDefault();
      if (!e.shiftKey && !this.selected.has(n.id)) this.selected.clear();
      this.selected.add(n.id); this.refreshSel();
      const sx = e.clientX, sy = e.clientY;
      const starts = [...this.selected].map((id) => { const m = this.graph.nodes.get(id)!; return { m, x: m.x, y: m.y }; });
      const mv = (ev: PointerEvent) => {
        for (const s of starts) { s.m.x = s.x + (ev.clientX - sx) / this.view.k; s.m.y = s.y + (ev.clientY - sy) / this.view.k; const v = this.views.get(s.m.id)!; v.el.style.left = s.m.x + "px"; v.el.style.top = s.m.y + "px"; }
        this.dirty = true;
      };
      this.track(head, e, mv, () => this.onChange());
    });
  }

  /** Follows the pointer over a preview so the hover card and the highlight know what is under the mouse. */
  private watchPreview(id: string, c: HTMLCanvasElement, w: number, hh: number) {
    c.dataset.tipLive = "1";
    const at = (e: PointerEvent) => { const r = c.getBoundingClientRect(); if (r.width > 0 && r.height > 0) setPreviewPointer(id, { fx: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), fy: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)), w: previewPoint(id)?.w ?? w, h: previewPoint(id)?.h ?? hh }); };
    c.addEventListener("pointermove", at); c.addEventListener("pointerenter", at);
    c.addEventListener("pointerleave", () => setPreviewPointer(id, null));
  }

  /** Applies the node's chosen size: a fixed height lets the body and preview stretch to fill it. */
  private applySize(n: NodeInstance) {
    const el = this.views.get(n.id)?.el; if (!el) return;
    el.style.width = n.w ? n.w + "px" : ""; el.style.height = n.h ? n.h + "px" : "";
    el.classList.toggle("sized", !!n.h); el.classList.toggle("wide", (n.w ?? 0) >= 480);
    const v = this.views.get(n.id)!;
    if (n.h && !v.preview && !this.spec(n).preview) { // a node without a preview gets a live readout of its outputs once it is expanded
      v.preview = h("canvas", "ne-preview"); v.generic = true; v.preview.width = 160; v.preview.height = 100; this.watchPreview(n.id, v.preview, 160, 100);
      const body = el.querySelector(".ne-body")!; body.insertBefore(v.preview, body.querySelector(".ne-params"));
    } else if (!n.h && v.generic) { v.preview?.remove(); v.preview = undefined; v.generic = false; }
  }

  /** Optional settings as a list: only the added ones show (each as a card with its sub-settings); a dropdown adds the rest. */
  private optionalList(n: NodeInstance, defs: ParamDef[], sync: Map<string, (v: any) => void>) {
    const wrap = h("div", "ne-opt"), list = h("div", "ne-opt-list"), add = h("select", "ne-opt-add");
    const items = defs.filter((p): p is Extract<ParamDef, { kind: "bool" }> => p.kind === "bool" && !!p.optional);
    const set = (id: string, on: boolean) => { n.params[id] = on; render(); this.onChange(); };
    const render = () => {
      list.replaceChildren(...items.filter((it) => n.params[it.id]).map((it) => {
        const card = h("div", "ne-opt-card"), head = h("div", "ne-opt-head", it.label), x = h("button", "ne-opt-x", "✕"); x.type = "button";
        card.dataset.node = n.id; card.dataset.param = it.id;
        x.dataset.tip = `Remove ${it.label}`; x.onpointerdown = (e) => e.stopPropagation(); x.onclick = (e) => { e.preventDefault(); e.stopPropagation(); set(it.id, false); };
        head.append(x); card.append(head);
        for (const c of defs) if (c.kind === "number" && c.group === it.id) card.append(this.paramRow(n, c, sync));
        return card;
      }));
      const rest = items.filter((it) => !n.params[it.id]);
      add.replaceChildren(Object.assign(h("option", "", "＋ Add…"), { value: "" }), ...rest.map((it) => Object.assign(h("option", "", it.label), { value: it.id })));
      add.value = ""; add.hidden = !rest.length;
    };
    add.onchange = () => { if (add.value) set(add.value, true); };
    for (const it of items) sync.set(it.id, () => render()); // loading a graph or undo can flip an item from outside
    render(); wrap.append(list, add);
    return wrap;
  }

  private paramRow(n: NodeInstance, p: ParamDef, sync: Map<string, (v: any) => void>) {
    if (p.kind === "separator") { const sep = h("div", "ne-param-sep", p.label); sep.setAttribute("role", "separator"); sep.dataset.node = n.id; sep.dataset.param = p.id; return sep; }
    // A div, not a label: a checkbox inside a label is toggled when it is inserted, which cleared "Seated" on every new patch.
    const row = h("div", "ne-param"); row.dataset.node = n.id; row.dataset.param = p.id; const pn = h("span", "ne-pn"); pn.innerHTML = `<span class="ne-pi">${paramIcon(p.id, p.kind)}</span>`; pn.append(p.label); row.append(pn);
    const ic0 = pn.querySelector<HTMLElement>(".ne-pi")!;
    const mark = () => { const ch = n.params[p.id] !== p.value; row.classList.toggle("changed", ch); if (ch) { ic0.dataset.tip = "Reset to default"; ic0.dataset.tipBody = `Back to ${p.value}.`; ic0.dataset.tipHint = "Click the icon"; } else { delete ic0.dataset.tip; delete ic0.dataset.tipBody; delete ic0.dataset.tipHint; } };
    const commit = (v: any) => { n.params[p.id] = v; mark(); this.onChange(); };
    const ic = pn.querySelector<HTMLElement>(".ne-pi")!;
    ic.onclick = (e) => { e.preventDefault(); e.stopPropagation(); if (n.params[p.id] === p.value) return; commit(p.value); sync.get(p.id)?.(p.value); };
    queueMicrotask(mark);
    if (p.kind === "number") {
      const r = h("input"); r.type = "range"; r.min = String(p.min); r.max = String(p.max); r.step = String(p.step ?? 0.01); r.value = String(n.params[p.id]);
      const val = h("span", "ne-pv", String(n.params[p.id]));
      const fill = () => r.style.setProperty("--pct", `${((Number(r.value) - p.min) / (p.max - p.min || 1)) * 100}%`);
      fill();
      r.oninput = () => { val.textContent = r.value; fill(); commit(Number(r.value)); };
      sync.set(p.id, (v) => { if (document.activeElement !== r) { r.value = String(v); val.textContent = String(v); fill(); } });
      row.append(r, val);
    } else if (p.kind === "bool" && p.action) {
      const b = h("button", "ne-action", p.label); b.type = "button"; b.setAttribute("aria-label", p.label);
      b.onpointerdown = (e) => e.stopPropagation();
      b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); n.params[p.id] = true; this.onChange(); };
      pn.setAttribute("aria-hidden", "true"); row.append(b);
    } else if (p.kind === "bool") {
      const c = h("input"); c.type = "checkbox"; c.setAttribute("aria-label", p.label); c.checked = !!n.params[p.id];
      let ready = false; c.onchange = () => { if (ready) commit(c.checked); }; // inserting the box can fire change before it shows the saved value
      sync.set(p.id, (v) => (c.checked = !!v)); row.append(c); ready = true;
      pn.addEventListener("click", (e) => { if ((e.target as HTMLElement).closest(".ne-pi")) return; c.click(); });
    } else if (p.kind === "select") {
      const s = h("select");
      // Rebuilt from the param's options each time it opens, so a list fetched later (e.g. OpenAI models) shows up; a saved value missing from the list stays visible.
      const fill = () => {
        const cur = String(n.params[p.id]), opts = p.options.includes(cur) || !cur ? p.options : [...p.options, cur];
        s.replaceChildren(...opts.map((o) => { const i = p.options.indexOf(o), op = h("option", "", i >= 0 ? p.labels?.[i] ?? o : o); op.value = o; return op; }));
        s.value = cur;
      };
      fill(); s.onpointerdown = () => fill(); s.onchange = () => commit(s.value);
      sync.set(p.id, (v) => { if (document.activeElement !== s) fill(); });
      if (p.icons) {
        // The piece icon for the chosen option sits beside the select; it follows the selection and the piece set.
        const cv = h("canvas"); cv.width = cv.height = 40; cv.style.cssText = "width:20px;height:20px;flex:none";
        const draw = (tries = 0) => {
          const code = p.icons![p.options.indexOf(String(n.params[p.id]))], g = cv.getContext("2d"); if (!code || !g) return;
          const img = pieceImage(code); g.clearRect(0, 0, 40, 40);
          if (img) g.drawImage(img, 0, 0, 40, 40); else if (tries < 30) setTimeout(() => draw(tries + 1), 60); // image still loading
        };
        const off: () => void = onPieceStyle(() => { if (!cv.isConnected) { off(); return; } draw(); });
        const oc = s.onchange; s.onchange = (e) => { oc?.call(s, e as any); draw(); };
        const wrap = h("span", ""); wrap.style.cssText = "display:inline-flex;align-items:center;gap:4px;min-width:0"; wrap.append(cv, s); row.append(wrap);
        queueMicrotask(() => draw());
      } else row.append(s);
      if (p.pick) {
        const pick = p.pick, b = h("button", "ne-qbtn", "◫ Compare"); b.type = "button"; b.dataset.tip = "Compare options"; b.dataset.tipBody = "See each option's price per token on a chart and pick one.";
        b.onpointerdown = (e) => e.stopPropagation();
        b.onclick = (e) => {
          e.preventDefault(); e.stopPropagation();
          openModelChart({ title: `${this.spec(n).title} — ${pick.title}`, current: String(n.params[p.id]), models: pick.models(), pick: (v) => { commit(v); fill(); } });
        };
        pn.append(b);
      }
    } else {
      const t = h("input"); t.type = p.secret ? "password" : "text"; if (p.secret) { t.autocomplete = "off"; t.spellcheck = false; } t.setAttribute("aria-label", p.label); t.value = String(n.params[p.id]); t.onchange = () => commit(t.value); t.onpointerdown = (e) => e.stopPropagation();
      sync.set(p.id, (v) => { if (document.activeElement !== t) t.value = String(v); }); row.append(t);
      if (p.quad) {
        const q = p.quad, b = h("button", "ne-qbtn", "⌖ Edit"); b.type = "button"; b.dataset.tip = "Edit corners"; b.dataset.tipBody = "Drag the corners on the live camera picture instead of typing numbers.";
        b.onpointerdown = (e) => e.stopPropagation();
        b.onclick = (e) => {
          e.preventDefault(); e.stopPropagation();
          const live = () => this.spec(n).frameOf?.(this.graph.states.get(n.id)) as GrayFrame | null ?? null;
          // The editor works in the picture's own pixels. Saved corners stay in the 480×360 reader frame, so a sharper camera does not move the grid.
          const toView = (stored: string) => {
            const fr = live(), sc = fr ? frameScale(fr.width, fr.height) : { sx: 1, sy: 1 }, pts = parseCorners(stored);
            return !pts || (sc.sx === 1 && sc.sy === 1) ? stored : fmtCorners(pts.map((pt) => ({ x: pt.x * sc.sx, y: pt.y * sc.sy })));
          };
          const toStored = (view: string) => {
            const fr = live(), sc = fr ? frameScale(fr.width, fr.height) : { sx: 1, sy: 1 }, pts = parseCorners(view);
            return !pts || (sc.sx === 1 && sc.sy === 1) ? view : fmtCorners(pts.map((pt) => ({ x: pt.x / sc.sx, y: pt.y / sc.sy })));
          };
          openQuadEditor({
            title: `${this.spec(n).title} — ${p.label}`, value: toView(String(n.params[p.id])), names: q.names, grid: q.grid,
            frame: live,
            change: (v) => { const s = toStored(v); t.value = s; commit(s); }, done: () => {},
          });
        };
        pn.append(b);
      }
    }
    const inner = sync.get(p.id); if (inner) sync.set(p.id, (v) => { inner(v); mark(); });
    return row;
  }

  /** Timing overlay: every node shows a cost bar, a sparkline of recent ticks and avg / p95 / max. */
  setHeat(on: boolean) { this.heat = on; this.root.classList.toggle("heat", on); this.lastHeat = 0; }
  get heatOn() { return this.heat; }

  /** Select a node and pan so it sits in the middle of the view. */
  reveal(id: string) {
    const n = this.graph.nodes.get(id), v = this.views.get(id);
    if (!n || !v) return;
    this.selected.clear(); this.selected.add(id); this.refreshSel();
    this.view.x = this.root.clientWidth / 2 - (n.x + v.el.offsetWidth / 2) * this.view.k;
    this.view.y = this.root.clientHeight / 2 - (n.y + v.el.offsetHeight / 2) * this.view.k;
    this.applyView(); this.dirty = true; this.onView();
  }

  private paintHeat(now: number) {
    if (now - this.lastHeat < 250) return;
    this.lastHeat = now;
    const sums = new Map<string, NodeSummary>();
    let total = 0, top = 0;
    for (const id of this.views.keys()) { const s = profiler.summarize(id); if (s) { sums.set(id, s); total += s.avg; top = Math.max(top, s.avg); } }
    for (const [id, v] of this.views) {
      const s = sums.get(id);
      if (!s) continue;
      const share = total > 0 ? s.avg / total : 0, rel = top > 0 ? s.avg / top : 0;
      const col = `hsl(${Math.round(130 - 130 * rel)} 70% 55%)`;
      v.el.style.setProperty("--heat", col);
      v.el.classList.toggle("over", profiler.budget > 0 && s.avg > profiler.budget);
      v.heat.bar.style.width = `${Math.max(1, share * 100).toFixed(1)}%`;
      v.heat.txt.textContent = `${s.avg.toFixed(2)} avg · ${s.p95.toFixed(2)} p95 · ${s.max.toFixed(2)} max ms · ${(share * 100).toFixed(0)}%`;
      const c = v.heat.spark, g = c.getContext("2d")!, vals = profiler.series(id), mx = Math.max(0.5, s.max);
      g.clearRect(0, 0, c.width, c.height);
      g.strokeStyle = col; g.lineWidth = 1.5 * (c.width / 120); g.beginPath();
      vals.forEach((x, i) => { const px = (i / 119) * c.width, py = c.height - 2 - (x / mx) * (c.height - 4); if (i) g.lineTo(px, py); else g.moveTo(px, py); });
      g.stroke();
    }
  }

  private refreshSel() {
    for (const [id, v] of this.views) v.el.classList.toggle("sel", this.selected.has(id));
    this.root.classList.toggle("has-sel", this.selected.size > 0); // slightly softens the nodes that are not selected
    this.dirty = true; // re-evaluate which wires are highlighted
    this.onSelect([...this.selected]);
  }
  /** Called whenever the selection changes; the top ribbon uses it to offer the matching actions. */
  onSelect: (ids: string[]) => void = () => {};
  selection(): string[] { return [...this.selected]; }
  /** Copy a node next to itself (same type and settings). */
  duplicate(id: string) {
    const n = this.graph.nodes.get(id); if (!n) return;
    const c = this.graph.addNode(n.type, n.x + 40, n.y + 40); Object.assign(c.params, JSON.parse(JSON.stringify(n.params))); this.addView(c); this.dirty = true; this.onChange();
  }
  toggleBypass(id: string) {
    const n = this.graph.nodes.get(id); if (!n) return;
    n.bypass = !n.bypass; this.views.get(id)?.el.classList.toggle("bypass", !!n.bypass); this.onChange();
  }

  /** Right-click menu: a wire, a node, or the empty canvas (the "add node" palette lives under Add node…). */
  private contextItems(ev: MouseEvent): CtxItem[] {
    const t = ev.target as HTMLElement | SVGElement;
    const wire = (t as SVGElement).dataset?.e;
    if (wire) return [{ kind: "action", label: "Disconnect wire", danger: true, run: () => { this.graph.disconnect(wire); this.dirty = true; this.onChange(); } }];
    const el = (t as HTMLElement).closest?.(".ne-node") as HTMLElement | null, n = el && this.graph.nodes.get(el.dataset.id ?? "");
    if (n) {
      const spec = this.spec(n), v = this.views.get(n.id), big = !!(n.w || n.h);
      return [
        { kind: "toggle", label: "Bypass", get: () => !!n.bypass, set: (b) => { n.bypass = b; v?.el.classList.toggle("bypass", b); this.onChange(); } },
        { kind: "action", label: big ? "Collapse" : "Expand", run: () => { if (big) { delete n.w; delete n.h; } else { n.w = 480; n.h = 400; } this.applySize(n); this.dirty = true; this.onChange(); } },
        { kind: "action", label: "Duplicate", run: () => this.duplicate(n.id) },
        { kind: "action", label: "Reset parameters", disabled: !spec.params?.length, hint: spec.params?.length ? undefined : "This node has no parameters to reset.", run: () => { for (const p of spec.params ?? []) n.params[p.id] = p.value; this.dirty = true; this.onChange(); } },
        ...(spec.preview ? [{ kind: "submenu" as const, label: "Preview quality", items: renderItems }] : []),
        { kind: "action", label: "Copy node id", run: () => void navigator.clipboard?.writeText(n.id) },
        { kind: "action", label: "Delete node", danger: true, run: () => this.removeNode(n.id) },
      ];
    }
    if (t.closest?.(".ne-palette")) return [];
    return [
      { kind: "action", label: "Add node…", run: () => this.openPalette(ev.clientX, ev.clientY) },
      { kind: "action", label: "Select all", run: () => { this.selected = new Set(this.views.keys()); this.refreshSel(); } },
      { kind: "action", label: "Reset view", run: () => { this.view.x = 0; this.view.y = 0; this.view.k = 1; this.applyView(); this.onView(); } },
    ];
  }

  removeNode(id: string) { setPreviewPointer(id, null); this.graph.removeNode(id); this.views.get(id)?.el.remove(); this.views.delete(id); this.selected.delete(id); this.root.classList.toggle("has-sel", this.selected.size > 0); this.dirty = true; this.onChange(); }

  addNodeAt(type: string, cx: number, cy: number) {
    const n = this.graph.addNode(type, (cx - this.view.x) / this.view.k, (cy - this.view.y) / this.view.k);
    this.addView(n); this.dirty = true; this.onChange();
    return n;
  }

  private applyView() { if (this.viewRaf) { cancelAnimationFrame(this.viewRaf); this.viewRaf = 0; } this.world.style.transform = `translate(${this.view.x}px,${this.view.y}px) scale(${this.view.k})`; }
  /** Pan and zoom gestures change the view many times a frame; the transform is written once, on the next animation frame. */
  private viewRaf = 0;
  private scheduleView() { if (!this.viewRaf) this.viewRaf = requestAnimationFrame(() => { this.viewRaf = 0; this.applyView(); }); }
  /** While a pan or pinch runs the world is its own compositor layer and previews hold still, so moving the map costs no repaint. */
  private moving = 0;
  private setMoving(on: boolean) { this.moving = Math.max(0, this.moving + (on ? 1 : -1)); this.root.classList.toggle("moving", this.moving > 0); }
  /** Zoom by `f` around a point in canvas pixels, keeping that point still. */
  private zoomAt(mx: number, my: number, f: number) {
    const k = Math.min(1.6, Math.max(0.3, this.view.k * f));
    this.view.x = mx - ((mx - this.view.x) * k) / this.view.k; this.view.y = my - ((my - this.view.y) * k) / this.view.k; this.view.k = k;
  }
  private fling = 0;
  /** A touch pan released while moving keeps gliding and slows to a stop. */
  private glide(vx: number, vy: number) {
    cancelAnimationFrame(this.fling);
    if (Math.hypot(vx, vy) < 0.25) return; // px per ms
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(48, now - last); last = now;
      this.view.x += vx * dt; this.view.y += vy * dt; this.applyView();
      const decay = Math.pow(0.995, dt); vx *= decay; vy *= decay;
      this.fling = Math.hypot(vx, vy) > 0.02 ? requestAnimationFrame(step) : 0;
      if (!this.fling) this.onView();
    };
    this.fling = requestAnimationFrame(step);
  }
  /** Pans the view with the pointer; touch and pen pans glide on after release. */
  private pan(e: PointerEvent) {
    cancelAnimationFrame(this.fling); this.fling = 0;
    const sx = e.clientX, sy = e.clientY, ox = this.view.x, oy = this.view.y;
    let vx = 0, vy = 0, lt = e.timeStamp, lx = sx, ly = sy;
    this.setMoving(true);
    const mv = (ev: PointerEvent) => {
      const dt = ev.timeStamp - lt;
      if (dt > 0) { const a = Math.min(1, dt / 50); vx += ((ev.clientX - lx) / dt - vx) * a; vy += ((ev.clientY - ly) / dt - vy) * a; } // smoothed velocity
      lt = ev.timeStamp; lx = ev.clientX; ly = ev.clientY;
      this.view.x = ox + ev.clientX - sx; this.view.y = oy + ev.clientY - sy; this.scheduleView();
    };
    this.track(this.root, e, mv, (ev) => {
      this.setMoving(false); this.applyView();
      if (ev && (e.pointerType === "touch" || e.pointerType === "pen") && ev.timeStamp - lt < 80) this.glide(vx, vy); else this.onView();
    });
  }
  /** Fingers on the canvas, for two-finger pinch zoom. */
  private touches = new Map<number, { x: number; y: number }>();
  private pinch: { d: number; mx: number; my: number; x: number; y: number; k: number; left: number; top: number } | null = null;
  private bindTouch() {
    const spread = () => { const [a, b] = [...this.touches.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; };
    this.root.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "touch" || (e.target as HTMLElement).closest(".ne-palette")) return;
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size !== 2) return;
      // second finger: whatever the first one started (a pan, a node drag, a wire) gives way to a pinch
      e.preventDefault(); e.stopPropagation(); this.endGesture?.(); cancelAnimationFrame(this.fling);
      const r = this.root.getBoundingClientRect(), s = spread();
      this.pinch = { ...s, x: this.view.x, y: this.view.y, k: this.view.k, left: r.left, top: r.top };
      this.setMoving(true);
    }, true);
    this.root.addEventListener("pointermove", (e) => {
      const t = this.touches.get(e.pointerId); if (!t) return;
      t.x = e.clientX; t.y = e.clientY;
      const p = this.pinch; if (!p || this.touches.size < 2) return;
      e.stopPropagation();
      const s = spread(), k = Math.min(1.6, Math.max(0.3, p.k * s.d / p.d));
      const wx = (p.mx - p.left - p.x) / p.k, wy = (p.my - p.top - p.y) / p.k; // the map point first under the fingers stays under them
      this.view.k = k; this.view.x = s.mx - p.left - wx * k; this.view.y = s.my - p.top - wy * k;
      this.scheduleView();
    }, true);
    const lift = (e: PointerEvent) => {
      if (!this.touches.delete(e.pointerId)) return;
      if (this.pinch && this.touches.size < 2) { this.pinch = null; this.setMoving(false); this.applyView(); this.onView(); }
    };
    for (const ev of ["pointerup", "pointercancel"] as const) window.addEventListener(ev, lift, true);
  }

  private bindInteraction() {
    this.applyView();
    this.bindTouch();
    this.root.addEventListener("wheel", (e) => {
      if ((e.target as HTMLElement).closest(".ne-palette")) return;
      e.preventDefault();
      const r = this.root.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      // Proportional zoom: one mouse-wheel notch (100px) is 10%, a trackpad's many small deltas glide smoothly instead of jumping 10% each.
      const dy = Math.max(-300, Math.min(300, e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 300 : 1)));
      cancelAnimationFrame(this.fling); this.fling = 0;
      this.zoomAt(mx, my, Math.pow(1.1, -dy / (e.ctrlKey ? 12 : 100))); // ctrlKey: a trackpad pinch, which sends small deltas
      this.scheduleView(); this.onView();
    }, { passive: false });
    // middle mouse button pans from anywhere, including over nodes (capture phase so nothing underneath claims it)
    this.root.addEventListener("mousedown", (e) => { if (e.button === 1) e.preventDefault(); }, true); // no browser autoscroll
    this.root.addEventListener("pointerdown", (e) => {
      if (e.button !== 1 || (e.target as HTMLElement).closest(".ne-palette")) return;
      e.preventDefault(); e.stopPropagation(); window.getSelection()?.removeAllRanges();
      this.pan(e);
    }, true);
    this.root.addEventListener("pointerdown", (e) => {
      if (e.button > 0) return; // right-click opens the palette; it must not start a drag that never gets its pointerup
      const t = e.target as HTMLElement;
      if (t.classList.contains("ne-dot")) { this.startWire(e, t); return; }
      if (t.closest(".ne-node") || t.closest(".ne-palette")) return;
      e.preventDefault(); window.getSelection()?.removeAllRanges(); // no text selection or native drag while panning
      this.palette.hidden = true; this.selected.clear(); this.refreshSel();
      this.pan(e);
    });
    this.root.addEventListener("dblclick", (e) => { if (!(e.target as HTMLElement).closest(".ne-node")) this.openPalette(e.clientX, e.clientY); });
    registerContextMenu(this.root, (e) => this.contextItems(e));
    window.addEventListener("keydown", (e) => {
      if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "SELECT") return;
      if (e.key === "Delete" || e.key === "Backspace") for (const id of [...this.selected]) this.removeNode(id);
    });
  }

  private localPoint(e: PointerEvent) {
    const r = this.root.getBoundingClientRect();
    return { x: (e.clientX - r.left - this.view.x) / this.view.k, y: (e.clientY - r.top - this.view.y) / this.view.k };
  }

  private startWire(e: PointerEvent, dot: HTMLElement) {
    e.stopPropagation();
    const dir = dot.dataset.dir!, here = { node: dot.dataset.node!, port: dot.dataset.port! };
    // dragging from a connected input detaches its wire so it can be re-plugged
    let from = here, fromIsOut = dir === "out";
    if (dir === "in") {
      const ex = this.graph.edges.find((x) => x.to.node === here.node && x.to.port === here.port);
      if (ex) { this.graph.disconnect(ex.id); from = ex.from; fromIsOut = true; }
    }
    const p = this.localPoint(e);
    this.drag = { from, x: p.x, y: p.y };
    (this.drag as any).fromIsOut = fromIsOut; (this.drag as any).orig = here;
    const mv = (ev: PointerEvent) => { const q = this.localPoint(ev); this.drag!.x = q.x; this.drag!.y = q.y; this.dirty = true; };
    const up = (ev: PointerEvent | null) => { // null: the gesture was cancelled, so drop the wire without connecting
      const target = ev ? document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null : null;
      if (target?.classList.contains("ne-dot")) {
        const t = { node: target.dataset.node!, port: target.dataset.port! };
        if (fromIsOut && target.dataset.dir === "in") this.graph.connect(from, t);
        else if (!fromIsOut && target.dataset.dir === "out") this.graph.connect(t, from);
      } else if (ev && !target?.closest(".ne-node") && !target?.closest(".ne-palette") && this.root.contains(target)) {
        this.openPalette(ev.clientX, ev.clientY, { from, fromIsOut }); // released on empty canvas: offer to create a node there
      }
      this.drag = null; this.dirty = true; this.onChange();
    };
    this.track(this.root, e, mv, up);
    this.dirty = true;
  }

  private endGesture: (() => void) | null = null;

  /** Runs a pointer drag and always ends it: on release, on a cancelled pointer, when capture is lost, or when the window loses focus. */
  private track(el: HTMLElement, e: PointerEvent, move: (ev: PointerEvent) => void, end: (ev: PointerEvent | null) => void) {
    this.endGesture?.(); // never leave an earlier drag running
    try { el.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    let done = false;
    const stop = (ev: Event | null) => {
      if (done) return; done = true;
      el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", stop);
      el.removeEventListener("pointercancel", stop); el.removeEventListener("lostpointercapture", stop); window.removeEventListener("blur", stop);
      try { el.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      if (this.endGesture === abort) this.endGesture = null;
      end(ev && ev.type === "pointerup" ? (ev as PointerEvent) : null);
    };
    const abort = () => stop(null);
    this.endGesture = abort;
    el.addEventListener("pointermove", move); el.addEventListener("pointerup", stop);
    el.addEventListener("pointercancel", stop); el.addEventListener("lostpointercapture", stop); window.addEventListener("blur", stop);
  }

  /** `link`: set when a wire was released on empty canvas; the list narrows to nodes that can take it and the new node is wired up. */
  private openPalette(cx: number, cy: number, link?: { from: { node: string; port: string }; fromIsOut: boolean }) {
    const r = this.root.getBoundingClientRect();
    this.palette.hidden = false; this.palette.style.left = cx - r.left + "px"; this.palette.style.top = cy - r.top + "px";
    this.palette.replaceChildren();
    const fromNode = link ? this.graph.nodes.get(link.from.node) : undefined;
    const fromSpec = fromNode ? this.graph.registry.get(fromNode.type) : undefined;
    const fromPort = fromSpec ? (link!.fromIsOut ? fromSpec.outputs : fromSpec.inputs).find((p) => p.id === link!.from.port) : undefined;
    /** The port on `s` that would receive the dragged wire, if any. */
    const matchPort = (s: NodeSpec) => {
      if (!fromPort) return undefined;
      return (link!.fromIsOut ? s.inputs : s.outputs).find((p) => portsCompatible(fromPort.type, p.type));
    };
    if (fromPort) {
      const hd = h("div", "ne-pal-head"); hd.style.setProperty("--pt", PORT_COLOR[fromPort.type]);
      hd.textContent = `${link!.fromIsOut ? "Connect" : "Feed"} ${fromPort.label ?? fromPort.id} · ${fromPort.type}`; this.palette.append(hd);
    }
    const q = h("input", "ne-search"); q.placeholder = fromPort ? "Search compatible nodes…" : "Add node…  (type to filter)"; this.palette.append(q);
    const chips = h("div", "ne-chips"); this.palette.append(chips);
    const list = h("div", "ne-list"); this.palette.append(list);
    const all = this.graph.registry.all().filter((s) => !fromPort || matchPort(s)).sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
    const cats = [...new Set(all.map((s) => s.category))];
    let cat = "";
    const fill = () => {
      list.replaceChildren();
      const needle = q.value.toLowerCase();
      for (const s of all.filter((s) => (!cat || s.category === cat) && (s.title + s.category + (s.desc ?? "")).toLowerCase().includes(needle))) {
        const it = h("div", "ne-item"); it.style.setProperty("--cat", CAT_COLOR[s.category]); it.append(h("b", "", s.category), document.createTextNode(" " + s.title));
        it.onclick = () => {
          const n = this.addNodeAt(s.type, cx - r.left, cy - r.top);
          const mp = matchPort(s);
          if (link && mp) this.graph.connect(...(link.fromIsOut ? [link.from, { node: n.id, port: mp.id }] : [{ node: n.id, port: mp.id }, link.from]) as [any, any]);
          this.palette.hidden = true; this.dirty = true; this.onChange();
        };
        list.append(it);
      }
      if (!list.firstChild) list.append(h("div", "ne-empty", "No matching nodes"));
    };
    const paintChips = () => {
      chips.replaceChildren();
      for (const c of ["", ...cats]) {
        if (!c && cats.length < 2) continue;
        const b = h("button", "ne-chip" + (c === cat ? " on" : ""), c || "All"); b.style.setProperty("--cat", c ? CAT_COLOR[c] : "#9aa4b8");
        b.onclick = () => { cat = c; paintChips(); fill(); q.focus(); };
        chips.append(b);
      }
    };
    q.oninput = fill; q.onkeydown = (e) => { if (e.key === "Enter") (list.querySelector(".ne-item") as HTMLElement | null)?.click(); else if (e.key === "Escape") this.palette.hidden = true; };
    paintChips(); fill(); setTimeout(() => q.focus());
  }

  private pinPos(id: string, key: string): { x: number; y: number } | null {
    const v = this.views.get(id), n = this.graph.nodes.get(id);
    const dot = v?.pins.get(key);
    if (!v || !n || !dot) return null;
    let x = dot.offsetWidth / 2, y = dot.offsetHeight / 2, el: HTMLElement | null = dot;
    while (el && el !== v.el) { x += el.offsetLeft; y += el.offsetTop; el = el.offsetParent as HTMLElement | null; }
    return { x: n.x + x, y: n.y + y };
  }

  private wirePath(a: { x: number; y: number }, b: { x: number; y: number }) {
    // Handle length sets how rounded the curve is. Forward wires get a gentle S; wires that run backwards
    // (target left of source) get long handles that grow with the vertical gap too, so they swing out in a wide
    // round arc instead of a tight hairpin.
    const dx = b.x - a.x, dy = Math.abs(b.y - a.y);
    const d = dx >= 0
      ? Math.max(60, dx * 0.5)
      : Math.min(600, Math.max(120, -dx * 0.5 + dy * 0.6 + 80));
    return `M${a.x},${a.y} C${a.x + d},${a.y} ${b.x - d},${b.y} ${b.x},${b.y}`;
  }

  private seen = new Map<string, { sig: string; since: number }>();
  /** How long (ms) this wire's value has been unchanged; an undefined value (frames) always counts as changing. */
  private settle(id: string, val: unknown, now: number) {
    const sig = val === undefined ? `t${now}` : signature(val), o = this.seen.get(id);
    if (!o || o.sig !== sig) { this.seen.set(id, { sig, since: now }); return 0; }
    return now - o.since;
  }

  private wirePaths = new Map<string, SVGPathElement>();
  /** Updates existing wire paths in place, adds new ones and removes gone ones, so unchanged wires keep their CSS animation running. */
  private reconcileWires(wanted: Map<string, { d: string; stroke: string; cls: string; tip: string; style: string; e?: string }>) {
    for (const [key, p] of this.wirePaths) if (!wanted.has(key)) { p.remove(); this.wirePaths.delete(key); }
    for (const [key, w] of wanted) {
      let p = this.wirePaths.get(key);
      if (!p) {
        p = document.createElementNS("http://www.w3.org/2000/svg", "path");
        p.append(document.createElementNS("http://www.w3.org/2000/svg", "title"));
        this.wirePaths.set(key, p);
        this.svg.append(p); // only new paths are appended: moving an element in the DOM restarts its CSS animation
      }
      p.setAttribute("d", w.d); p.setAttribute("stroke", w.stroke); p.setAttribute("class", w.cls); p.setAttribute("style", w.style);
      if (w.e) p.setAttribute("data-e", w.e); else p.removeAttribute("data-e");
      p.firstChild!.textContent = w.tip;
    }
  }

  /** Called every frame by the app: refreshes wires, live meters, previews, param echoes. */
  /** Red outline on the node plus a plain-language message: what happened, what to try, and the raw text on hover. */
  private showError(v: NodeView, st: { error?: string; errorHint?: string; errorDetail?: string }) {
    v.el.classList.toggle("errored", !!st.error);
    v.err.replaceChildren();
    if (!st.error) { v.err.removeAttribute("role"); v.err.removeAttribute("title"); return; }
    v.err.setAttribute("role", "alert");
    if (st.errorDetail) v.err.title = `Technical details: ${st.errorDetail}`;
    const head = h("strong", "ne-err-h"); head.textContent = "⚠ This node has a problem";
    const msg = h("span", "ne-err-m"); msg.textContent = st.error;
    v.err.append(head, msg);
    if (st.errorHint) { const t = h("em", "ne-err-t"); t.textContent = st.errorHint; v.err.append(t); }
  }

  /** True when a node's box (plus a margin, so panning does not pop previews in) overlaps the visible canvas. */
  private onScreen(n: NodeInstance, v: NodeView): boolean {
    if (!this.root.clientWidth || !this.root.clientHeight) return true; // no layout yet (hidden or detached): keep painting as before
    const k = this.view.k, m = 120;
    const x = n.x * k + this.view.x, y = n.y * k + this.view.y;
    const w = v.el.offsetWidth * k, h = v.el.offsetHeight * k;
    return x + w > -m && y + h > -m && x < this.root.clientWidth + m && y < this.root.clientHeight + m;
  }

  frame(now: number) {
    if (this.viewRaf) this.applyView();
    if (this.dirty || now - this.lastWire > 400) {
      this.lastWire = now; this.dirty = false;
      // Wires are reconciled in place rather than rebuilt: replacing the <path> elements would restart their CSS flow animation on every refresh (the visible back-and-forth jitter).
      const wanted = new Map<string, { d: string; stroke: string; cls: string; tip: string; style: string; e?: string }>();
      for (const e of this.graph.edges) {
        const a = this.pinPos(e.from.node, "out:" + e.from.port), b = this.pinPos(e.to.node, "in:" + e.to.port);
        if (!a || !b) continue;
        const spec = this.graph.registry.get(this.graph.nodes.get(e.from.node)!.type)!;
        const t = spec.outputs.find((p) => p.id === e.from.port)!.type;
        const val = this.graph.outputs.get(e.from.node)?.[e.from.port];
        const live = val !== undefined && val !== null && !(Array.isArray(val) && !val.length);
        const fid = this.graph.stats.get(e.from.node)?.fidelity ?? null;
        const hot = this.selected.has(e.from.node) || this.selected.has(e.to.node); // wires touching a selected node shine brighter
        const cls = (live ? wireClass(this.settle(e.id, t === "frame" ? undefined : val, now), fid) : "idle") + (hot ? " hot" : "");
        const tip = !live ? "No data yet" : cls.startsWith("constant") ? "Constant: has not changed" : fid == null ? "Live data" : `Certainty ${Math.round(fid * 100)}%`;
        wanted.set(e.id, { d: this.wirePath(a, b), stroke: PORT_COLOR[t], cls, tip, style: `pointer-events:stroke${fid != null && live ? `;opacity:${(0.5 + 0.5 * fid).toFixed(2)}` : ""}`, e: e.id });
      }
      if (this.drag) {
        const a = this.pinPos(this.drag.from.node, "out:" + this.drag.from.port);
        if (a) wanted.set("\0drag", { d: this.wirePath(a, { x: this.drag.x, y: this.drag.y }), stroke: "#fff", cls: "drag", tip: "", style: "" });
      }
      this.reconcileWires(wanted);
    }
    const doPrev = !this.moving && now - this.lastPrev > Math.max(66, viewSettings().render.fps > 0 ? 1000 / viewSettings().render.fps : 0);
    if (doPrev) this.lastPrev = now;
    // Measure which previews are on screen before anything below writes to the DOM. Reading a node's size
    // after another node's stats were rewritten would force a fresh layout once per node, every frame.
    const visible = new Set<string>();
    if (doPrev) for (const [id, v] of this.views) { const n = this.graph.nodes.get(id); if (n && v.preview && this.onScreen(n, v)) visible.add(id); }
    for (const [id, v] of this.views) {
      const st = this.graph.stats.get(id);
      const n = this.graph.nodes.get(id)!;
      if (st) {
        const key = `${st.ms.toFixed(1)}|${st.fidelity == null ? "" : Math.round(st.fidelity * 100)}|${st.error ?? ""}|${st.errorHint ?? ""}`;
        if (key !== v.statKey) { // touch the DOM only when a number actually changed
          v.statKey = key;
          v.ms.textContent = (st.ms.toFixed(1) === "0.0" ? "0" : st.ms.toFixed(1)) + "ms";
          const t = Math.min(1, Math.max(0, Math.log10(1 + st.ms) / Math.log10(1 + 40))); // 0ms green → ~40ms red
          v.ms.style.setProperty("--lat", `hsl(${Math.round(120 - 120 * t)} 80% 50%)`);
          v.ms.style.setProperty("--lat-a", String(st.ms < 0.5 ? 0.3 : 0.45 + 0.55 * t));
          v.ms.classList.toggle("crit", st.ms >= 60);
          v.fid.textContent = st.fidelity == null ? "" : Math.round(st.fidelity * 100) + "%";
          v.fid.style.setProperty("--f", String(st.fidelity ?? 0));
          v.fid.classList.toggle("none", st.fidelity == null);
          this.showError(v, st);
        }
      }
      const seen = (v.seen ??= new Map()), busy = v.el.contains(document.activeElement); // a focused widget is never overwritten, so never memoise it
      for (const [k, set] of v.params) { const val = n.params[k]; if (busy || seen.get(k) !== val) { seen.set(k, val); set(val); } }
      // Previews are the costliest part of a frame, so nodes scrolled out of view skip painting (they repaint on the next pass once visible).
      if (!doPrev || !v.preview || !visible.has(id)) continue;
      if (n.bypass) { // bypassed: nothing is computed, so show what is passing through
        const ctx = v.preview.getContext("2d")!, lw = v.preview.width, lh = v.preview.height, rows = objRows(this.graph.inputValues(id));
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = "#07090d"; ctx.fillRect(0, 0, lw, lh);
        drawRows(ctx, 0, 0, lw, lh, rows.length ? rows : [["bypassed", "no input wired"]]);
      } else {
        const spec: NodeSpec = this.spec(n);
        // A resized node paints at its real on-screen size so previews can lay out more detail; otherwise a small logical size scaled up.
        const sized = !!n.h && v.preview.clientWidth > 0 && v.preview.clientHeight > 0;
        const [lw, lh] = sized ? [v.preview.clientWidth, v.preview.clientHeight] : spec.previewSize ?? [160, 100];
        const pr = pixelRatio(viewSettings().render.scale, window.devicePixelRatio || 1); // resolution follows the view settings
        const k = sized ? Math.min(3, pr) : Math.max(0.5, Math.min(4, (v.preview.clientWidth || lw) * pr / lw));
        const bw = Math.round(lw * k), bh = Math.round(lh * k);
        if (v.preview.width !== bw || v.preview.height !== bh) { v.preview.width = bw; v.preview.height = bh; }
        const ctx = v.preview.getContext("2d")!; ctx.setTransform(k, 0, 0, k, 0, 0);
        const outs = this.graph.outputs.get(id) ?? {};
        setPreviewSize(id, lw, lh);
        if (v.generic) { ctx.fillStyle = "#07090d"; ctx.fillRect(0, 0, lw, lh); drawRows(ctx, 0, 0, lw, lh, objRows(outs).length ? objRows(outs) : [["outputs", "none yet"]]); }
        else {
          profiler.span(`${spec.title} preview`, () => spec.preview!(ctx, lw, lh, this.graph.states.get(id), outs), id);
          const hp = spec.hover && previewPoint(id); // light up whatever the pointer is over
          if (hp) { try { spec.hover!(hp.p, lw, lh, this.graph.states.get(id), outs)?.mark?.(ctx); } catch { /* a hover glitch must never break painting */ } }
        }
      }
    }
    if (this.heat) this.paintHeat(now);
  }
}

/** Cheap structural fingerprint of a port value (typed arrays are sampled, so a 64-square belief stays exact and a camera frame stays cheap). */
export function signature(v: unknown): string {
  try {
    return JSON.stringify(v, (_k, x) => {
      if (ArrayBuffer.isView(x)) { const a = x as unknown as ArrayLike<number>, step = Math.max(1, Math.floor(a.length / 96)), out: number[] = [a.length]; for (let i = 0; i < a.length; i += step) out.push(a[i]); return out; }
      return x;
    })?.slice(0, 6000) ?? "";
  } catch { return ""; }
}

/** Wire look from the data it carries: solid = constant, long dashes = high certainty, shorter = partial, small dots = incomplete. */
export function wireClass(unchangedMs: number, fidelity: number | null): string {
  if (unchangedMs >= 4000) return "constant";
  if (fidelity == null) return "live";
  return fidelity >= 0.85 ? "sure" : fidelity >= 0.5 ? "part" : "weak";
}
