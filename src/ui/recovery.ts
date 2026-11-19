import type { Backup } from "../setup/backups";
import { ago } from "../setup/backups";
import { BUTTON_ICON, withIcon } from "./icons";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
const btn = (label: string, fn: () => void, cls = "") => { const b = el("button", cls, label); b.type = "button"; b.onclick = fn; return BUTTON_ICON[label] ? withIcon(b, BUTTON_ICON[label]) : b; };

/** A centred dialog with a title, message, optional details and actions. Replaces any earlier notice. Esc, the backdrop or Dismiss closes it. */
export function notify(message: string, actions: { label: string; run: () => void }[] = [], tone: "info" | "warn" = "info", opts: { title?: string; details?: string[]; onDismiss?: () => void } = {}) {
  document.querySelector(".notice")?.remove();
  const n = el("div", `notice ${tone}`); n.setAttribute("role", "alertdialog"); n.setAttribute("aria-modal", "true");
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  let acted = false;
  const close = () => { n.remove(); document.removeEventListener("keydown", onKey, true); if (!acted) opts.onDismiss?.(); };
  document.addEventListener("keydown", onKey, true);
  n.onclick = (e) => { if (e.target === n) close(); };
  const card = el("div", "notice-card");
  const title = opts.title ?? (tone === "warn" ? "Something needs your attention" : "Notice");
  card.append(el("h3", "notice-title", title), el("p", "notice-msg", message));
  if (opts.details?.length) { const ul = el("ul", "notice-details"); for (const d of opts.details) ul.append(el("li", "", d)); card.append(ul); }
  const row = el("div", "notice-actions");
  row.append(...actions.map((a) => btn(a.label, () => { acted = true; a.run(); close(); })), btn("Dismiss", close, actions.length ? "ghost" : ""));
  card.append(row); n.append(card);
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
  const note = el("p", "bk-note", "Your workflow is autosaved on every edit. Backups are extra restore points, taken every 5 minutes while you work, on exit, and before anything destructive. Restoring one also restores its settings, and first backs up what you have now.");

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
