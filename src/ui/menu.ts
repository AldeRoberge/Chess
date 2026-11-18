export type Item =
  | { kind: "action"; label: string; run(): void; disabled?: boolean; hint?: string; danger?: boolean; icon?: string }
  | { kind: "toggle"; label: string; get(): boolean; set(v: boolean): void; hint?: string; remove?: { label: string; run(): void } }
  | { kind: "choice"; label: string; options: { value: string; label: string }[]; get(): string; set(v: string): void; hint?: string }
  | { kind: "slider"; label: string; min: number; max: number; step: number; get(): number; set(v: number): void; fmt?: (v: number) => string; hint?: string }
  | { kind: "text"; label: string; get(): string; set(v: string): void; hint?: string }
  | { kind: "info"; label: string; value?: string; tone?: "ok" | "warn" | "fail" };

export type Outcome = "none" | "changed" | "ran" | "edit";

export const isFocusable = (i: Item) => i.kind !== "info";

export function valueText(i: Item): string {
  switch (i.kind) {
    case "toggle": return i.get() ? "On" : "Off";
    case "choice": return i.options.find((o) => o.value === i.get())?.label ?? i.get();
    case "slider": return i.fmt ? i.fmt(i.get()) : String(round(i.get()));
    case "text": return i.get();
    case "info": return i.value ?? "";
    case "action": return "";
  }
}

const round = (v: number) => Math.round(v * 1000) / 1000;

/** Left / right on an item. */
export function adjust(i: Item, dir: -1 | 1): Outcome {
  switch (i.kind) {
    case "toggle": i.set(!i.get()); return "changed";
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
    case "text": return "edit";
    default: return "none";
  }
}
