/** Drag the right edge of a header cell to resize columns. The next column gives up (or takes) the width so the table keeps its size.
 *  Widths are remembered per `key` so they survive the table being rebuilt on re-render. Double-click a handle to reset. */
const saved = new Map<string, number[]>();
const MIN = 36;

export function resizableColumns(table: HTMLTableElement, key: string) {
  const ths = [...table.querySelectorAll<HTMLElement>("thead th")];
  if (ths.length < 2) return;
  const apply = (w: number[]) => { table.style.tableLayout = "fixed"; ths.forEach((th, i) => { th.style.width = `${w[i]}px`; }); };
  const prev = saved.get(key);
  if (prev && prev.length === ths.length) apply(prev);
  ths.slice(0, -1).forEach((th, i) => {
    th.style.position = "relative";
    const h = document.createElement("span");
    h.className = "col-rz"; h.title = "Drag to resize · double-click to reset";
    h.onclick = (e) => e.stopPropagation();
    h.ondblclick = (e) => { e.stopPropagation(); saved.delete(key); table.style.tableLayout = ""; ths.forEach((c) => { c.style.width = ""; }); };
    h.onpointerdown = (e) => {
      e.preventDefault(); e.stopPropagation();
      const w = ths.map((c) => Math.round(c.getBoundingClientRect().width));
      apply(w);
      const x0 = e.clientX, a = w[i], b = w[i + 1], total = a + b;
      h.setPointerCapture(e.pointerId); h.classList.add("on");
      const move = (ev: PointerEvent) => {
        const na = Math.min(total - MIN, Math.max(MIN, a + ev.clientX - x0));
        w[i] = na; w[i + 1] = total - na; apply(w); saved.set(key, [...w]);
      };
      const up = () => { h.classList.remove("on"); h.removeEventListener("pointermove", move); h.removeEventListener("pointerup", up); };
      h.addEventListener("pointermove", move); h.addEventListener("pointerup", up);
    };
    th.append(h);
  });
}
