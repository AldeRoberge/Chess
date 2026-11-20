/** Windows-style menu bar (File, Edit, View, Tools). Every row drives an existing ribbon button by id, so behavior stays in one place. */
type Row = { label: string; id?: string; keys?: string; danger?: boolean; run?: () => void } | "-";
export type MenuDef = { name: string; rows: Row[] };

export const MENUS: MenuDef[] = [
  { name: "File", rows: [
    { label: "Open…", id: "openfile", keys: "Ctrl+O" },
    { label: "Save", id: "export", keys: "Ctrl+S" },
    "-",
    { label: "Demos…", id: "workflows" },
    { label: "Build with AI…", id: "aiwiz" },
    "-",
    { label: "Restore points…", id: "backups" },
    { label: "Backup now", id: "backupnow" },
    "-",
    { label: "Reset workflow", id: "reset", danger: true },
  ] },
  { name: "Edit", rows: [
    { label: "Undo", id: "undo", keys: "Ctrl+Z" },
    { label: "Redo", id: "redo", keys: "Ctrl+Y" },
    "-",
    { label: "Duplicate", id: "seldup" },
    { label: "Bypass", id: "selbypass" },
    { label: "Delete", id: "seldel", danger: true },
    "-",
    { label: "Organize", id: "organize" },
    { label: "New section", id: "addsec" },
  ] },
  { name: "View", rows: [
    { label: "Show nodes", id: "nodesview" },
    { label: "Node timings", id: "heat" },
    "-",
    { label: "Light / dark", id: "mode" },
  ] },
  { name: "Tools", rows: [
    { label: "Play now against bot", id: "playnow" },
    { label: "Settings…", id: "settings" },
    "-",
    { label: "Calibrate", id: "calibrate" },
    { label: "Align all boards", id: "alignall" },
    { label: "Phone remote", id: "phone" },
    "-",
    { label: "Sound", id: "audio" },
    { label: "Mixer", id: "mixer" },
  ] },
];

/** Builds the bar into `host`. Hover switches menus once one is open, like Windows. */
export function installMenuBar(host: HTMLElement, defs: MenuDef[] = MENUS) {
  const bar = document.createElement("div");
  bar.className = "menubar"; bar.setAttribute("role", "menubar");
  let open: HTMLElement | null = null;
  const closeAll = () => { open = null; for (const w of bar.querySelectorAll<HTMLElement>(".mb-item")) { w.classList.remove("open"); w.querySelector("button")!.setAttribute("aria-expanded", "false"); w.querySelector<HTMLElement>(".mb-drop")!.hidden = true; } };
  const show = (w: HTMLElement) => {
    closeAll(); open = w; w.classList.add("open"); w.querySelector("button")!.setAttribute("aria-expanded", "true");
    const drop = w.querySelector<HTMLElement>(".mb-drop")!; drop.hidden = false;
    for (const b of drop.querySelectorAll<HTMLButtonElement>("button[data-for]")) b.disabled = !!(document.getElementById(b.dataset.for!) as HTMLButtonElement | null)?.disabled || !document.getElementById(b.dataset.for!);
  };
  for (const d of defs) {
    const w = document.createElement("div"); w.className = "mb-item";
    const t = document.createElement("button"); t.type = "button"; t.className = "mb-title"; t.textContent = d.name; t.setAttribute("aria-haspopup", "menu"); t.setAttribute("aria-expanded", "false");
    const drop = document.createElement("div"); drop.className = "mb-drop"; drop.setAttribute("role", "menu"); drop.hidden = true;
    for (const r of d.rows) {
      if (r === "-") { const s = document.createElement("div"); s.className = "mb-sep"; s.setAttribute("role", "separator"); drop.append(s); continue; }
      const b = document.createElement("button"); b.type = "button"; b.setAttribute("role", "menuitem");
      if (r.id) b.dataset.for = r.id;
      if (r.danger) b.classList.add("danger");
      const l = document.createElement("span"); l.textContent = r.label; b.append(l);
      if (r.keys) { const k = document.createElement("kbd"); k.textContent = r.keys; b.append(k); }
      b.onclick = () => { closeAll(); if (r.run) r.run(); else if (r.id) document.getElementById(r.id)?.click(); };
      drop.append(b);
    }
    t.onclick = () => (open === w ? closeAll() : show(w));
    t.onmouseenter = () => { if (open && open !== w) show(w); };
    w.append(t, drop); bar.append(w);
  }
  document.addEventListener("pointerdown", (e) => { if (open && !bar.contains(e.target as Node)) closeAll(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && open) closeAll(); });
  host.prepend(bar);
  return { bar, closeAll };
}
