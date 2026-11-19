import { KNIGHT_SVG } from "./brandIcon";
import { mixer } from "../scene/mixer";

declare const __APP_VERSION__: string;

export const SPLASH_KEY = "chess.splashSeen";
/** Whole splash length in ms: the knight appears, tilts, winks (dink), straightens, then everything fades out. */
export const SPLASH_MS = 3200;
/** Shorter version for subsequent runs. */
export const SPLASH_FAST_MS = 1300;

/** True the first time this browser opens the app. Marks it seen. Storage failures count as already seen (never block the app). */
export function firstRun(store: Pick<Storage, "getItem" | "setItem"> = localStorage): boolean {
  try { if (store.getItem(SPLASH_KEY)) return false; store.setItem(SPLASH_KEY, "1"); return true; } catch { return false; }
}

/** A short two-note "dink" bell at the moment of the wink. Silent when muted or when audio is unavailable. */
function dink(ctx: AudioContext, at: number) {
  const m = mixer.get(); if (m.muted) return;
  const level = 0.12 * m.sfx * m.master;
  [[1760, 0], [2349, 0.09]].forEach(([f, d]) => {
    const t = ctx.currentTime + at + d, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "triangle"; o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(level, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.55);
  });
}

/** Adds an eyelid and a sparkle to the knight artwork; both are animated in splash CSS. The eye sits at about (34.8, 21.4) in the 64x64 box. */
const winkingKnight = () => KNIGHT_SVG
  .replace('class="brand-knight" width="24" height="24"', 'class="splash-knight" width="160" height="160"')
  .replace(/<\/svg>$/, '<circle class="splash-lid" cx="34.8" cy="21.4" r="2.6" fill="#fff2d4"/><path class="splash-lid-line" d="M32.6 21.6q2.2 1.7 4.4 0" stroke="#1a1a1a" stroke-width=".9" fill="none" stroke-linecap="round"/><path class="splash-spark" d="M41 14l.9 2.3 2.3.9-2.3.9L41 20.4l-.9-2.3-2.3-.9 2.3-.9z" fill="#fff"/></svg>');

/** Shows the splash over the app and resolves when it has faded out and been removed. Click or key skips. */
export function showSplash(host: HTMLElement = document.body, fast = false): Promise<void> {
  const el = document.createElement("div");
  el.className = fast ? "splash splash-fast" : "splash"; el.setAttribute("role", "presentation");
  el.innerHTML = `<div class="splash-mid">${winkingKnight()}<div class="splash-name">Chess XP</div></div><div class="splash-ver">v${__APP_VERSION__}</div>`;
  host.append(el);
  let ctx: AudioContext | null = null;
  try { if (typeof AudioContext !== "undefined") { ctx = new AudioContext(); void ctx.resume(); dink(ctx, fast ? 0.45 : 1.05); } } catch { ctx = null; }
  return new Promise(resolve => {
    let done = false;
    const end = () => {
      if (done) return; done = true;
      clearTimeout(timer); removeEventListener("keydown", end); el.removeEventListener("pointerdown", end);
      el.remove(); void ctx?.close().catch(() => {}); resolve();
    };
    const timer = setTimeout(end, fast ? SPLASH_FAST_MS : SPLASH_MS);
    addEventListener("keydown", end); el.addEventListener("pointerdown", end);
  });
}
