import type { Tip, TipAction } from "../core/perfAdvisor";

const MAX = 4;

/** Fixed stack in the bottom-left corner. It floats over the page, so showing a toast never moves the layout. */
function stack(parent: HTMLElement) {
  let s = parent.querySelector<HTMLElement>(".toast-stack");
  if (!s) { s = document.createElement("div"); s.className = "toast-stack"; s.setAttribute("aria-live", "polite"); parent.append(s); }
  return s;
}

/**
 * Performance notification: a card that slides in over the page, stacks with others (newest on the bottom,
 * oldest dropped past four) and never steals focus. Unlike `notify` (a modal dialog) it can sit there while someone plays.
 */
export function showPerfToast(parent: HTMLElement, tip: Tip, run: (act: TipAction) => void, opts: { onMute: (id: string) => void; undo?: () => void; autoNote?: string }) {
  const host = stack(parent);
  host.querySelector(`[data-tip-id="${tip.id}"]`)?.remove();
  const el = document.createElement("div"); el.className = "perf-toast"; el.dataset.tipId = tip.id; el.setAttribute("role", "status");
  const close = () => { el.classList.add("out"); setTimeout(() => el.remove(), 180); };
  const btn = (label: string, fn: () => void, cls = "") => { const b = document.createElement("button"); b.type = "button"; b.className = `qe-btn ${cls}`.trim(); b.textContent = label; b.onclick = fn; return b; };
  const x = btn("×", close, "pt-x"); x.setAttribute("aria-label", "Dismiss");
  const head = document.createElement("strong"); head.textContent = tip.title;
  const body = document.createElement("span"); body.className = "pt-body"; body.textContent = opts.autoNote ?? tip.body;
  const row = document.createElement("div"); row.className = "pt-actions";
  if (opts.undo) row.append(btn("Undo", () => { opts.undo!(); close(); }));
  else for (const a of tip.actions) row.append(btn(a.label, () => { run(a.act); close(); }));
  row.append(btn("Don't suggest again", () => { opts.onMute(tip.id); close(); }, "ghost"));
  el.append(x, head, body, row);
  host.append(el);
  while (host.querySelectorAll(".perf-toast:not(.out)").length > MAX) host.querySelector(".perf-toast:not(.out)")!.remove();
  return el;
}
