import type { Dialog } from "./route";

let writer: ((d: Dialog | null) => void) | null = null;
let current: Dialog | null = null;

/** The app supplies the function that writes the open popup into the URL (`?dialog=`). */
export function bindDialogUrl(fn: (d: Dialog | null) => void) { writer = fn; }

/**
 * Call when a popup opens. Returns the function to call when it closes.
 * A popup that was replaced by another one never closes, and a late close never clears a newer popup.
 */
export function dialogOpened(name: Dialog): () => void {
  current = name;
  writer?.(name);
  return () => { if (current === name) { current = null; writer?.(null); } };
}
