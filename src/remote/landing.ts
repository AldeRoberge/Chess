/**
 * The front door on a phone: opening the site root on a small touch screen asks for the join code first (the common case on a
 * phone), with one quiet button to go on to the full app. Desktop-sized screens never see it, and "always open the app" is remembered.
 */
import "../style.css";
import "./remote.css";
import { withIcon } from "../ui/icons";

export const SKIP_KEY = "chess.join.skip";

type Store = Pick<Storage, "getItem" | "setItem">;
const local = (): Store | null => { try { return localStorage; } catch { return null; } };

/** True for a phone-sized touch screen that has not chosen to always open the full app. */
export function wantsJoinScreen(win: Window = window, store: Store | null = local()): boolean {
  try { if (store?.getItem(SKIP_KEY) === "1") return false; } catch { /* storage blocked: ask */ }
  const coarse = win.matchMedia?.("(pointer: coarse)").matches ?? false;
  const short = Math.min(win.screen?.width || win.innerWidth, win.screen?.height || win.innerHeight);
  return coarse && short > 0 && short <= 600;
}

export interface LandingDeps { onJoin: (code: string) => void; onApp: () => void; store?: Store | null }

export function mountJoinLanding(root: HTMLElement, deps: LandingDeps) {
  const store = deps.store === undefined ? local() : deps.store;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
  document.body.classList.add("remote");
  const page = el("div", "rm rm-land");
  const f = el("form", "rm-join"); f.noValidate = true;
  const logo = el("span", "rm-land-ic"); logo.innerHTML = withIcon(el("span"), "phone", 40).innerHTML; logo.setAttribute("aria-hidden", "true");
  const h = el("h1", "", "Chess XP"), p = el("p", "rm-lead", "Or join a game running on a computer:");
  const i = el("input"); i.type = "text"; i.inputMode = "numeric"; i.pattern = "[0-9]*"; i.autocomplete = "one-time-code"; i.maxLength = 8;
  i.placeholder = "Join code"; i.setAttribute("aria-label", "Join code");
  const err = el("p", "rm-err"); err.setAttribute("role", "alert");
  const join = withIcon(el("button", "rm-btn", "Join"), "arrow", 20); join.type = "submit";
  const app = withIcon(el("button", "rm-btn primary rm-land-app", "Play with this camera"), "board", 20); app.type = "button";
  const keepL = el("label", "rm-land-keep"), keep = el("input"); keep.type = "checkbox"; keepL.append(keep, " Skip this screen next time");
  f.append(logo, h, app, p, i, err, join, keepL);
  page.append(f); root.replaceChildren(page);

  const submit = () => {
    const code = i.value.replace(/\s+/g, "");
    if (!code) { err.textContent = "Enter the code."; i.focus(); return; }
    teardown(); deps.onJoin(code);
  };
  const teardown = () => { page.remove(); document.body.classList.remove("remote"); };
  f.onsubmit = (e) => { e.preventDefault(); submit(); };
  i.oninput = () => { err.textContent = ""; i.value = i.value.replace(/\D/g, ""); };
  app.onclick = () => { if (keep.checked) { try { store?.setItem(SKIP_KEY, "1"); } catch { /* private mode */ } } teardown(); deps.onApp(); };
  i.focus();
  return { page, input: i };
}
