/**
 * Strength picker visual for "Computer strength": a slider's value placed on a
 * distribution curve of rated players, with the rank bands (Beginner … Super GM)
 * under the axis and a few top players marked.
 *
 * The curve is an illustrative normal model of FIDE-style ratings, not a measured
 * census. The top-player ratings are approximate and should be refreshed from FIDE.
 */

const MEAN = 1450; // illustrative centre of rated players
const SD = 350;    // illustrative spread
const E0 = 400, E1 = 2900; // axis range (Elo)
const W = 500, H = 150, PAD = 22, BASE = 112; // viewBox and layout
const x = (e: number) => PAD + ((e - E0) / (E1 - E0)) * (W - 2 * PAD);
const pdf = (e: number) => Math.exp(-0.5 * ((e - MEAN) / SD) ** 2);

/** Rank bands: lower bound in Elo, short axis label, full name for the readout. */
export const ELO_TIERS: { from: number; short: string; name: string }[] = [
  { from: 400, short: "Beginner", name: "Beginner" },
  { from: 1000, short: "Intermediate", name: "Intermediate" },
  { from: 1600, short: "Advanced", name: "Advanced" },
  { from: 2000, short: "Expert", name: "Expert" },
  { from: 2200, short: "CM", name: "Candidate Master" },
  { from: 2300, short: "FM", name: "FIDE Master" },
  { from: 2400, short: "IM", name: "International Master" },
  { from: 2500, short: "GM", name: "Grandmaster" },
  { from: 2700, short: "Super GM", name: "Super Grandmaster" },
];

/** Top players by classical rating (approximate). */
export const TOP_PLAYERS: { name: string; elo: number }[] = [
  { name: "Magnus Carlsen", elo: 2830 },
  { name: "Hikaru Nakamura", elo: 2800 },
  { name: "Fabiano Caruana", elo: 2790 },
];

/** Share of rated players this strength is stronger than (0–100), under the illustrative curve. */
export function percentile(elo: number): number {
  const z = (elo - MEAN) / (SD * Math.SQRT2);
  const t = 1 / (1 + 0.3275911 * Math.abs(z));
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  const erf = (z >= 0 ? 1 : -1) * (1 - poly * Math.exp(-z * z));
  return Math.round(50 * (1 + erf));
}

function plot(v: number): string {
  const pts: string[] = [];
  for (let e = E0; e <= E1; e += 20) pts.push(`${x(e).toFixed(1)},${(BASE - pdf(e) * 92).toFixed(1)}`);
  const bands = ELO_TIERS.map((t, i) => {
    const x0 = x(t.from), x1 = i + 1 < ELO_TIERS.length ? x(ELO_TIERS[i + 1].from) : W - PAD;
    const mid = (x0 + x1) / 2;
    return `<rect x="${x0.toFixed(1)}" y="${BASE + 4}" width="${(x1 - x0 - 1).toFixed(1)}" height="6" rx="2" class="elo-band${i % 2 ? " alt" : ""}"/>`
      + `<text x="${mid.toFixed(1)}" y="${BASE + 22}" text-anchor="middle" class="elo-tier">${t.short}</text>`;
  }).join("");
  // each top player: a dot on the axis, a dotted leader rising out of the graph, and the name at the leader's end.
  // Players sorted right to left so the leaders never cross: the rightmost takes the top row.
  const byX = [...TOP_PLAYERS].sort((a, b) => b.elo - a.elo);
  const tops = byX.map((p, i) => {
    const px = x(p.elo), row = 16 + i * 16;
    return `<path d="M${px.toFixed(1)},${BASE + 4} V${row} H${(px - 4).toFixed(1)}" class="elo-leader"/>`
      + `<circle cx="${px.toFixed(1)}" cy="${BASE + 7}" r="3" class="elo-top"><title>${p.name} ${p.elo}</title></circle>`
      + `<text x="${(px - 7).toFixed(1)}" y="${row + 4}" text-anchor="end" class="elo-name">${p.name} <tspan class="elo-name-elo">${p.elo}</tspan></text>`;
  }).join("");
  const cx = x(v), yv = BASE - pdf(v) * 92;
  return `<svg viewBox="0 0 ${W} ${H + 12}" class="elo-svg" role="img" aria-label="Strength ${v} on the distribution of rated players">`
    + `<path d="M${x(E0).toFixed(1)},${BASE} L${pts.join(" L")} L${(W - PAD).toFixed(1)},${BASE} Z" class="elo-area"/>`
    + `<path d="M${pts.join(" L")}" class="elo-curve" fill="none"/>`
    + `<line x1="${PAD}" x2="${W - PAD}" y1="${BASE + 4}" y2="${BASE + 4}" class="elo-axis"/>`
    + bands + tops
    + `<line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${(yv - 16).toFixed(1)}" y2="${BASE + 4}" class="elo-now"/>`
    + `<circle cx="${cx.toFixed(1)}" cy="${yv.toFixed(1)}" r="5" class="elo-dot"/>`
    + `<text x="${cx.toFixed(1)}" y="${(yv - 22).toFixed(1)}" text-anchor="middle" class="elo-nowlab">${v}</text>`
    + `</svg>`;
}

/** The strength visual: call update(v) when the slider moves; the element can be appended anywhere. */
export interface EloVisual {
  el: HTMLElement;
  update(v: number): void;
  /** Set by the owner: called with the Elo under the pointer while the graph is dragged (final = pointer released). */
  onPick?: (elo: number, final: boolean) => void;
}

export function eloVisual(value: number): EloVisual {
  const el = document.createElement("div");
  el.className = "elo-visual";
  const render = (v: number) => {
    el.innerHTML = `${plot(v)}<p class="elo-read"><b>${v} Elo</b> is stronger than about ${percentile(v)}% of rated players. Illustrative curve; top ratings approximate.</p>`;
  };
  render(value);
  const vis: EloVisual = { el, update: render };
  // grab the graph anywhere and drag: the marker follows the pointer along the axis. Listeners live on the
  // persistent wrapper because every update replaces the svg inside it.
  let dragging = false;
  const eloAt = (clientX: number): number | null => {
    const svg = el.querySelector("svg");
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    if (r.width <= 0) return null;
    const vx = ((clientX - r.left) / r.width) * W;
    return E0 + ((vx - PAD) / (W - 2 * PAD)) * (E1 - E0);
  };
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !(e.target as Element).closest("svg") || !vis.onPick) return;
    const v = eloAt(e.clientX);
    if (v === null) return;
    dragging = true;
    try { el.setPointerCapture(e.pointerId); } catch { /* synthetic pointers */ }
    e.preventDefault();
    vis.onPick(v, false);
  });
  el.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const v = eloAt(e.clientX);
    if (v !== null) vis.onPick?.(v, false);
  });
  const end = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    const v = eloAt(e.clientX);
    if (v !== null) vis.onPick?.(v, true);
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", () => { dragging = false; });
  return vis;
}
