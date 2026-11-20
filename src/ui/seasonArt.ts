/** Colours and decorations for each seasonal logo, drawn in the knight's 64x64 box. The knight itself never moves (the splash eyelid is aligned to its eye at 34.8, 21.4), so hats sit on its head at about y 1 to 13. Concrete hex colours only, so the markup renders anywhere (favicon, PNG export), unlike the default look that follows the theme. */
import type { SeasonId } from "./seasons.ts";

export interface Look {
  /** Tile gradient, top then bottom. */
  bg: [string, string];
  /** Checkerboard floor squares, dark then light. */
  floor: [string, string];
  /** The knight's eye. */
  eye: string;
  /** Drawn behind the knight (sparkles, hearts, bats). */
  back?: string;
  /** Drawn over the knight (hats). */
  front?: string;
}

/** The everyday look: tinted by the app theme through --signal. */
export const DEFAULT_LOOK: Look = {
  bg: ["color-mix(in srgb,var(--signal) 40%,#000)", "var(--signal)"],
  floor: ["color-mix(in srgb,var(--signal) 55%,#000)", "color-mix(in srgb,var(--signal) 70%,#fff)"],
  eye: "var(--signal)",
};

const n = (v: number) => +v.toFixed(2);
const INK = "#1a1a1a";
/** Outline matching the knight's black edge. */
const ink = `stroke="${INK}" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"`;
const dot = (x: number, y: number, r: number, fill: string) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`;
/** Four-point sparkle centred on x,y with radius r. */
const sparkle = (x: number, y: number, r: number, fill: string) => {
  const t = r * 0.28;
  return `<path d="M${x} ${n(y - r)}L${n(x + t)} ${n(y - t)}L${n(x + r)} ${y}L${n(x + t)} ${n(y + t)}L${x} ${n(y + r)}L${n(x - t)} ${n(y + t)}L${n(x - r)} ${y}L${n(x - t)} ${n(y - t)}z" fill="${fill}"/>`;
};
/** Heart about 11 units wide at scale 1, centred on x,y. */
const heart = (x: number, y: number, s: number, fill: string, rot = 0) =>
  `<path transform="translate(${x} ${y}) rotate(${rot}) scale(${s})" d="M0 5C-9-1-4-8 0-3.5 4-8 9-1 0 5z" fill="${fill}"/>`;
/** Three-leaf clover with its stem, about 13 units wide at scale 1; x,y is where the leaves meet. */
const shamrock = (x: number, y: number, s: number, fill: string, rot = 0) => {
  const leaf = (a: number) => `<path transform="rotate(${a})" d="M0 0C-3-2.5-3.4-6.2-1.6-6.8-.6-7.1 0-6.3 0-5.4 0-6.3.6-7.1 1.6-6.8 3.4-6.2 3-2.5 0 0z"/>`;
  return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})"><path d="M0 0Q.8 4 3 6.5" fill="none" stroke="${fill}" stroke-width="1.1" stroke-linecap="round"/><g fill="${fill}">${leaf(0)}${leaf(120)}${leaf(240)}</g></g>`;
};
const bat = (x: number, y: number, s: number, fill: string) =>
  `<path transform="translate(${x} ${y}) scale(${s})" d="M0-1.6C-1.4-3.2-5-3.4-8-1.2-6.2-1.2-5.2.2-4.8 1.8-3.6.6-2.2.6-1 1.8L0 .4 1 1.8C2.2.6 3.6.6 4.8 1.8 5.2.2 6.2-1.2 8-1.2 5-3.4 1.4-3.2 0-1.6z" fill="${fill}"/>`;
const egg = (x: number, y: number, s: number, fill: string, band: string) =>
  `<g transform="translate(${x} ${y}) scale(${s})"><path d="M0-6C3.6-6 5.2-1.2 5.2 1.6 5.2 4.6 2.8 6.4 0 6.4-2.8 6.4-5.2 4.6-5.2 1.6-5.2-1.2-3.6-6 0-6z" fill="${fill}"/><path d="M-5 1l2.5-1.8L0 1l2.5-1.8L5 1" fill="none" stroke="${band}" stroke-width="1.2" stroke-linejoin="round"/></g>`;

/** Hats are written level and tilted a little so they sit on the head; the knight's head top is near (29, 11). */
const tilt = (deg: number, body: string) => `<g transform="rotate(${deg} 29 11)">${body}</g>`;

export const SEASON_LOOKS: Record<SeasonId, Look> = {
  christmas: {
    bg: ["#0b3a29", "#1f8a52"],
    floor: ["#8f1a26", "#f3eee1"],
    eye: "#2f9e5b",
    back: [sparkle(10, 13, 3.4, "#fff"), sparkle(54, 8, 2.6, "#fff"), sparkle(55, 25, 2, "#fff"), dot(7, 26, 1.1, "#fff"), dot(47, 5, 1, "#fff"), dot(58, 15, 1.1, "#fff"), dot(14, 5, 1, "#fff")].join(""),
    front: tilt(-12, `<path d="M37.6 11.4C37 6.6 34.4 3.4 30.6 2.8 27 2.2 21.6 2.2 18 5.6c-2 1.8-3.2 3.6-3.4 5.2 2.4-1.8 5.2-2.4 7.4-1.6v3.2z" fill="#d62839" ${ink}/>${dot(14.6, 10.8, 2.5, "#fff").replace("/>", ` ${ink}/>`)}<rect x="20" y="9.6" width="19.6" height="4.8" rx="2.4" fill="#fff" ${ink}/>`),
  },
  valentine: {
    bg: ["#4d0c2c", "#d6336c"],
    floor: ["#8f1d4a", "#ffd3e2"],
    eye: "#d6336c",
    back: [heart(10, 13, 0.78, "#ff9ec0", -14), heart(55, 9, 0.52, "#ffc2d6", 12), heart(54, 26, 0.4, "#ff9ec0", -8), heart(18, 5, 0.3, "#ffc2d6", 10), heart(6, 28, 0.3, "#ffc2d6", -10)].join(""),
    front: tilt(-10, `${heart(29.5, 8.6, 0.88, "#ff4d7e").replace("/>", ` ${ink}/>`)}${sparkle(40, 6.4, 2.1, "#fff")}`),
  },
  newyear: {
    bg: ["#080821", "#2a2a78"],
    floor: ["#14142f", "#f0c24a"],
    eye: "#f0c24a",
    back: [sparkle(10, 13, 4, "#f0c24a"), sparkle(54, 10, 3.2, "#ff7ab6"), sparkle(54, 26, 2.4, "#6fe0ff"), sparkle(5, 28, 2.2, "#fff"), dot(18, 4, 1.1, "#ff7ab6"), dot(46, 4, 1.1, "#6fe0ff"), dot(59, 18, 1.1, "#f0c24a"), dot(8, 22, 1, "#6fe0ff")].join(""),
    front: tilt(-4, `<path d="M18.6 13L28.4 3.4 40.2 13z" fill="#f0c24a" ${ink}/><path d="M23.4 9.8L35 9.9M26 6.8L31.6 6.9" stroke="#e0457b" stroke-width="1.8" stroke-linecap="round" fill="none"/><circle cx="28.4" cy="3.2" r="2" fill="#fff" stroke="${INK}" stroke-width="1"/>`),
  },
  halloween: {
    bg: ["#190a2b", "#e8650a"],
    floor: ["#1d1116", "#ff8a1f"],
    eye: "#ff9d2e",
    back: [`<circle cx="53" cy="12" r="6.2" fill="#ffe9a8"/><circle cx="55.6" cy="10.2" r="5.4" fill="#2a1346"/>`, bat(11, 14, 0.7, "#0d0716"), bat(53, 27, 0.55, "#0d0716"), dot(9, 6, 0.9, "#ffe9a8"), dot(20, 3, 0.8, "#ffe9a8"), dot(46, 3, 0.8, "#ffe9a8")].join(""),
    front: tilt(-8, `<path d="M24 12C25 8 27.2 4.6 30.4 2.2c1.8-1 3.2 0 3 1.4-.4 1-.2 1.8.6 2.8 1.2 1.6 1.8 3.6 2 5.6z" fill="#27123f" ${ink}/><path d="M24.6 10.4L35.4 10.4 34.8 8.2 25.4 8.2z" fill="#ff8a1f"/><path d="M18.2 11.4C23 13 32 13 39.8 11.4c.5 1.4-.1 2.6-1.6 3-5.6 1.4-13.2 1.4-18.6-.2-1.4-.4-1.9-1.8-1.4-2.8z" fill="#27123f" ${ink}/>`),
  },
  stpatrick: {
    bg: ["#073a19", "#1fa150"],
    floor: ["#0f6a2f", "#e6f4d8"],
    eye: "#1fa150",
    back: [shamrock(11, 14, 0.9, "#7be08e", -10), shamrock(54, 12, 0.62, "#bdf0b9", 14), shamrock(55, 27, 0.5, "#7be08e", -6), dot(7, 5, 1, "#f2c94c"), dot(19, 3, 0.9, "#f2c94c"), dot(46, 3, 0.9, "#f2c94c")].join(""),
    front: tilt(-8, `<rect x="24.6" y="1.6" width="10.6" height="9.8" rx="1.2" fill="#0f6a2f" ${ink}/><rect x="24.6" y="7.4" width="10.6" height="2.8" fill="#111" ${ink}/><rect x="28.2" y="7.2" width="3.6" height="3.2" rx=".5" fill="#f2c94c" stroke="${INK}" stroke-width=".8" stroke-linejoin="round"/><rect x="20.4" y="10.6" width="19" height="3.4" rx="1.7" fill="#0f6a2f" ${ink}/>`),
  },
  easter: {
    bg: ["#5a3fa0", "#f29cc3"],
    floor: ["#9b86d9", "#fff0a8"],
    eye: "#7a5fc0",
    back: [egg(10, 13, 0.85, "#ffd166", "#ef6f9d"), egg(55, 10, 0.6, "#9ae0c4", "#fff"), egg(55, 27, 0.5, "#ffd166", "#7a5fc0"), dot(19, 4, 1, "#fff"), dot(46, 4, 0.9, "#fff"), dot(5, 27, 0.9, "#fff")].join(""),
    front: tilt(-8, `<ellipse cx="26.6" cy="7.6" rx="2.8" ry="5.4" transform="rotate(-10 26.6 7.6)" fill="#fff2d4" ${ink}/><ellipse cx="26.6" cy="8" rx="1.2" ry="3.4" transform="rotate(-10 26.6 8)" fill="#f29cc3"/><ellipse cx="33.8" cy="7" rx="2.8" ry="5.4" transform="rotate(8 33.8 7)" fill="#fff2d4" ${ink}/><ellipse cx="33.8" cy="7.4" rx="1.2" ry="3.4" transform="rotate(8 33.8 7.4)" fill="#f29cc3"/>`),
  },
};
