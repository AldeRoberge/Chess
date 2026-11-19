/** A button on a value row that fills the value automatically. `about` is the tooltip while the button is usable; `hint` explains why it is disabled. */
export interface AutoAction { label: string; run(): void; disabled?: boolean; hint?: string; about?: string }

export type Item =
  | { kind: "action"; label: string; run(): void; disabled?: boolean; hint?: string; danger?: boolean; icon?: string }
  /** `verbs` replaces the On/Off value with the action a click performs (e.g. "Disable" while on). */
  | { kind: "toggle"; label: string; get(): boolean; set(v: boolean): void; hint?: string; icon?: string; verbs?: { on: string; off: string }; remove?: { label: string; run(): void } }
  | { kind: "choice"; label: string; options: { value: string; label: string }[]; get(): string; set(v: string): void; hint?: string; icon?: string; auto?: AutoAction }
  /** `visual` is a picture under the slider row, refreshed by `update` as the value moves. `auto` adds an auto-detect button to the row. */
  | { kind: "slider"; label: string; min: number; max: number; step: number; get(): number; set(v: number): void; fmt?: (v: number) => string; hint?: string; icon?: string; auto?: AutoAction; visual?: { el: HTMLElement; update(v: number): void; onPick?: (v: number, final: boolean) => void } }
  | { kind: "text"; label: string; get(): string; set(v: string): void; hint?: string; icon?: string; /** Masks the value (API keys). */ secret?: boolean }
  /** A collapsible section: its children are listed right under it while open. `summary` shows on the closed row. `auto` is a button on the section row. */
  | { kind: "group"; label: string; icon?: string; summary?: string; get(): boolean; set(v: boolean): void; children: Item[]; auto?: AutoAction }
  | { kind: "info"; label: string; value?: string; tone?: "ok" | "warn" | "fail" };

export type Outcome = "none" | "changed" | "ran" | "edit";

export const isFocusable = (i: Item) => i.kind !== "info";

export function valueText(i: Item): string {
  switch (i.kind) {
    case "toggle": return i.verbs ? (i.get() ? i.verbs.on : i.verbs.off) : i.get() ? "On" : "Off";
    case "choice": return i.options.find((o) => o.value === i.get())?.label ?? i.get();
    case "slider": return i.fmt ? i.fmt(i.get()) : String(round(i.get()));
    case "text": return i.get();
    case "info": return i.value ?? "";
    case "group": return i.summary ?? "";
    case "action": return "";
  }
}

const round = (v: number) => Math.round(v * 1000) / 1000;

/** Left / right on an item. */
export function adjust(i: Item, dir: -1 | 1): Outcome {
  switch (i.kind) {
    case "toggle": i.set(!i.get()); return "changed";
    case "group": if (i.get() === (dir > 0)) return "none"; i.set(dir > 0); return "changed";
    case "choice": {
      const k = i.options.findIndex((o) => o.value === i.get());
      i.set(i.options[(k + dir + i.options.length) % i.options.length].value);
      return "changed";
    }
    case "slider": {
      const v = Math.min(i.max, Math.max(i.min, round(i.get() + dir * i.step)));
      if (v === i.get()) return "none";
      i.set(v);
      return "changed";
    }
    default: return "none";
  }
}

/** Enter / A on an item. */
export function activate(i: Item): Outcome {
  switch (i.kind) {
    case "action": if (i.disabled) return "none"; i.run(); return "ran";
    case "toggle": case "choice": return adjust(i, 1);
    case "group": i.set(!i.get()); return "changed";
    case "text": return "edit";
    default: return "none";
  }
}
