import type { ExperienceEvent } from "../core/events";

export type Phase = "idle" | "intro" | "menu" | "game" | "outro";
export interface PointerSample { id: string; x: number; y: number } // table coordinates, board = 0..8
export interface Seat { id: string; x: number; y: number; angle: number } // angle: direction the player faces (deg), 0 = looking toward -y
export interface MenuButton { id: string; label: string; x: number; y: number; r: number; mode: "engine" | "human"; elo?: number }
export interface DirectorOut { phase: Phase; menu: MenuButton[]; progress: Record<string, number>; mode: "engine" | "human" | null; elo: number; events: ExperienceEvent[]; seat: Seat | null }

export interface DirectorConfig { dwellMs: number; introMs: number; outroMs: number; leaveMs: number; elos: number[]; /** fixed opponent (kiosk): skips the hover menu */ preset: "menu" | "engine" | "human"; presetElo: number }
export const defaultDirectorConfig = (): DirectorConfig => ({ dwellMs: 1500, introMs: 6000, outroMs: 8000, leaveMs: 4000, elos: [500, 1000, 1500], preset: "menu", presetElo: 1000 });

/** Lays the options out on the player's side of the table, rotated to face them. */
export function layoutMenu(seat: Seat, elos: number[]): MenuButton[] {
  const items: Omit<MenuButton, "x" | "y">[] = [
    ...elos.map((e) => ({ id: `elo${e}`, label: `Ordinateur ${e}`, r: 0.55, mode: "engine" as const, elo: e })),
    { id: "human", label: "Deux joueurs", r: 0.55, mode: "human" as const },
  ];
  // the seat may be far from the table: anchor the menu on the table edge nearest the player
  const clampT = (v: number) => Math.min(10.5, Math.max(-2.5, v));
  const sx = clampT(seat.x), sy = clampT(seat.y);
  const a = (seat.angle * Math.PI) / 180;
  const fwd = { x: Math.sin(a), y: -Math.cos(a) }; // facing direction
  const right = { x: Math.cos(a), y: Math.sin(a) };
  const gap = 1.5;
  return items.map((it, i) => {
    const off = (i - (items.length - 1) / 2) * gap;
    // buttons sit just in front of the player
    return { ...it, x: sx + fwd.x * 1.4 + right.x * off, y: sy + fwd.y * 1.4 + right.y * off };
  });
}

/**
 * Experience state machine: idle -> intro -> menu -> game -> outro -> idle.
 * Hand-hover dwell selection: hold a fingertip over a button for dwellMs (progress ring) to pick it.
 */
export class Director {
  phase: Phase = "idle";
  mode: "engine" | "human" | null = null;
  elo = 1000;
  seat: Seat | null = null;
  menu: MenuButton[] = [];
  private since = 0;
  private emptySince = 0;
  constructor(public cfg: DirectorConfig = defaultDirectorConfig()) {}

  private go(p: Phase, now: number, events: ExperienceEvent[], data: Record<string, any> = {}) {
    this.phase = p;
    this.since = now;
    events.push({ type: "phase", t: now, data: { phase: p, ...data } });
  }

  step(now: number, seats: Seat[], pointers: PointerSample[], gameEvents: ExperienceEvent[]): DirectorOut {
    const events: ExperienceEvent[] = [];
    const seat = seats[0] ?? null;
    if (seat && !this.seat) {
      this.seat = seat;
      events.push({ type: "seat", t: now, data: { id: seat.id } });
    }
    if (seat) this.seat = seat;
    this.emptySince = seat ? 0 : this.emptySince || now;

    switch (this.phase) {
      case "idle":
        if (seat) this.go("intro", now, events);
        break;
      case "intro":
        if (now - this.since >= this.cfg.introMs) {
          if (this.cfg.preset === "menu") {
            this.menu = layoutMenu(this.seat!, this.cfg.elos);
            this.go("menu", now, events);
          } else {
            this.mode = this.cfg.preset;
            this.elo = this.cfg.presetElo;
            events.push({ type: "mode", t: now, data: { mode: this.mode, elo: this.elo } });
            this.go("game", now, events);
          }
        }
        break;
      case "menu": {
        if (seat) this.menu = layoutMenu(seat, this.cfg.elos);
        const dt = now - this.lastStep; // the menu is never the first phase, so lastStep is always set
        for (const b of this.menu) {
          const hit = pointers.some((p) => Math.hypot(p.x - b.x, p.y - b.y) <= b.r);
          // decays 3x faster than it builds so a passing hand never selects
          const cur = this.dwellMs.get(b.id) ?? 0;
          const next = hit ? cur + dt : Math.max(0, cur - dt * 3);
          this.dwellMs.set(b.id, next);
          if (next >= this.cfg.dwellMs) {
            this.mode = b.mode;
            if (b.elo) this.elo = b.elo;
            events.push({ type: "mode", t: now, data: { mode: b.mode, elo: this.elo } });
            this.dwellMs.clear();
            this.go("game", now, events);
            break;
          }
        }
        if (!seat && now - this.emptySince > this.cfg.leaveMs) this.go("idle", now, events);
        break;
      }
      case "game": {
        const over = gameEvents.find((e) => e.type === "mate" || e.type === "draw");
        if (over) this.go("outro", now, events, { result: over.type === "mate" ? `échec et mat, ${over.data?.color === "w" ? "victoire des blancs" : "victoire des noirs"}` : "partie nulle" });
        else if (!seat && now - this.emptySince > this.cfg.leaveMs * 3) { events.push({ type: "leave", t: now }); this.go("outro", now, events); }
        break;
      }
      case "outro":
        if (now - this.since >= this.cfg.outroMs) { this.mode = null; this.go("idle", now, events); }
        break;
    }
    this.lastStep = now;
    const progress: Record<string, number> = {};
    for (const [k, v] of this.dwellMs) progress[k] = Math.min(1, v / this.cfg.dwellMs);
    return { phase: this.phase, menu: this.phase === "menu" ? this.menu : [], progress, mode: this.mode, elo: this.elo, events, seat: this.seat };
  }
  private lastStep = 0;
  private dwellMs = new Map<string, number>();
}
