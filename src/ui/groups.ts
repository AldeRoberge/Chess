import type { Graph } from "../core/graph";
import type { GroupDef } from "../core/types";
import { icon } from "./icons";
import { GROUP_COLORS, NODE_H, NODE_W, fitAround, nextGroupId, nodesInside, organize } from "../core/groups";

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };

export interface GroupHooks {
  graph: Graph;
  scale(): number;
  /** A node's box in world coordinates (measured from the DOM when it is on screen). */
  box(id: string): { x: number; y: number; w: number; h: number } | null;
  /** Re-apply a node's position to its element after the graph moved it. */
  place(id: string): void;
  track(el: HTMLElement, e: PointerEvent, move: (ev: PointerEvent) => void, end: (ev: PointerEvent | null) => void): void;
  /** Bypass (or switch back on) these nodes together. */
  bypass(ids: string[], on: boolean): void;
  changed(): void;
}

/**
 * Titled, coloured sections drawn behind the nodes. Drag the title bar to move a section together with the nodes
 * inside it, drag the corner to resize, double-click the title to rename, click the dot to recolour.
 * Section bodies ignore the pointer, so panning and wiring work straight through them.
 * The switch in the title bar bypasses every node inside the section at once (and back): a section is a part of the
 * patch that can be turned off as a whole. Wires into its nodes stay where they are, so switching it back on resumes at once.
 */
export class GroupLayer {
  readonly el = h("div", "ne-glayer");
  constructor(private o: GroupHooks) {}

  private get groups() { return this.o.graph.groups; }

  render() {
    this.el.replaceChildren(...this.groups.map((g) => this.build(g)));
  }

  /** Nodes inside a section, and whether all of them are bypassed (an empty section is never "off"). */
  members(g: GroupDef) { const ids = nodesInside({ nodes: [...this.o.graph.nodes.values()] }, g); return { ids, off: ids.length > 0 && ids.every((id) => !!this.o.graph.nodes.get(id)?.bypass) }; }

  /** Turns a section on or off as a whole. */
  setSectionBypass(id: string, on: boolean) {
    const g = this.groups.find((x) => x.id === id); if (!g) return false;
    this.o.bypass(this.members(g).ids, on); this.render(); return true;
  }

  /** New section around `ids` (or at `at` when nothing is selected), named and ready to rename. */
  add(ids: string[], at: { x: number; y: number }) {
    const boxes = ids.map((id) => this.o.box(id)).filter((b): b is NonNullable<typeof b> => !!b);
    const r = boxes.length ? fitAround(boxes) : { x: at.x - 180, y: at.y - 120, w: 360, h: 240 };
    const g: GroupDef = { id: nextGroupId(this.groups), title: "New section", color: GROUP_COLORS[this.groups.length % GROUP_COLORS.length], ...r };
    this.groups.push(g); this.render(); this.o.changed();
    this.rename(g, this.el.querySelector<HTMLElement>(`[data-g="${g.id}"] .ne-gname`)!);
    return g;
  }

  /** Lay the whole patch out in role bands, each in its own section. Replaces existing sections. */
  organize() {
    const json = this.o.graph.toJSON(); organize(json, (id) => { const b = this.o.box(id); return b ? { w: b.w, h: b.h } : null; });
    for (const n of json.nodes) { const m = this.o.graph.nodes.get(n.id)!; m.x = n.x; m.y = n.y; m.w = n.w; this.o.place(n.id); }
    this.o.graph.groups = json.groups ?? []; this.render(); this.o.changed();
  }

  private build(g: GroupDef) {
    const el = h("div", "ne-g"); el.dataset.g = g.id; this.frame(el, g);
    const bar = h("div", "ne-gt"); bar.dataset.tip = g.title; bar.dataset.tipBody = "Drag to move this section and the nodes inside it."; bar.dataset.tipHint = "Double-click the name to rename";
    const dot = h("button", "ne-gdot"); dot.type = "button"; dot.setAttribute("aria-label", "Section colour"); dot.dataset.tip = "Colour"; dot.dataset.tipBody = "Pick a colour for this section.";
    const name = h("span", "ne-gname", g.title);
    const del = h("button", "ne-gx", "✕"); del.type = "button"; del.setAttribute("aria-label", "Remove section"); del.dataset.tip = "Remove section"; del.dataset.tipBody = "Removes the frame only. Its nodes stay."; del.dataset.tipTag = "keeps nodes";
    const m = this.members(g);
    const sw = h("button", "ne-gb" + (m.off ? " off" : "")); sw.type = "button"; sw.innerHTML = icon("bypass", 15); sw.setAttribute("aria-label", m.off ? "Switch section on" : "Bypass section"); sw.setAttribute("aria-pressed", String(m.off));
    sw.dataset.tip = m.off ? "Section is off" : "Bypass section"; sw.dataset.tipBody = m.off ? "Every node in this section is bypassed. Click to switch them back on." : "Skip every node in this section without deleting anything. Click again to turn them back on.";
    bar.append(dot, name, sw, del);
    el.classList.toggle("off", m.off);
    const grip = h("div", "ne-gr"); grip.dataset.tip = "Resize section";
    el.append(bar, grip);

    dot.onpointerdown = (e) => e.stopPropagation();
    dot.onclick = (e) => { e.stopPropagation(); this.swatches(g, el, dot); };
    sw.onpointerdown = (e) => e.stopPropagation();
    sw.onclick = (e) => { e.stopPropagation(); this.setSectionBypass(g.id, !this.members(g).off); };
    del.onpointerdown = (e) => e.stopPropagation();
    del.onclick = (e) => { e.stopPropagation(); this.o.graph.groups = this.groups.filter((x) => x.id !== g.id); this.render(); this.o.changed(); };
    // double-click anywhere on the title bar renames (never opens the node palette)
    bar.ondblclick = (e) => { e.stopPropagation(); if ((e.target as HTMLElement).closest("button,input")) return; this.rename(g, bar.querySelector<HTMLElement>(".ne-gname") ?? name); };

    bar.addEventListener("pointerdown", (e) => {
      if (e.button > 0 || (e.target as HTMLElement).closest("button,input")) return;
      e.stopPropagation(); e.preventDefault();
      const ids = nodesInside({ nodes: [...this.o.graph.nodes.values()] }, g);
      const start = ids.map((id) => { const n = this.o.graph.nodes.get(id)!; return { n, x: n.x, y: n.y }; });
      const sx = e.clientX, sy = e.clientY, gx = g.x, gy = g.y, k = this.o.scale();
      this.o.track(bar, e, (ev) => {
        const dx = (ev.clientX - sx) / k, dy = (ev.clientY - sy) / k;
        g.x = gx + dx; g.y = gy + dy; this.frame(el, g);
        for (const s of start) { s.n.x = s.x + dx; s.n.y = s.y + dy; this.o.place(s.n.id); }
      }, (ev) => { if (ev) this.o.changed(); });
    });
    grip.addEventListener("pointerdown", (e) => {
      if (e.button > 0) return;
      e.stopPropagation(); e.preventDefault();
      const sx = e.clientX, sy = e.clientY, w0 = g.w, h0 = g.h, k = this.o.scale();
      this.o.track(grip, e, (ev) => { g.w = Math.max(160, w0 + (ev.clientX - sx) / k); g.h = Math.max(100, h0 + (ev.clientY - sy) / k); this.frame(el, g); }, (ev) => { if (ev) this.o.changed(); });
    });
    return el;
  }

  private frame(el: HTMLElement, g: GroupDef) {
    el.style.left = g.x + "px"; el.style.top = g.y + "px"; el.style.width = g.w + "px"; el.style.height = g.h + "px"; el.style.setProperty("--g", g.color);
  }

  private rename(g: GroupDef, name: HTMLElement) {
    const input = h("input", "ne-gedit"); input.type = "text"; input.value = g.title; input.maxLength = 60; input.setAttribute("aria-label", "Section title");
    let done = false;
    const finish = (save: boolean) => {
      if (done) return; done = true;
      const t = input.value.trim();
      if (save && t && t !== g.title) { g.title = t; this.o.changed(); }
      this.render();
    };
    input.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Enter") finish(true); else if (e.key === "Escape") finish(false); };
    input.onblur = () => finish(true);
    input.onpointerdown = (e) => e.stopPropagation();
    name.replaceWith(input); input.focus(); input.select();
  }

  private swatches(g: GroupDef, el: HTMLElement, anchor: HTMLElement) {
    el.querySelector(".ne-gpal")?.remove();
    const pal = h("div", "ne-gpal"); pal.onpointerdown = (e) => e.stopPropagation();
    for (const c of GROUP_COLORS) {
      const b = h("button", "ne-gsw" + (c === g.color ? " on" : "")); b.type = "button"; b.style.background = c; b.setAttribute("aria-label", c);
      b.onclick = (e) => { e.stopPropagation(); g.color = c; this.render(); this.o.changed(); };
      pal.append(b);
    }
    anchor.parentElement!.after(pal);
    const off = (e: Event) => { if (!pal.contains(e.target as Node)) { pal.remove(); document.removeEventListener("pointerdown", off, true); } };
    document.addEventListener("pointerdown", off, true);
  }
}

export { NODE_H, NODE_W };
