import type { Backup } from "../setup/backups";
import { ago } from "../setup/backups";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
const btn = (label: string, fn: () => void, cls = "") => { const b = el("button", cls, label); b.type = "button"; b.onclick = fn; return b; };

/** A quiet bar at the bottom of the screen with a message and optional actions. Replaces any earlier notice. */
export function notify(message: string, actions: { label: string; run: () => void }[] = [], tone: "info" | "warn" = "info") {
  document.querySelector(".notice")?.remove();
  const n = el("div", `notice ${tone}`); n.setAttribute("role", "status");
  const close = () => n.remove();
  n.append(el("span", "notice-msg", message), ...actions.map((a) => btn(a.label, () => { a.run(); close(); })), btn("Dismiss", close, "ghost"));
  document.body.append(n);
  return n;
}

export interface PanelApi {
  list(): Backup[];
  restore(b: Backup): void;
  remove(b: Backup): void;
  backupNow(): void;
  exportFile(): void;
  importFile(file: File): void;
}

/** Modal list of backups with restore / delete / back up now / import / export. Esc or the backdrop closes it. */
export function openBackupPanel(api: PanelApi) {
  document.querySelector(".bk")?.remove();
  const root = el("div", "bk"), card = el("div", "bk-card"); card.setAttribute("role", "dialog"); card.setAttribute("aria-label", "Backups");
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  const close = () => { root.remove(); document.removeEventListener("keydown", onKey, true); };
  document.addEventListener("keydown", onKey, true);
  root.onclick = (e) => { if (e.target === root) close(); };

  const head = el("div", "bk-head"); head.append(el("h3", "", "Backups"), btn("Close", close, "ghost"));
  const bar = el("div", "bk-bar");
  const file = el("input"); file.type = "file"; file.accept = "application/json,.json"; file.hidden = true;
  file.onchange = () => { const f = file.files?.[0]; if (f) { api.importFile(f); close(); } };
  bar.append(btn("Back up now", () => { api.backupNow(); draw(); }), btn("Import file…", () => file.click()), btn("Export file", api.exportFile), file);
  const list = el("div", "bk-list");
  const note = el("p", "bk-note", "Your workflow is autosaved on every edit. Backups are extra restore points, taken every 5 minutes while you work, on exit, and before anything destructive. Restoring one also restores its setup, and first backs up what you have now.");

  const draw = () => {
    const items = api.list();
    list.replaceChildren(...(items.length ? items.map((b) => {
      const row = el("div", "bk-row"), info = el("div", "bk-info");
      info.append(el("b", "", b.reason), el("span", "", `${ago(b.t)} · ${new Date(b.t).toLocaleTimeString()} · ${b.graph.nodes.length} nodes`));
      row.append(info, btn("Restore", () => { api.restore(b); close(); }), btn("Delete", () => { api.remove(b); draw(); }, "ghost"));
      return row;
    }) : [el("p", "bk-empty", "No backups yet.")]));
  };
  draw();
  card.append(head, bar, list, note); root.append(card); document.body.append(root);
  return { close, draw, root };
}
