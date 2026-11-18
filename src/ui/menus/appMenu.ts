import type { CtxItem } from "../contextMenu";

const click = (id: string) => () => document.getElementById(id)?.click();
const off = (id: string) => !!(document.getElementById(id) as HTMLButtonElement | null)?.disabled;

/** Rows every right-click gets at the end: copy, undo/redo and the workflow actions (they drive the top-bar buttons). */
export function appMenu(ev: MouseEvent): CtxItem[] {
  const sel = window.getSelection()?.toString() ?? "";
  const chip = (ev.target as HTMLElement | null)?.closest?.(".chip") as HTMLElement | null;
  const copy = sel || chip?.textContent || "";
  const heat = document.getElementById("heat");
  return [
    ...(copy ? [{ kind: "action" as const, label: sel ? "Copy" : "Copy value", run: () => void navigator.clipboard?.writeText(copy.trim()) }] : []),
    { kind: "action", label: "Undo", disabled: off("undo"), hint: off("undo") ? "Nothing to undo yet. Edits to the workflow are recorded here as you make them." : undefined, run: click("undo") },
    { kind: "action", label: "Redo", disabled: off("redo"), hint: off("redo") ? "Nothing to redo. Redo brings back an edit you just undid." : undefined, run: click("redo") },
    ...(heat ? [{ kind: "toggle" as const, label: "Node timings", get: () => heat.classList.contains("on"), set: () => heat.click() }] : []),
    {
      kind: "submenu", label: "Workflow", items: [
        { kind: "action", label: "Workflows…", run: click("workflows") },
        { kind: "action", label: "Save workflow to file", run: click("export") },
        { kind: "action", label: "Reset workflow", danger: true, run: click("reset") },
      ],
    },
  ];
}
