import "./contextMenu.css";
import { icon } from "./icons";

/** One row of a context menu. Rows read live state through `get()`, so a menu always shows what is current. */
type Ico = { icon?: string };
export type CtxItem =
  | (Ico & { kind: "action"; label: string; run(): void; disabled?: boolean; danger?: boolean; hint?: string })
  | (Ico & { kind: "toggle"; label: string; get(): boolean; set(v: boolean): void; hint?: string })
  | (Ico & { kind: "choice"; label: string; options: { value: string; label: string }[]; get(): string; set(v: string): void })
  | (Ico & { kind: "slider"; label: string; min: number; max: number; step: number; get(): number; set(v: number): void; fmt?: (v: number) => string })
  | (Ico & { kind: "color"; label: string; get(): string; set(v: string): void })
  | (Ico & { kind: "submenu"; label: string; items: CtxItem[] | (() => CtxItem[]) })
  | { kind: "separator" }
  | (Ico & { kind: "info"; label: string; value?: string });

export type Provider = (ev: MouseEvent) => CtxItem[] | null | undefined;

const providers = new Map<Element, Provider>();
let openMenu: { root: HTMLElement; close(): void } | null = null;

/** Menu for everything inside `el`. Inner providers come first; each outer one adds its rows after a separator. */
export function registerContextMenu(el: Element, p: Provider) { providers.set(el, p); return () => { providers.delete(el); }; }

export const sep: CtxItem = { kind: "separator" };

/** Joins groups of rows with separators, dropping empty groups. */
export function joinGroups(groups: CtxItem[][]): CtxItem[] {
  const out: CtxItem[] = [];
  for (const g of groups) if (g.length) { if (out.length) out.push(sep); out.push(...g); }
  return out;
}

/** Rows for the element under the pointer: every registered ancestor, innermost first. */
export function collectItems(target: Element | null, ev: MouseEvent): CtxItem[] {
  const groups: CtxItem[][] = [];
  for (let e = target; e; e = e.parentElement) {
    const p = providers.get(e);
    if (e.hasAttribute("data-no-context")) break;
    if (p) { const g = p(ev); if (g?.length) groups.push(g); }
  }
  return joinGroups(groups);
}

/** Native menu stays for text entry, and for Shift+right-click (escape hatch). */
export function wantsNativeMenu(ev: MouseEvent): boolean {
  if (ev.shiftKey) return true;
  const t = ev.target as HTMLElement | null;
  return !!t?.closest?.("textarea,[contenteditable=true],input:not([type=range]):not([type=checkbox]):not([type=color]):not([type=button])");
}

export function closeContextMenu() { openMenu?.close(); }
export const isContextMenuOpen = () => !!openMenu;

const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
const resolve = (i: CtxItem & { kind: "submenu" }) => (typeof i.items === "function" ? i.items() : i.items);
const interactive = (i: CtxItem) => i.kind !== "separator" && i.kind !== "info" && !(i.kind === "action" && i.disabled);

/** Where a menu of size w×h opened at (x,y) is placed so it stays inside the viewport. */
export function clampToViewport(x: number, y: number, w: number, h: number, vw: number, vh: number, pad = 6) {
  return { x: Math.max(pad, Math.min(x, vw - w - pad)), y: Math.max(pad, Math.min(y, vh - h - pad)) };
}


/** Icon for a row: its own `icon`, else the first keyword rule that matches its label. */
const RULES: [RegExp, string][] = [
  [/bypass/i, "bypass"], [/collapse/i, "collapse"], [/expand/i, "expand"], [/duplicate/i, "duplicate"], [/reset|default|original/i, "refresh"],
  [/copy/i, "copy"], [/delete|remove/i, "trash"], [/disconnect/i, "unlink"], [/undo/i, "undo"], [/redo/i, "redo"], [/timing/i, "perf"],
  [/workflows?/i, "list"], [/export/i, "export"], [/add node/i, "plus"], [/select all/i, "selectall"], [/view|camera/i, "camera"], [/room/i, "room"],
  [/sit|stand/i, "people"], [/board look|colou?r/i, "palette"], [/piece/i, "knight"], [/style/i, "palette"], [/perform|quality/i, "bolt"],
  [/resolution/i, "frame"], [/frame rate|fps/i, "clock"], [/shadow/i, "sun"], [/antialias/i, "scan"], [/display/i, "eye"], [/coordinat/i, "grid"],
  [/legal|dots/i, "step"], [/hint/i, "spark"], [/highlight|last/i, "eye"], [/frusta|projector/i, "cube"], [/preview/i, "film"], [/param/i, "sliders"],
  [/check/i, "check"], [/launch/i, "launch"], [/learn/i, "brain"], [/speak|voice|\bmic\b/i, "voice"], [/thunder/i, "bolt"], [/autoplay|play/i, "play"],
  [/commentat|narrat/i, "chat"], [/opponent|strength|computer/i, "opponent"], [/dmx|lamp|light/i, "lamp"], [/demo|game/i, "film"], [/mode|kind/i, "list"],
  [/option|setting/i, "sliders"], [/time|hour/i, "clock"], [/volume|sound|audio/i, "sound"], [/status|fidelity|confiden/i, "wave"],
];
export function iconFor(i: CtxItem): string {
  if (i.kind === "separator") return "";
  if (i.icon) return i.icon;
  return RULES.find(([r]) => r.test(i.label))?.[1] ?? (i.kind === "toggle" ? "toggle" : i.kind === "slider" ? "sliders" : i.kind === "color" ? "palette" : "chevron");
}

/** Every leaf row of a menu tree (submenus expanded) with the path that leads to it, for search. */
export function flatten(items: CtxItem[], path: string[] = []): { item: CtxItem; crumb: string }[] {
  const out: { item: CtxItem; crumb: string }[] = [];
  for (const it of items) {
    if (it.kind === "separator" || it.kind === "info") continue;
    if (it.kind === "submenu") out.push(...flatten(resolve(it), [...path, it.label]));
    else out.push({ item: it, crumb: path.join(" › ") });
  }
  return out;
}

/** Rows whose label or path contain every word typed, best (label hit, shorter path) first. */
export function searchItems(items: CtxItem[], query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const rank = (r: { item: CtxItem; crumb: string }) => (words.every((w) => (r.item as { label: string }).label.toLowerCase().includes(w)) ? 0 : 1) + r.crumb.length / 1000;
  return flatten(items)
    .filter((r) => { const hay = `${(r.item as { label: string }).label} ${r.crumb}`.toLowerCase(); return words.every((w) => hay.includes(w)); })
    .sort((x, y) => rank(x) - rank(y));
}

const SEARCH_AT = 5; // top-level menus with more selectable leaves than this get a search box

function build(items: CtxItem[], close: () => void, level: HTMLElement[], top = false): HTMLElement {
  const root = mk("div", "cm"); root.setAttribute("role", "menu"); root.tabIndex = -1;
  const list = mk("div", "cm-list"); let rows: { el: HTMLElement; item: CtxItem }[] = [];
  const refresh = () => rows.forEach((r) => r.el.dispatchEvent(new CustomEvent("cm-refresh")));

  const makeRow = (item: CtxItem, crumb?: string) => {
    if (item.kind === "separator") { const s = mk("div", "cm-sep"); s.setAttribute("role", "separator"); list.append(s); return; }
    const row = mk("div", "cm-row"); row.setAttribute("role", "menuitem"); row.tabIndex = -1;
    const ic = mk("span", "cm-ic"); ic.innerHTML = icon(iconFor(item), 15);
    const label = mk("span", "cm-label", item.label), val = mk("span", "cm-val");
    if (crumb) { const c = mk("span", "cm-crumb", crumb); label.append(c); }
    row.append(ic, label, val);
    const sync = () => {
      switch (item.kind) {
        case "toggle": row.setAttribute("aria-checked", String(item.get())); row.classList.toggle("on", item.get()); val.textContent = item.get() ? "✓" : ""; break;
        case "choice": val.textContent = item.options.find((o) => o.value === item.get())?.label ?? item.get(); break;
        case "slider": val.textContent = item.fmt ? item.fmt(item.get()) : String(item.get()); break;
        case "color": row.style.setProperty("--sw", item.get()); break;
        case "submenu": val.textContent = "›"; break;
        case "info": val.textContent = item.value ?? ""; break;
        case "action": row.classList.toggle("disabled", !!item.disabled); row.classList.toggle("danger", !!item.danger); break;
      }
    };
    row.addEventListener("cm-refresh", sync); sync();
    if (item.kind === "info") row.classList.add("info");
    if ("hint" in item && item.hint) row.title = item.hint;
    if (item.kind === "color") {
      const sw = mk("input", "cm-swatch"); sw.type = "color"; sw.value = item.get(); sw.oninput = () => item.set(sw.value); row.append(sw);
      row.onclick = (e) => { if (e.target !== sw) sw.click(); };
    } else if (item.kind === "slider") {
      const r = mk("input", "cm-range"); r.type = "range"; r.min = String(item.min); r.max = String(item.max); r.step = String(item.step); r.value = String(item.get());
      r.oninput = () => { item.set(Number(r.value)); sync(); }; r.onclick = (e) => e.stopPropagation(); row.append(r);
    } else if (item.kind === "submenu") {
      let sub: HTMLElement | null = null;
      const show = () => {
        if (sub) return; const r = row.getBoundingClientRect();
        sub = build(resolve(item), close, level); sub.classList.add("cm-sub"); document.body.append(sub); level.push(sub);
        const p = clampToViewport(r.right - 2, r.top - 4, sub.offsetWidth, sub.offsetHeight, innerWidth, innerHeight);
        sub.style.left = `${p.x}px`; sub.style.top = `${p.y}px`;
        sub.addEventListener("pointerleave", (e) => { if (!row.contains(e.relatedTarget as Node)) hide(); });
      };
      const hide = () => { if (sub) { sub.remove(); level.splice(level.indexOf(sub), 1); sub = null; } };
      row.addEventListener("pointerenter", show); row.onclick = show;
      row.addEventListener("pointerleave", (e) => { if (sub && !sub.contains(e.relatedTarget as Node)) hide(); });
    } else {
      row.onclick = () => {
        if (item.kind === "action") { if (item.disabled) return; close(); item.run(); }
        else if (item.kind === "toggle") { item.set(!item.get()); refresh(); }
        else if (item.kind === "choice") { const k = item.options.findIndex((o) => o.value === item.get()); item.set(item.options[(k + 1) % item.options.length].value); refresh(); }
      };
    }
    rows.push({ el: row, item }); list.append(row);
  };
  const fill = (entries: { item: CtxItem; crumb?: string }[]) => { list.replaceChildren(); rows = []; for (const e of entries) makeRow(e.item, e.crumb); };
  fill(items.map((item) => ({ item })));

  let search: HTMLInputElement | null = null;
  if (top && flatten(items).length > SEARCH_AT) {
    const box = mk("div", "cm-search"); const si = mk("span", "cm-ic"); si.innerHTML = icon("search", 14);
    search = mk("input"); search.type = "search"; search.placeholder = "Search actions…"; search.setAttribute("aria-label", "Search actions"); search.autocomplete = "off"; search.spellcheck = false;
    box.append(si, search); root.append(box);
    search.addEventListener("input", () => {
      const q = search!.value.trim();
      if (!q) { fill(items.map((item) => ({ item }))); return; }
      const hits = searchItems(items, q);
      if (!hits.length) { fill([{ item: { kind: "info", label: "No matches", icon: "search" } }]); return; }
      fill(hits);
    });
  }
  root.append(list);

  const focusables = () => rows.filter((r) => interactive(r.item)).map((r) => r.el);
  root.addEventListener("keydown", (e) => {
    const inSearch = e.target === search;
    const list2 = focusables(), cur = list2.indexOf(document.activeElement as HTMLElement);
    const go = (k: number) => list2[(k + list2.length) % list2.length]?.focus();
    if (e.key === "ArrowDown") { e.preventDefault(); go(cur + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); go(cur < 0 ? -1 : cur - 1); }
    else if (e.key === "Enter" && inSearch) { e.preventDefault(); list2[0]?.click(); }
    else if (e.key === "Escape" && inSearch && search!.value) { e.preventDefault(); e.stopPropagation(); search!.value = ""; search!.dispatchEvent(new Event("input")); }
    else if (inSearch) return;
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (document.activeElement as HTMLElement)?.click(); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const r = rows.find((x) => x.el === document.activeElement); if (!r) return; const it = r.item, d = e.key === "ArrowRight" ? 1 : -1;
      if (it.kind === "slider") { it.set(Math.min(it.max, Math.max(it.min, +(it.get() + d * it.step).toFixed(4)))); r.el.dispatchEvent(new CustomEvent("cm-refresh")); const rg = r.el.querySelector("input"); if (rg) rg.value = String(it.get()); e.preventDefault(); }
      else if (it.kind === "choice") { const k = it.options.findIndex((o) => o.value === it.get()); it.set(it.options[(k + d + it.options.length) % it.options.length].value); r.el.dispatchEvent(new CustomEvent("cm-refresh")); e.preventDefault(); }
    } else if (search && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { search.focus(); } // type anywhere to search
  });
  return root;
}

/** Opens the menu at a screen position; closes on Esc, outside click, scroll, resize or blur. */
export function openContextMenu(x: number, y: number, items: CtxItem[]) {
  closeContextMenu();
  if (!items.length) return null;
  const level: HTMLElement[] = [];
  const ac = new AbortController();
  const close = () => { ac.abort(); level.forEach((l) => l.remove()); openMenu = null; };
  const root = build(items, close, level, true); level.push(root); document.body.append(root);
  const p = clampToViewport(x, y, root.offsetWidth, root.offsetHeight, innerWidth, innerHeight);
  root.style.left = `${p.x}px`; root.style.top = `${p.y}px`;
  openMenu = { root, close };
  const opts = { signal: ac.signal, capture: true } as const;
  document.addEventListener("pointerdown", (e) => { if (!level.some((l) => l.contains(e.target as Node))) close(); }, opts);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); close(); } }, opts);
  window.addEventListener("blur", close, { signal: ac.signal });
  window.addEventListener("resize", close, { signal: ac.signal });
  window.addEventListener("wheel", (e) => { if (!level.some((l) => l.contains(e.target as Node))) close(); }, { signal: ac.signal, passive: true });
  (root.querySelector<HTMLInputElement>(".cm-search input") ?? root).focus({ preventScroll: true });
  return { close, root };
}

let installed = false;
/** One listener for the whole page: shows the merged menu for the element under the pointer. */
export function installContextMenus(doc: Document = document) {
  if (installed) return; installed = true;
  doc.addEventListener("contextmenu", (ev) => {
    if (wantsNativeMenu(ev)) return;
    ev.preventDefault();
    const items = collectItems(ev.target as Element, ev);
    if (items.length) openContextMenu(ev.clientX, ev.clientY, items);
  });
}
