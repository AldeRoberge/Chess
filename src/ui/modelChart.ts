import type { ModelInfo } from "../core/types";

export interface ModelChartOpts {
  title: string;
  current: string;
  models: ModelInfo[];
  /** Called with the chosen model id; the modal then closes. */
  pick: (id: string) => void;
}

const fmt = (usd: number) => `$${usd.toFixed(2)}`;

/** Modal bar chart of price per 1M tokens (input and output) for each model. Click a row to select that model. */
export function openModelChart(o: ModelChartOpts) {
  const back = document.createElement("div"); back.className = "qe-back";
  const box = document.createElement("div"); box.className = "qe";
  const head = document.createElement("div"); head.className = "qe-head"; head.textContent = o.title;
  const hint = document.createElement("div"); hint.className = "qe-hint";
  hint.textContent = "Price per 1M tokens (USD). Bars are on one scale; click a model to select it. Speed and quality are not published by the API, so only cost is shown.";
  const list = document.createElement("div"); list.className = "mc-list"; list.setAttribute("role", "listbox");
  const priced = o.models.filter((m) => m.input !== undefined && m.output !== undefined);
  const top = Math.max(0.01, ...priced.map((m) => Math.max(m.input ?? 0, m.output ?? 0)));
  const bar = document.createElement("div"); bar.className = "qe-bar";
  const cancel = document.createElement("button"); cancel.className = "qe-btn"; cancel.textContent = "Close";
  bar.append(cancel);

  const close = () => { document.removeEventListener("keydown", key, true); back.remove(); };
  const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); close(); } };
  for (const m of o.models) {
    const row = document.createElement("button"); row.type = "button"; row.className = "mc-row" + (m.id === o.current ? " on" : "");
    row.setAttribute("role", "option"); row.setAttribute("aria-selected", String(m.id === o.current));
    const name = document.createElement("span"); name.className = "mc-name"; name.textContent = m.id;
    const cost = document.createElement("span"); cost.className = "mc-cost";
    const track = (cls: string, v: number | undefined, label: string) => {
      const t = document.createElement("span"); t.className = "mc-track";
      const f = document.createElement("span"); f.className = `mc-fill ${cls}`; f.style.width = v === undefined ? "0" : `${(v / top) * 100}%`;
      t.append(f); const l = document.createElement("span"); l.className = "mc-lab"; l.textContent = v === undefined ? "" : `${label} ${fmt(v)}`;
      return [t, l] as const;
    };
    if (m.input === undefined || m.output === undefined) cost.textContent = "no price listed";
    else {
      const [ti, li] = track("in", m.input, "in"), [to, lo] = track("out", m.output, "out");
      cost.append(ti, li, to, lo);
    }
    row.append(name, cost);
    row.onclick = () => { o.pick(m.id); close(); };
    list.append(row);
  }
  if (!o.models.length) { const none = document.createElement("div"); none.className = "qe-hint"; none.textContent = "No models yet. Enter an API key and wait for the list to load."; list.append(none); }

  box.append(head, hint, list, bar);
  back.append(box); document.body.append(back);
  document.addEventListener("keydown", key, true);
  back.addEventListener("pointerdown", (e) => { if (e.target === back) close(); });
  cancel.onclick = close;
  list.querySelector<HTMLButtonElement>(".mc-row.on")?.focus();
}
