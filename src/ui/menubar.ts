import { icon } from "./icons";
import { APP_THEMES, MODES } from "./appTheme";
import { COACH_LEVELS, coachSettings, setCoachSettings } from "../narrator/coachSettings";

/**
 * The top menu bar: File, Edit, View, Tools. Every item is a real <button> in the page (hidden while its menu is shut)
 * and keeps the id the old ribbon used, so app.ts wires them with `getElementById(id).onclick` and the assistant can still click them.
 */
export interface MenuItem {
  id?: string;
  /** A function is re-read each time the menu opens, for rows that show a setting's current value. */
  label: string | (() => string);
  /** Runs on click for rows that have no existing button to drive (the commentary settings). */
  run?: () => void;
  keys?: string;
  /** Icon name from icons.ts, drawn in the 16px slot at the left. */
  icon?: string;
  /** Longer explanation shown as a tooltip. */
  tip?: string;
  danger?: boolean;
  /** Starts disabled; app.ts enables it when there is something to do (undo and redo). */
  disabled?: boolean;
  /** A tick (✓) shows while the item has the `on` class: "box" for on/off settings, "radio" for one-of-many. */
  check?: "box" | "radio";
  data?: Record<string, string>;
  /** Items and separators that share a group can be shown or hidden together (`[data-group]`). */
  group?: string;
}
export interface MenuSub { label: string; icon?: string; items: MenuEntry[] }
export interface MenuSep { sep: true; group?: string }
export type MenuEntry = MenuItem | MenuSub | MenuSep;
export interface MenuDef { id: string; label: string; entries: MenuEntry[] }

/** Off → Beginner → … → Expert → Off. */
export function cycleCoachLevel() {
  const i = COACH_LEVELS.findIndex((l) => l.value === coachSettings().level);
  setCoachSettings({ level: COACH_LEVELS[(i + 1) % COACH_LEVELS.length].value });
}
const coachLabel = () => `Commentary: ${COACH_LEVELS.find((l) => l.value === coachSettings().level)?.label ?? "Off"}`;
const talksLabel = () => `AI opponent talks: ${coachSettings().opponentTalks ? "on" : "off"}`;

const SEP: MenuSep = { sep: true };
const isSep = (e: MenuEntry): e is MenuSep => "sep" in e;
const isSub = (e: MenuEntry): e is MenuSub => "items" in e;

export const MENUS: MenuDef[] = [
  {
    id: "file", label: "File", entries: [
      { id: "aiwiz", icon: "wand", label: "New workflow with AI…", tip: "Describe what you want and a model drafts the workflow. You review it before anything changes." },
      {
        label: "Open", icon: "open", items: [
          { id: "openfile", label: "File…", keys: "Ctrl+O", tip: "Load a workflow file you saved earlier. The current one is backed up first." },
          { id: "workflows", label: "Ready-made workflow…", tip: "Pick a workflow made for a purpose, such as playing against a bot or tracking a board with cameras. The current one is backed up first." },
          { id: "backups", label: "Restore point…", tip: "Earlier versions of your workflow, crash recovery, import and export." },
        ],
      },
      SEP,
      { id: "export", icon: "save", label: "Save", keys: "Ctrl+S", tip: "Download the workflow as a JSON file you can keep or share. The File menu shows a dot when there are changes since the last backup." },
      { id: "backupnow", label: "Back up now", tip: "Keep a restore point of the workflow as it is right now." },
      SEP,
      { id: "reset", icon: "refresh", label: "Reset workflow…", danger: true, tip: "Discards your saved node layout and settings, then reloads the page." },
    ],
  },
  {
    id: "edit", label: "Edit", entries: [
      { id: "undo", disabled: true, icon: "undo", label: "Undo", keys: "Ctrl+Z", tip: "Step back through your edits to the workflow." },
      { id: "redo", disabled: true, icon: "redo", label: "Redo", keys: "Ctrl+Y", tip: "Bring back an edit you undid." },
      // these only exist while nodes are selected, so the menu never lists actions that cannot run
      { sep: true, group: "sel" },
      { id: "seldup", group: "sel", icon: "duplicate", label: "Duplicate", tip: "Copy the selected nodes next to themselves, with the same settings." },
      { id: "selbypass", group: "sel", icon: "bypass", label: "Bypass", check: "box", tip: "Skip the selected nodes without deleting them. Choose it again to turn them back on." },
      { id: "seldel", group: "sel", icon: "trash", label: "Delete", danger: true, tip: "Remove the selected nodes and their wires." },
      { sep: true, group: "graph" },
      { id: "organize", group: "graph", icon: "grid", label: "Organize workflow", tip: "Lay the workflow out in bands: input, analysis, game, output. Undo with Ctrl+Z." },
      { id: "addsec", group: "graph", icon: "frame", label: "Add section", tip: "Wrap the selected nodes (or the middle of the view) in a titled, coloured frame." },
    ],
  },
  {
    id: "view", label: "View", entries: [
      { id: "nodesview", check: "box", label: "Show nodes", tip: "Show the node editor next to the table. Off (the default) is the simple view: just the board, the log and the assistant, and the editor is not drawn, which keeps the app light." },
      { id: "heat", check: "box", label: "Node timings", tip: "Show each node's cost on the workflow: a share bar, a sparkline of recent ticks, and avg / p95 / max milliseconds." },
      SEP,
      { label: "Theme", icon: "contrast", items: APP_THEMES.map((t) => ({ label: t.name, check: "radio" as const, data: { "pick-theme": t.id } })) },
      { label: "Appearance", icon: "eye", items: MODES.map((m) => ({ label: m === "system" ? "Match system" : m[0].toUpperCase() + m.slice(1), check: "radio" as const, data: { "pick-mode": m } })) },
      SEP,
      { id: "coachlevel", label: coachLabel, run: cycleCoachLevel, tip: "How much the commentator explains: Off, Beginner, Intermediate, Advanced or Expert. Each click moves to the next level." },
      { id: "opptalks", label: talksLabel, run: () => setCoachSettings({ opponentTalks: !coachSettings().opponentTalks }), tip: "Lets the AI opponent talk during the game." },
    ],
  },
  {
    id: "tools", label: "Tools", entries: [
      { id: "settings", icon: "setup", label: "Settings…", tip: "Cameras, projector, narration, and players." },
      { id: "calibrate", icon: "target", label: "Calibrate…", tip: "Line up the cameras with the board." },
      { id: "alignall", icon: "board", label: "Align boards on all cameras…", tip: "Finds the board grid on every camera at once. This is heavy: it runs several boards in parallel (up to 8 on a powerful computer), so a slower computer can freeze for a moment." },
      { id: "phone", icon: "people", label: "Phone remote…", tip: "Watch the moves, see the camera and play from a phone on the same Wi-Fi." },
      SEP,
      { id: "audio", icon: "sound", label: "Enable sound", tip: "Browsers keep audio locked until you click. The first click starts the engine; after that it mutes and unmutes." },
      { id: "mixer", icon: "wave", label: "Mixer…", tip: "Levels for master, ambience, sound effects, music and narrators, plus mute." },
    ],
  },
];

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function itemHtml(e: MenuItem): string {
  const text = typeof e.label === "function" ? e.label() : e.label;
  const attrs = [
    e.id ? `id="${e.id}"` : "",
    e.group ? `data-group="${e.group}"` : "",
    `data-tip="${esc(text.replace(/…$/, ""))}"`,
    e.tip ? `data-tip-body="${esc(e.tip)}"` : "",
    e.disabled ? "disabled" : "",
    e.danger ? `data-tip-tag="destructive" data-tip-color="#ff7070"` : "",
    ...Object.entries(e.data ?? {}).map(([k, v]) => `data-${k}="${esc(v)}"`),
    e.check ? `role="menuitem${e.check === "radio" ? "radio" : "checkbox"}" aria-checked="false"` : `role="menuitem"`,
  ].filter(Boolean).join(" ");
  const slot = e.check ? `<span class="mb-ck" aria-hidden="true"></span>` : e.icon ? icon(e.icon, 16) : `<span class="mb-ic" aria-hidden="true"></span>`;
  return `<button type="button" class="mb-item${e.danger ? " danger" : ""}" ${attrs}>${slot}<span class="lbl">${esc(text)}</span>${e.keys ? `<kbd>${esc(e.keys)}</kbd>` : ""}</button>`;
}

function entryHtml(e: MenuEntry): string {
  if (isSep(e)) return `<div class="mb-sep" role="separator"${e.group ? ` data-group="${e.group}"` : ""}></div>`;
  if (isSub(e)) {
    const slot = e.icon ? icon(e.icon, 16) : `<span class="mb-ic" aria-hidden="true"></span>`;
    return `<div class="mb-sub"><button type="button" class="mb-item" role="menuitem" aria-haspopup="menu" aria-expanded="false">${slot}<span class="lbl">${esc(e.label)}</span><span class="mb-arrow" aria-hidden="true">▸</span></button>`
      + `<div class="mb-menu mb-flyout" role="menu" aria-label="${esc(e.label)}" hidden>${e.items.map(entryHtml).join("")}</div></div>`;
  }
  return itemHtml(e);
}

/** The whole bar as HTML for app.ts to drop into the header. */
export function menuBarHtml(defs: MenuDef[] = MENUS): string {
  return `<nav class="mb" role="menubar" aria-label="Menu">${defs.map((m) => `<div class="mb-top" data-menu="${m.id}"><button type="button" class="mb-title" role="menuitem" aria-haspopup="menu" aria-expanded="false" id="menu-${m.id}">${esc(m.label)}</button>`
    + `<div class="mb-menu" role="menu" aria-labelledby="menu-${m.id}" hidden>${m.entries.map(entryHtml).join("")}</div></div>`).join("")}</nav>`;
}

/** Turn a tick on or off on a check item, keeping the screen-reader state in step. */
export function setChecked(el: Element | null, on: boolean) {
  if (!el) return;
  el.classList.toggle("on", on);
  el.setAttribute("aria-checked", String(on));
}

/** Open the menu (and submenu) that holds `el`, so a search result can point at it. */
export function revealInMenu(el: Element) {
  const top = el.closest<HTMLElement>(".mb-top");
  if (!top) return;
  const title = top.querySelector<HTMLButtonElement>(":scope > .mb-title")!;
  if (!top.classList.contains("open")) title.click();
  const parent = el.closest(".mb-flyout")?.previousElementSibling as HTMLElement | null | undefined;
  if (parent && parent.getAttribute("aria-expanded") !== "true") parent.click();
}

/** Behaviour: click to open, hover to switch while one is open, arrow keys, Escape and outside click to close. */
export function initMenuBar(bar: HTMLElement, defs: MenuDef[] = MENUS) {
  // rows with a function label are refreshed when their menu opens; rows with `run` are wired here
  const live: [HTMLElement, () => string][] = [];
  const scan = (entries: MenuEntry[]) => {
    for (const e of entries) {
      if (isSep(e)) continue;
      if (isSub(e)) { scan(e.items); continue; }
      const el = e.id ? bar.querySelector<HTMLElement>(`#${e.id}`) : null; if (!el) continue;
      if (e.run) el.addEventListener("click", e.run);
      if (typeof e.label === "function") live.push([el.querySelector<HTMLElement>(".lbl")!, e.label]);
    }
  };
  for (const d of defs) scan(d.entries);
  const tops = () => [...bar.querySelectorAll<HTMLElement>(":scope > .mb-top")];
  const titleOf = (t: HTMLElement) => t.querySelector<HTMLButtonElement>(":scope > .mb-title")!;
  const menuOf = (t: HTMLElement) => t.querySelector<HTMLElement>(":scope > .mb-menu")!;
  let current: HTMLElement | null = null;
  /** When hover last opened a menu: the click that usually follows on the same title must not shut it again. */
  let hoverOpenedAt = -Infinity;
  const justHovered = () => performance.now() - hoverOpenedAt < 500;

  const closeFlyouts = (root: ParentNode, except?: Element | null) => {
    for (const f of root.querySelectorAll<HTMLElement>(".mb-flyout")) {
      if (f === except) continue;
      f.hidden = true; (f.previousElementSibling as HTMLElement | null)?.setAttribute("aria-expanded", "false");
    }
  };
  const close = (refocus = false) => {
    const t = current; if (!t) return;
    current = null; menuOf(t).hidden = true; t.classList.remove("open"); titleOf(t).setAttribute("aria-expanded", "false"); closeFlyouts(t);
    if (refocus) titleOf(t).focus();
  };
  /** Selectable rows of one menu level: skips separators, disabled rows and rows hidden by their group. */
  const rows = (menu: Element) => [...menu.querySelectorAll<HTMLButtonElement>(":scope > .mb-item, :scope > .mb-sub > .mb-item")].filter((b) => !b.disabled && !b.hidden);
  const open = (t: HTMLElement, focusFirst = false) => {
    if (current !== t) {
      close();
      current = t;
      for (const [span, f] of live) span.textContent = f();
      const m = menuOf(t); m.hidden = false; t.classList.add("open"); titleOf(t).setAttribute("aria-expanded", "true");
      m.style.setProperty("--mb-y", `${bar.closest("header")?.getBoundingClientRect().bottom ?? 48}px`); // narrow screens pin the menu under the header
    }
    if (focusFirst) rows(menuOf(t))[0]?.focus();
  };
  const openSub = (btn: HTMLElement, focusFirst = false) => {
    const fly = btn.nextElementSibling as HTMLElement | null; if (!fly?.classList.contains("mb-flyout")) return;
    closeFlyouts(btn.closest(".mb-menu")!, fly);
    fly.hidden = false; btn.setAttribute("aria-expanded", "true");
    if (focusFirst) rows(fly)[0]?.focus();
  };

  bar.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button"); if (!b || !bar.contains(b)) return;
    if (b.classList.contains("mb-title")) { const t = b.parentElement as HTMLElement; if (current === t) { if (!justHovered()) close(); } else open(t); return; }
    if (b.hasAttribute("aria-haspopup")) { openSub(b); return; } // a submenu stays open until you leave it, pick something, or press Escape
    if (!b.disabled) close(); // a real command ran (its own onclick fired first)
  });
  bar.addEventListener("pointerover", (e) => {
    if ((e as PointerEvent).pointerType === "touch") return;
    const target = e.target as HTMLElement;
    const title = target.closest<HTMLButtonElement>(".mb-title");
    if (title && current && current !== title.parentElement) { hoverOpenedAt = performance.now(); open(title.parentElement as HTMLElement); return; }
    const item = target.closest<HTMLButtonElement>(".mb-item");
    if (!item || !current) return;
    if (item.hasAttribute("aria-haspopup")) openSub(item); else if (!item.closest(".mb-flyout")) closeFlyouts(item.closest(".mb-menu")!);
  });
  document.addEventListener("pointerdown", (e) => { if (current && !bar.contains(e.target as Node)) close(); });
  window.addEventListener("blur", () => close());

  bar.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement, key = e.key;
    const top = t.closest<HTMLElement>(".mb-top"); if (!top) return;
    const all = tops(), at = all.indexOf(top), onTitle = t.classList.contains("mb-title");
    const go = (n: number, openIt: boolean) => { const next = all[(n + all.length) % all.length]; if (openIt) open(next, true); else titleOf(next).focus(); };
    const menu = t.closest<HTMLElement>(".mb-menu");
    const move = (d: number) => { if (!menu) return; const r = rows(menu), i = r.indexOf(t as HTMLButtonElement); r[(i + d + r.length) % r.length]?.focus(); };
    if (key === "Escape") { if (current) { e.preventDefault(); const fly = t.closest<HTMLElement>(".mb-flyout"); if (fly) { fly.hidden = true; const p = fly.previousElementSibling as HTMLElement; p.setAttribute("aria-expanded", "false"); p.focus(); } else close(true); } return; }
    if (key === "ArrowRight") {
      e.preventDefault();
      if (!onTitle && t.hasAttribute("aria-haspopup")) openSub(t, true); else go(at + 1, !!current);
    } else if (key === "ArrowLeft") {
      e.preventDefault();
      const fly = t.closest<HTMLElement>(".mb-flyout");
      if (fly) { fly.hidden = true; const p = fly.previousElementSibling as HTMLElement; p.setAttribute("aria-expanded", "false"); p.focus(); } else go(at - 1, !!current);
    } else if (key === "ArrowDown") { e.preventDefault(); if (onTitle) open(top, true); else move(1); }
    else if (key === "ArrowUp") { e.preventDefault(); if (onTitle) { open(top); const r = rows(menuOf(top)); r[r.length - 1]?.focus(); } else move(-1); }
    else if ((key === "Home" || key === "End") && !onTitle) { e.preventDefault(); const r = rows(menu!); (key === "Home" ? r[0] : r[r.length - 1])?.focus(); }
    else if (key === "Tab") close();
  });
  return { close };
}
