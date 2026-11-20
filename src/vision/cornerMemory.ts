import type { Pt } from "./types";

/**
 * Board corners remembered per camera, across runs and workflows. A calibrated camera keeps its corners:
 * a reader on a camera it has seen before starts from the last known corners instead of the default grid.
 */
const KEY = "cx.cameraCorners.v1";
export const CORNER_MEMORY_DAYS = 30;
type Entry = { corners: string; at: number };
type Store = Pick<Storage, "getItem" | "setItem">;
const store = (): Store | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };
const read = (s: Store): Record<string, Entry> => { try { const j = JSON.parse(s.getItem(KEY) ?? "{}"); return j && typeof j === "object" ? j : {}; } catch { return {}; } };

/** The corners last saved for this camera (a "x,y x,y x,y x,y" string), or null when none, or older than a month. */
export function recallCorners(camera: string, now = Date.now(), s: Store | null = store()): string | null {
  if (!s || !camera) return null;
  const e = read(s)[camera];
  return e && typeof e.corners === "string" && now - e.at < CORNER_MEMORY_DAYS * 864e5 ? e.corners : null;
}

/** Saves this camera's corners. Skips a save that would change nothing. */
export function rememberCorners(camera: string, corners: string, now = Date.now(), s: Store | null = store()) {
  if (!s || !camera || !corners) return;
  const all = read(s);
  if (all[camera]?.corners === corners) return;
  all[camera] = { corners, at: now };
  try { s.setItem(KEY, JSON.stringify(all)); } catch { /* quota or private mode */ }
}
export type { Pt };
