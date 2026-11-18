/**
 * Undo / redo over serialised snapshots. `record` is called after every edit; edits with the same `key`
 * (same shape of patch) arriving within `window` ms fold into one step, so dragging a slider or a node is one undo.
 */
export class History<T> {
  private past: string[] = [];
  private future: string[] = [];
  private cur: string;
  private lastAt = 0;
  private lastKey = "";

  constructor(initial: T, private limit = 100, private window = 500) { this.cur = JSON.stringify(initial); }

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }

  /** Total edits recorded (folded edits count once), undone or not. */
  actions = 0;
  get undoCount() { return this.past.length; }
  get redoCount() { return this.future.length; }
  /** Characters held by every snapshot (current + undo + redo): a close proxy for memory use. */
  get chars() { let n = this.cur.length; for (const s of this.past) n += s.length; for (const s of this.future) n += s.length; return n; }
  get patchChars() { return this.cur.length; }

  /** Returns true when a new state was recorded. */
  record(state: T, now = Date.now(), key = ""): boolean {
    const s = JSON.stringify(state);
    if (s === this.cur) return false;
    const fold = key === this.lastKey && now - this.lastAt < this.window && this.past.length > 0;
    if (!fold) { this.past.push(this.cur); if (this.past.length > this.limit) this.past.shift(); }
    this.cur = s; this.future = []; this.lastAt = now; this.lastKey = key;
    if (!fold) this.actions++;
    return true;
  }

  undo(): T | null {
    const prev = this.past.pop(); if (prev === undefined) return null;
    this.future.push(this.cur); this.cur = prev; this.lastKey = "";
    return JSON.parse(prev) as T;
  }

  redo(): T | null {
    const next = this.future.pop(); if (next === undefined) return null;
    this.past.push(this.cur); this.cur = next; this.lastKey = "";
    return JSON.parse(next) as T;
  }

  /** Make `state` the baseline without touching the stacks (after loading a backup, etc.). */
  rebase(state: T) { this.cur = JSON.stringify(state); this.lastKey = ""; }
}
