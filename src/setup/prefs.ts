import type { SetupConfig } from "./config";
import type { ViewSettings } from "../ui/viewSettings";

/** Everything the app remembers between visits besides the patch, setup and mapping (which have their own keys). */
export interface Prefs {
  tab?: number;
  /** Width in px of the right-hand inspector; unset = the responsive default. */
  asideW?: number;
  /** Show per-node timings (bars, sparklines) on the patch. */
  heat?: boolean;
  /** Per-node cost budget in ms for the Performance tab (0 = off). */
  perfBudget?: number;
  /** Sound was switched on last time; it re-arms on your first click or key press (browsers require a gesture). */
  sound?: boolean;
  view?: { x: number; y: number; k: number };
  /** Render quality and display helpers for the game previews. */
  view2?: Partial<ViewSettings>;
  /** An unfinished setup wizard: the edits so far and the step you were on. */
  draft?: { cfg: SetupConfig; step: number } | null;
}

const KEY = "cx.prefs.v1";

export function loadPrefs(): Prefs {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return j && typeof j === "object" ? (j as Prefs) : {};
  } catch { return {}; }
}

/** Merges `p` into what is stored. Returns the merged prefs. */
export function patchPrefs(p: Prefs): Prefs {
  const next = { ...loadPrefs(), ...p };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable or full */ }
  return next;
}

export function clearPrefs() { try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ } }
