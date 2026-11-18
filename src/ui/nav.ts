export type NavAction = "up" | "down" | "left" | "right" | "select" | "back" | "next" | "prev";

const KEYS: Record<string, NavAction> = {
  ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Enter: "select", " ": "select", Escape: "back", Backspace: "back", PageDown: "next", PageUp: "prev",
  w: "up", s: "down", a: "left", d: "right",
};

export const keyToAction = (key: string): NavAction | null => KEYS[key] ?? null;

/** Standard-mapping gamepad: D-pad 12-15, left stick, A=0 select, B=1 back, bumpers 4/5 prev/next, Start 9 select. */
export function padToActions(pad: { buttons: readonly { pressed: boolean }[]; axes: readonly number[] }): NavAction[] {
  const b = (i: number) => !!pad.buttons[i]?.pressed;
  const [ax = 0, ay = 0] = pad.axes;
  const out: NavAction[] = [];
  if (b(12) || ay < -0.6) out.push("up");
  if (b(13) || ay > 0.6) out.push("down");
  if (b(14) || ax < -0.6) out.push("left");
  if (b(15) || ax > 0.6) out.push("right");
  if (b(0) || b(9)) out.push("select");
  if (b(1)) out.push("back");
  if (b(4)) out.push("prev");
  if (b(5)) out.push("next");
  return out;
}

/** Edge-triggered with auto-repeat for held directions, like a console menu. */
export class GamepadPoller {
  private held = new Map<NavAction, number>(); // action -> next fire time
  constructor(public firstDelay = 380, public repeat = 110) {}

  poll(now: number): NavAction[] {
    const pad = [...(navigator.getGamepads?.() ?? [])].find((p) => p && p.connected);
    const active = new Set(pad ? padToActions(pad) : []);
    const fire: NavAction[] = [];
    for (const a of active) {
      const due = this.held.get(a);
      if (due === undefined) { fire.push(a); this.held.set(a, now + this.firstDelay); }
      else if (now >= due && a !== "select" && a !== "back") { fire.push(a); this.held.set(a, now + this.repeat); }
    }
    for (const a of [...this.held.keys()]) if (!active.has(a)) this.held.delete(a);
    return fire;
  }
}
