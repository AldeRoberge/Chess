/** Dynamic top-bar chip icons (inline SVG, currentColor): each adapts to the live value (small heap = ant, huge heap = elephant). */
const pick = <T,>(v: number, steps: [number, T][], top: T): T => { for (const [max, x] of steps) if (v < max) return x; return top; };
const clamp = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
/** Outline icon: stroked, no fill. */
const line = (inner: string) => `<svg class="ci" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
/** Silhouette icon: filled. */
const solid = (inner: string) => `<svg class="ci" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const legs = (xs: number[], y1: number, y2: number) => xs.map(x => `<path d="M${x} ${y1}V${y2}" fill="none"/>`).join("");

/** Animal silhouettes, smallest to biggest. */
const ANIMALS = {
  ant: solid(`<circle cx="3.5" cy="9.5" r="1.9"/><circle cx="7.5" cy="9.5" r="1.3"/><circle cx="11.5" cy="9" r="1.7"/><path d="M5 11.5l-1 3M7.5 11l0 3.5M10 11.5l1 3M12.5 7.5l1.5-2M11 7.5l-.5-2.5" fill="none"/>`),
  mouse: solid(`<ellipse cx="7.5" cy="10" rx="4.8" ry="2.8"/><circle cx="12.5" cy="9.5" r="1.8"/><circle cx="11.6" cy="7.4" r="1.1"/><path d="M2.8 10.5c-1.5 0-2 2-.8 3" fill="none"/>${legs([6, 9.5], 12, 13.5)}`),
  cat: solid(`<ellipse cx="7" cy="10" rx="5" ry="3"/><circle cx="12.2" cy="7" r="2.3"/><path d="M10.6 5.3l.2-2.3 1.3 1.3zM13.8 5.3l-.2-2.3-1.3 1.3z"/><path d="M2.5 9.5c-1.8-1-1.2-4.5 .3-5" fill="none"/>${legs([5, 9.5], 12, 14)}`),
  dog: solid(`<ellipse cx="7" cy="9.5" rx="5.2" ry="3"/><circle cx="12.3" cy="6.8" r="2.3"/><path d="M14 6.5l1.5 1" fill="none"/><path d="M10.4 5l-.8 3 1.5-.8z"/><path d="M2 8l-1.2-2" fill="none"/>${legs([4.5, 6, 9, 10.5], 11.5, 14.5)}`),
  horse: solid(`<ellipse cx="7" cy="9" rx="5.2" ry="2.8"/><path d="M10.5 7.5L12 3.5l2.8 2-1 1.2-1.8-.2-.5 2.3z"/><path d="M2 8.5l-1 3" fill="none"/>${legs([4, 5.5, 9, 10.5], 11, 15)}`),
  elephant: solid(`<ellipse cx="7" cy="8.5" rx="5.6" ry="4"/><circle cx="12" cy="7.5" r="2.7"/><path d="M13.8 9.5c1.6 1 1.2 4-.3 4.5" fill="none"/><circle cx="10" cy="8" r="1.7" fill="var(--bg,#fff)" stroke="currentColor" stroke-width="1"/>${legs([3.5, 5.5, 8.5, 10], 11, 15)}`),
  whale: solid(`<path d="M1 10c0-3.5 3-6 6.5-6s6 2 6.500 4.500c1-.7 1.800-1.700 1.800-3.300.3 2.600-.2 4.500-1.800 5.300C12.600 13.700 9.500 14.500 7 14.500 3.500 14.500 1 13 1 10z"/><path d="M6 4c0-1.500.5-2.500 1.500-3M8.500 4c0-1.500 1-2.500 2.200-2.800" fill="none"/>`),
};

const layers = (n: number) => Array.from({ length: n }, (_, i) => `<path d="M2.5 ${11.5 - i * 3.2}L8 ${8.5 - i * 3.2}l5.500 3-5.500 3z" fill="${i === n - 1 ? "currentColor" : "none"}" fill-opacity=".35"/>`).join("");

export const chipIcons = {
  /** Board fidelity 0–1: a 2×2 grid that fills in cell by cell. */
  board: (f: number) => { const n = Math.round(clamp(f) * 4); return line([[2.5, 2.5], [9, 2.5], [2.5, 9], [9, 9]].map(([x, y], i) => `<rect x="${x}" y="${y}" width="4.500" height="4.500" rx="1.6"${i < n ? ' fill="currentColor"' : ""}/>`).join("")); },
  /** Move confidence 0–1: a ring that closes, with a check once it is sure. */
  move: (f: number) => { const p = clamp(f); return line(`<circle cx="8" cy="8" r="5.500" opacity=".28"/><circle cx="8" cy="8" r="5.500" stroke-dasharray="${(34.6 * p).toFixed(1)} 40" transform="rotate(-90 8 8)"/>${p > 0.8 ? '<path d="M5.500 8.200l1.800 1.800 3.200-3.600"/>' : ""}`); },
  /** Speedometer: the needle swings with the frame rate. */
  fps: (fps: number) => { const a = Math.PI * (1 - clamp(fps / 120)); return line(`<path d="M2 12a6 6 0 0 1 12 0" opacity=".4"/><path d="M8 12l${(Math.cos(a) * 4.500).toFixed(2)} ${(-Math.sin(a) * 4.500).toFixed(2)}"/><circle cx="8" cy="12" r=".8" fill="currentColor"/>`); },
  /** Camera body; extra cameras stack behind it, none is crossed out. */
  cam: (n: number) => line(`${n >= 3 ? '<path d="M5 3h8v1.500" opacity=".35"/>' : ""}${n >= 2 ? '<path d="M3.500 4.500h8.500v1" opacity=".55"/>' : ""}<rect x="1.800" y="6" width="9" height="6.500" rx="1.800"/><path d="M10.800 8.200l3.400-1.600v5.800l-3.400-1.600"/>${n <= 0 ? '<path d="M2 14L14 2" stroke-width="1.600"/>' : ""}`),
  phase: (p: string) => line(({
    idle: '<path d="M12.500 9.500A5 5 0 0 1 6.500 3.500a5 5 0 1 0 6 6z"/>',
    intro: '<path d="M8 2l1.800 3.800 4.200.5-3.100 2.900.8 4.200L8 11.300 4.300 13.400l.8-4.200L2 6.300l4.200-.5z"/>',
    menu: '<path d="M3 4h10M3 8h10M3 12h10"/>',
    game: '<circle cx="8" cy="4.500" r="2"/><path d="M6.500 7h3L10.500 11h-5zM4.500 13.500h7"/>',
    outro: '<path d="M4 14V2M4 3h8l-2 3 2 3H4"/>',
  } as Record<string, string>)[p] ?? '<circle cx="8" cy="8" r="4"/>'),
  /** Tick cost as a fraction of the 66 ms budget: a meter that fills. */
  tick: (used: number) => line(`<rect x="1.500" y="5" width="13" height="6" rx="2.500"/><rect x="3" y="6.500" width="${(10 * clamp(used)).toFixed(1)}" height="3" rx="1.200" fill="currentColor" stroke="none"/>`),
  /** Pencil with an underline that lengthens as more edits are made. */
  actions: (n: number) => line(`<path d="M10.500 2.500l3 3L6.500 12.500 3 13l.5-3.500z"/><path d="M2 15h${(2 + 12 * clamp(n / 100)).toFixed(1)}"/>`),
  undo: (n: number) => line(`<g opacity="${n ? 1 : 0.35}"><path d="M5 3L2 6l3 3"/><path d="M2 6h6.500a4 4 0 0 1 0 8H6"/>${n >= 10 ? '<path d="M13.500 3.500h-3" />' : ""}</g>`),
  redo: (n: number) => line(`<g opacity="${n ? 1 : 0.35}"><path d="M11 3l3 3-3 3"/><path d="M14 6H7.500a4 4 0 0 0 0 8H10"/>${n >= 10 ? '<path d="M2.500 3.500h3" />' : ""}</g>`),
  /** Workflow JSON size in KB: a page that fills with lines. */
  workflow: (kb: number) => { const n = pick(kb, [[2, 1], [10, 2], [50, 3]], 4); return line(`<path d="M3.500 1.800h6l3 3v9.400h-9z"/>${Array.from({ length: n }, (_, i) => `<path d="M5.500 ${6.500 + i * 2}h5"/>`).join("")}`); },
  /** History memory in KB: a stack of snapshots. */
  hist: (kb: number) => line(layers(pick(kb, [[10, 1], [100, 2], [1000, 3]], 4))),
  /** localStorage fraction of the ~5 MB quota: a jar that fills up. */
  store: (f: number) => { const h = 8 * clamp(f); return line(`<path d="M4 2.500h8M4.500 2.500v11h7v-11"/><rect x="5" y="${(13 - h).toFixed(1)}" width="6" height="${h.toFixed(1)}" fill="currentColor" stroke="none"/>`); },
  /** JS heap in MB: ant → elephant → whale. */
  heap: (mb: number) => pick(mb, [[30, ANIMALS.ant], [60, ANIMALS.mouse], [120, ANIMALS.cat], [250, ANIMALS.dog], [500, ANIMALS.horse], [2000, ANIMALS.elephant]], ANIMALS.whale),
};

/** Health tone class for a chip: g green, y yellow, o orange, r red. */
const t = (c: string) => ` ${c}`;
const hi = (v: number, g: number, y: number, o: number) => t(v >= g ? "g" : v >= y ? "y" : v >= o ? "o" : "r");
const lo = (v: number, g: number, y: number, o: number) => t(v < g ? "g" : v < y ? "y" : v < o ? "o" : "r");
export const chipTone = {
  board: (f: number) => hi(f, 0.8, 0.6, 0.35),
  move: (f: number) => hi(f, 0.8, 0.6, 0.35),
  fps: (fps: number) => hi(fps, 50, 30, 20),
  cam: (n: number) => t(n > 0 ? "g" : "r"),
  tick: (ratio: number) => lo(ratio, 0.4, 0.7, 1),
  workflow: (kb: number) => lo(kb, 100, 500, 2000),
  hist: (kb: number) => lo(kb, 500, 2000, 8000),
  store: (f: number) => lo(f, 0.4, 0.7, 0.9),
  heap: (mb: number) => lo(mb, 150, 300, 600),
};
