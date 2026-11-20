/** Big picture icons for the workflow menu (inline SVG, currentColor), one per demo so the idea reads at a glance. */
const svg = (inner: string) => `<svg class="wf-icon-svg" viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

/** A 4×4 checker patch, used as the board in several icons. */
const board = (x: number, y: number, s: number) => {
  const c = s / 4; let out = `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="2"/>`;
  for (let r = 0; r < 4; r++) for (let f = 0; f < 4; f++) if ((r + f) % 2) out += `<rect x="${x + f * c}" y="${y + r * c}" width="${c}" height="${c}" fill="currentColor" stroke="none" opacity=".35"/>`;
  return out;
};
const pawn = (cx: number, y: number, extra = "") => `<g ${extra}><circle cx="${cx}" cy="${y}" r="3.2"/><path d="M${cx - 4} ${y + 12}c0-6 2-6 4-9 2 3 4 3 4 9z"/></g>`;
const bot = (x: number, y: number) => `<rect x="${x}" y="${y}" width="18" height="14" rx="4"/><circle cx="${x + 6}" cy="${y + 7}" r="1.6" fill="currentColor"/><circle cx="${x + 12}" cy="${y + 7}" r="1.6" fill="currentColor"/><path d="M${x + 9} ${y}V${y - 4}"/><circle cx="${x + 9}" cy="${y - 5}" r="1.4" fill="currentColor"/>`;
const person = (cx: number, y: number) => `<circle cx="${cx}" cy="${y}" r="4.5"/><path d="M${cx - 8} ${y + 17}c0-7 3-9 8-9s8 2 8 9z"/>`;

const ICONS: Record<string, string> = {
  /** Smallest patch: three nodes wired in a chain. */
  basic: svg(`<circle cx="9" cy="24" r="5"/><circle cx="24" cy="24" r="5"/><circle cx="39" cy="24" r="5"/><path d="M14 24h5M29 24h5"/>`),
  /** Three cameras feeding one hub, projector out the top. */
  complete: svg(`<rect x="3" y="6" width="12" height="8" rx="2"/><rect x="3" y="20" width="12" height="8" rx="2"/><rect x="3" y="34" width="12" height="8" rx="2"/><path d="M15 10l8 10M15 24h8M15 38l8-10"/><circle cx="29" cy="24" r="6"/><path d="M35 24h4"/><path d="M39 17l7 7-7 7z" fill="currentColor" opacity=".5"/>`),
  /** Real webcam looking down at a physical board. */
  real: svg(`<rect x="15" y="3" width="18" height="11" rx="3"/><circle cx="24" cy="8.500" r="3"/><path d="M24 14v5"/><path d="M6 44l5-20h26l5 20z"/><path d="M13 36h22M9 30h30" opacity=".5"/>`),
  /** Globe with a chess move arrow: an online opponent. */
  chesscom: svg(`<circle cx="21" cy="24" r="15"/><path d="M6 24h30M21 9c-6 5-6 25 0 30M21 9c6 5 6 25 0 30" opacity=".6"/><path d="M33 40l9-9M42 31v7M42 31h-7"/>`),
  /** Empty board with a dotted ghost piece and a finger. */
  pieceless: svg(`${board(4, 12, 28)}<g stroke-dasharray="3 3.500">${pawn(18, 15)}</g><path d="M38 44V28a3 3 0 0 1 6 0v8l2 .5V44z" fill="currentColor" fill-opacity=".25"/>`),
  /** Bot head with a play triangle: start playing right now. */
  botplay: svg(`${bot(3, 14)}<path d="M27 12l16 12-16 12z" fill="currentColor" fill-opacity=".25"/>`),
  /** Person versus an online bot. */
  humanvsbot: svg(`${person(11, 12)}<path d="M22 20l4 8M26 20l-4 8" stroke-width="2"/>${bot(28, 24)}`),
  /** Cameras feeding the on-screen board. */
  "camera-bot": svg(`<rect x="3" y="4" width="14" height="9" rx="2.500"/><rect x="31" y="4" width="14" height="9" rx="2.500"/><path d="M10 13l8 9M38 13l-8 9"/>${board(12, 22, 24)}`),
};
const FALLBACK = svg(`<circle cx="12" cy="14" r="5"/><circle cx="36" cy="14" r="5"/><circle cx="24" cy="36" r="5"/><path d="M16 17l6 15M32 17l-6 15M17 14h14"/>`);

/** The big left-hand icon for one workflow row. */
export function workflowIcon(id: string): HTMLElement {
  const d = document.createElement("div"); d.className = "wf-icon"; d.setAttribute("aria-hidden", "true"); d.dataset.wf = id;
  d.innerHTML = ICONS[id] ?? FALLBACK; return d;
}
