import { Chess } from "chess.js";
import { sqIndex } from "../vision/types";
import { SQUARE, TABLE_Y, boardToWorld } from "../world/coords";
import type { Piece3D, Scene3D } from "./render3d";
import { armPose, restTarget, type ArmPose, type Hand, type V3 } from "./arm";

/** What the scenario asks the players to do at the table. Each action carries an increasing id so a player never performs one twice. */
export type TableAction =
  | { id: number; kind: "move"; color: "w" | "b"; san: string }
  | { id: number; kind: "handshake" }
  | { id: number; kind: "fist"; color: "w" | "b" };
/** A TableAction before the runner numbers it (distributes over the union, unlike plain Omit). */
export type TableAsk = TableAction extends infer A ? (A extends { id: number } ? Omit<A, "id"> : never) : never;

/** Length of one handshake (ms). */
export const SHAKE_MS = 2800;
/** Time to reach in (and to pull back out) at either end of a handshake (ms). */
const SHAKE_REACH_MS = 700;
/** A fist bangs the table at 300, 800 and 1300 ms; the last bang knocks the pieces loose. */
const FIST_FIRST_MS = 300, FIST_HIT_MS = 1300, FIST_DONE_MS = 2100;
/** How long the pieces keep tumbling after the bang (ms). */
export const SCATTER_MS = 3000;
const FIST_POINT_X = 0.08, FIST_POINT_Y = TABLE_Y + 0.05, FIST_POINT_Z = 0.3;

/** One piece knocked off the board: board coords (squares), start time (ms), roll velocity (squares/s), bounce height (m). */
interface Tumble { x0: number; y0: number; vx: number; vy: number; t0: number; hop: number }

const ease = (x: number) => { const u = Math.min(1, Math.max(0, x)); return u * u * (3 - 2 * u); };
const lerp3 = (a: V3, b: V3, k: number): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

/**
 * Stand-in for the physical world so the whole pipeline runs without hardware: a real chess
 * position, a hand that travels between squares while carrying a piece, and a seat/pointer.
 * `scene3d()` exports it as geometry for the fake-camera ray-caster.
 */
export class VirtualTable {
  game = new Chess();
  /** square index currently in the hand (the piece is lifted off the board while carried) */
  carried: number | null = null;
  hand: { x: number; y: number } | null = null; // board coords 0..8
  seated = false;
  pointer: { x: number; y: number } | null = null;
  /** a mouse button is held: the stand-in for a fingertip touching the table */
  pointerDown = false;
  /** false while the pieces are only projected: the cameras and the 3D view then see a bare board */
  piecesVisible = true;
  /** whose arms reach over the board: +1 = white (at +z), -1 = black */
  side: 1 | -1 = 1;
  /** the arm doing the reaching; the other one waits at the table edge */
  activeHand: Hand = "R";
  /** where the fingertips are right now (smoothed toward the hand target each tick); null while both arms are away */
  visual: { p: V3; grasp: number } | null = null;
  private lastT: number | null = null;
  /** UI mode: white's hand hovers wherever the pointer is, covering squares so cameras lose sight of them */
  hoverHand = false;
  /** draw shoulders, upper arms and forearms (they hide squares from the cameras); off leaves just the hands */
  forearms = true;
  private queue: { at: number; fn: () => void }[] = [];
  /** time of the last tick (ms): the animations below are all timed from it */
  private clock = 0;
  /** start of the current handshake (ms), null when nobody is shaking */
  private shakeAt: number | null = null;
  /** the fist that is banging the table: which side, and when it started (ms) */
  private fist: { side: 1 | -1; at: number } | null = null;
  /** the pieces knocked loose by the last fist bang */
  private scatter: { at: number; pieces: Map<number, Tumble> } | null = null;
  private seed = 12345;
  /** Set when a player resigns or agrees a draw; mate and stalemate still come from chess.js. */
  ended: { kind: "resign"; color: "w" | "b" } | { kind: "draw" } | null = null;

  reset() {
    this.game = new Chess(); this.carried = null; this.hand = null; this.queue = []; this.visual = null; this.lastT = null; this.side = 1;
    this.shakeAt = null; this.fist = null; this.scatter = null; this.ended = null;
  }

  /** True after mate, stalemate, a resignation, or an agreed draw. */
  get over() { return this.ended !== null || this.game.isGameOver(); }

  /** Undo the last ply, or cancel a resignation / agreed draw. False while a hand is still moving. */
  takeback(): boolean {
    if (this.busy) return false;
    if (this.ended) { this.ended = null; return true; }
    return this.game.undo() !== null;
  }

  /** The side to move gives up. False if the game is already over. */
  resign(color: "w" | "b"): boolean {
    if (this.over) return false;
    this.ended = { kind: "resign", color }; return true;
  }

  /** Both sides agree a draw. False if the game is already over. */
  agreeDraw(): boolean {
    if (this.over) return false;
    this.ended = { kind: "draw" }; return true;
  }

  /** Changes whenever anything a camera could see changes (lets renderers cache the clean image). */
  get sceneKey() {
    const v = this.visual;
    return `${this.piecesVisible ? "" : "bare|"}${this.game.fen()}|${this.carried}|${this.hand?.x},${this.hand?.y}|${v ? `${Math.round(v.p[0] * 1000)},${Math.round(v.p[1] * 1000)},${Math.round(v.p[2] * 1000)},${Math.round(v.grasp * 10)},${this.side}${this.activeHand}` : ""}|${this.fxFrame()}`;
  }

  /** While a handshake, fist or tumble is on screen, a coarse clock: renderers re-cast a few times a second, and not at all when idle. */
  private fxFrame(): string {
    const c = this.clock;
    const live = (this.shakeAt !== null && c - this.shakeAt < SHAKE_MS) || (this.fist !== null && c - this.fist.at < FIST_DONE_MS) || (this.scatter !== null && c - this.scatter.at < SCATTER_MS + 1000);
    return live ? String(Math.round(c / 40)) : "";
  }

  /** Hover mode: white's arm follows the pointer and only switches arms after crossing the centre line by a margin. */
  setHoverHand() {
    this.side = 1;
    if (!this.hand) return;
    const x = boardToWorld(this.hand.x, 0)[0];
    if (x > 0.04) this.activeHand = "R"; else if (x < -0.04) this.activeHand = "L";
  }

  /** Where the fingertips want to be: over the hand's square, at piece height when gripping. */
  handTarget(): { p: V3; grasp: number } | null {
    if (!this.hand) return null;
    const [x, , z] = boardToWorld(this.hand.x, this.hand.y), grip = this.carried !== null;
    return { p: [x, TABLE_Y + (grip ? 0.105 : 0.07), z], grasp: grip ? 1 : 0 };
  }

  /** Both arms (reaching one first, resting one second) solved by inverse kinematics. Empty while nobody is reaching. */
  arms(): ArmPose[] {
    const poses = this.fxPoses() ?? this.reachPoses();
    return this.forearms ? poses : poses.map((p) => ({ ...p, capsules: p.capsules.slice(2) })); // the first two capsules are upper arm and forearm
  }

  private reachPoses(): ArmPose[] {
    const t = this.visual ?? this.handTarget();
    if (!t) return [];
    const idle: Hand = this.activeHand === "R" ? "L" : "R";
    return [
      armPose({ side: this.side, hand: this.activeHand, tip: t.p, grasp: t.grasp, active: true, grip: this.carried !== null ? "pinch" : "fist" }),
      armPose({ side: this.side, hand: idle, tip: restTarget(this.side, idle), grasp: 0, active: false }),
    ];
  }

  /** Arms for the handshake and the fist; null when neither is happening. */
  private fxPoses(): ArmPose[] | null {
    if (this.shakeAt !== null && this.clock - this.shakeAt < SHAKE_MS) {
      // both players glide their right hands to the middle of the board, clasp, pump three times, then let go and go back
      const e = this.clock - this.shakeAt;
      const w = e < SHAKE_REACH_MS ? ease(e / SHAKE_REACH_MS) : e > SHAKE_MS - SHAKE_REACH_MS ? ease((SHAKE_MS - e) / SHAKE_REACH_MS) : 1;
      const clasp = e >= SHAKE_REACH_MS * 0.8 && e <= SHAKE_MS - SHAKE_REACH_MS * 0.8 ? 1 : 0;
      const pumping = Math.min(1, Math.max(0, Math.min(e - SHAKE_REACH_MS, SHAKE_MS - SHAKE_REACH_MS - e) / 200));
      const pump = 0.22 * pumping * Math.sin(((e - SHAKE_REACH_MS) / 1000) * Math.PI * 4.5); // forearm swing about the still elbow (radians)
      const poses: ArmPose[] = [];
      for (const side of [1, -1] as const) {
        const meet: V3 = [0, TABLE_Y + 0.13, side * 0.035]; // the two hands meet on the centre line, a thumb's width apart
        const at = lerp3(restTarget(side, "R"), meet, w);
        at[1] += 0.08 * Math.sin(Math.PI * w) * (1 - w); // a little arc on the way in and out instead of a straight line
        poses.push(armPose({ side, hand: "R", tip: at, grasp: 0.55 * clasp, active: true, pivot: pump }));
        poses.push(armPose({ side, hand: "L", tip: restTarget(side, "L"), grasp: 0, active: false }));
      }
      return poses;
    }
    if (this.fist !== null && this.clock - this.fist.at < FIST_DONE_MS) {
      // the losing player's right fist rises, bangs the table three times, then goes back to the edge
      const { side } = this.fist, e = this.clock - this.fist.at;
      const w = e < FIST_FIRST_MS ? ease(e / FIST_FIRST_MS) : e <= FIST_HIT_MS ? 1 : 1 - ease((e - FIST_HIT_MS) / (FIST_DONE_MS - FIST_HIT_MS));
      const lift = e > FIST_FIRST_MS && e <= FIST_HIT_MS ? 0.2 * Math.abs(Math.sin((Math.PI * (e - FIST_FIRST_MS)) / 500)) : 0;
      const at = lerp3(restTarget(side, "R"), [FIST_POINT_X, FIST_POINT_Y, side * FIST_POINT_Z], w);
      at[1] += lift;
      return [
        armPose({ side, hand: "R", tip: at, grasp: 1, active: true }),
        armPose({ side, hand: "L", tip: restTarget(side, "L"), grasp: 0, active: false }),
      ];
    }
    return null;
  }

  /** True while a physical move, handshake or fist is still being animated. */
  get busy() { return this.queue.length > 0; }

  /** Both players shake hands over the board. Ignored while the table is busy, so two players can call it on the same tick. */
  handshake(now: number) {
    if (this.busy) return;
    this.queue.push({ at: now, fn: () => { this.shakeAt = now; } });
    this.queue.push({ at: now + SHAKE_MS, fn: () => {} }); // stay busy until the handshake is over
  }

  /** The losing player bangs the table with a fist; the last bang knocks every piece loose. */
  fistBang(color: "w" | "b", now: number) {
    if (this.busy) return;
    const side: 1 | -1 = color === "w" ? 1 : -1;
    this.queue.push({ at: now, fn: () => { this.fist = { side, at: now }; } });
    this.queue.push({ at: now + FIST_HIT_MS, fn: () => this.startScatter(now + FIST_HIT_MS) });
    this.queue.push({ at: now + FIST_HIT_MS + SCATTER_MS, fn: () => {} });
  }

  private rand() { this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff; return this.seed / 0x80000000; }

  private startScatter(at: number) {
    const pieces = new Map<number, Tumble>();
    this.game.board().forEach((row, r) => row.forEach((p, c) => {
      if (!p) return;
      const dir = this.rand() * Math.PI * 2, speed = 4 + this.rand() * 3; // squares per second before friction
      pieces.set(r * 8 + c, { x0: c + 0.5, y0: r + 0.5, vx: Math.cos(dir) * speed, vy: Math.sin(dir) * speed, t0: at + this.rand() * 200, hop: 0.06 + this.rand() * 0.06 });
    }));
    this.scatter = { at, pieces };
  }

  /** Where a knocked-loose piece is now (board coords + height), or null once it has rolled off the table. */
  private tumblePos(tb: Tumble, now: number): { x: number; y: number; h: number } | null {
    const s = Math.max(0, now - tb.t0) / 1000;
    const k = 1.1, travel = (1 - Math.exp(-k * s)) / k; // friction: the roll slows to a stop
    const x = tb.x0 + tb.vx * travel, y = tb.y0 + tb.vy * travel;
    if (x < -0.5 || x > 8.5 || y < -0.5 || y > 8.5) return null;
    const h = s > 0 ? tb.hop * Math.abs(Math.sin((Math.PI * s) / 0.45)) * Math.exp(-1.8 * s) : 0; // bounces that die out
    return { x, y, h };
  }

  /** Colour grid as a camera would see it from above (carried piece counted as absent). */
  grid(): string[] {
    const g = this.game.board().flat().map((p) => (p ? p.color : ""));
    if (this.carried !== null) g[this.carried] = "";
    return g;
  }

  scene3d(): Scene3D {
    const pieces: Piece3D[] = [];
    this.game.board().forEach((row, r) => row.forEach((p, c) => {
      if (!p) return;
      const idx = r * 8 + c;
      const tb = this.scatter?.pieces.get(idx);
      if (tb) {
        const q = this.tumblePos(tb, this.clock);
        if (q) { const [x, , z] = boardToWorld(q.x, q.y); pieces.push({ type: p.type, color: p.color, x, y: TABLE_Y + q.h, z }); }
        return;
      }
      if (idx === this.carried && this.hand) {
        const [x, , z] = boardToWorld(this.hand.x, this.hand.y);
        pieces.push({ type: p.type, color: p.color, x, y: TABLE_Y + 0.06, z });
      } else {
        const [x, y, z] = boardToWorld(c + 0.5, r + 0.5);
        pieces.push({ type: p.type, color: p.color, x, y, z });
      }
    }));
    return { pieces: this.piecesVisible ? pieces : [], blobs: [], capsules: this.arms().flatMap((a) => a.capsules) };
  }

  /** Physically play a move (SAN or UCI): hand goes to `from`, lifts, travels, drops. Returns false when illegal. */
  play(move: string, now: number): boolean {
    if (this.over) return false;
    const m = this.game.moves({ verbose: true }).find((x) => x.san === move || x.from + x.to + (x.promotion ?? "") === move);
    if (!m) return false;
    const from = sqIndex(m.from), to = sqIndex(m.to);
    const c = (i: number) => ({ x: (i % 8) + 0.5, y: Math.floor(i / 8) + 0.5 });
    // the board snapshot at the moment of the hand's departure decides which piece is carried
    const side: 1 | -1 = m.color === "w" ? 1 : -1;
    this.queue.push({ at: now, fn: () => {
      if (side !== this.side) this.visual = null; // the other player reaches in: arms come from the other end of the table
      this.side = side; this.hand = c(from);
      this.activeHand = (boardToWorld(c(from).x, 0)[0] * side >= 0 ? "R" : "L"); // the arm on the near side of the piece
    } });
    this.queue.push({ at: now + 500, fn: () => { this.carried = from; } });
    this.queue.push({ at: now + 900, fn: () => { this.hand = c(to); } });
    this.queue.push({ at: now + 1500, fn: () => { this.carried = null; this.game.move(m); } });
    this.queue.push({ at: now + 1900, fn: () => { this.hand = null; } });
    return true;
  }

  /**
   * Physically carry whatever stands on `from` to `to`, legal or not (a clumsy human). The piece is simply put down on the new square,
   * so the cameras see the wrong arrangement and the tracker has to cope. Returns false when `from` is empty or `to` is taken.
   */
  relocate(from: number, to: number, now: number): boolean {
    const name = (i: number) => "abcdefgh"[i % 8] + (8 - Math.floor(i / 8));
    const p = this.game.get(name(from) as any);
    if (!p || this.game.get(name(to) as any) || from === to) return false;
    const c = (i: number) => ({ x: (i % 8) + 0.5, y: Math.floor(i / 8) + 0.5 });
    const side: 1 | -1 = p.color === "w" ? 1 : -1;
    this.queue.push({ at: now, fn: () => {
      if (side !== this.side) this.visual = null;
      this.side = side; this.hand = c(from);
      this.activeHand = (boardToWorld(c(from).x, 0)[0] * side >= 0 ? "R" : "L");
    } });
    this.queue.push({ at: now + 500, fn: () => { this.carried = from; } });
    this.queue.push({ at: now + 900, fn: () => { this.hand = c(to); } });
    this.queue.push({ at: now + 1500, fn: () => { this.carried = null; this.game.remove(name(from) as any); this.game.put(p, name(to) as any); } });
    this.queue.push({ at: now + 1900, fn: () => { this.hand = null; } });
    return true;
  }

  tick(now: number) {
    this.clock = now;
    const due = this.queue.filter((q) => q.at <= now);
    this.queue = this.queue.filter((q) => q.at > now);
    due.forEach((q) => q.fn());
    this.moveArms(now);
  }

  /** Eases the fingertips toward the hand target (or back to rest), so arms glide instead of teleporting between squares. */
  private moveArms(now: number) {
    const dt = this.lastT === null ? 0 : Math.min(0.25, (now - this.lastT) / 1000);
    this.lastT = now;
    const t = this.handTarget(), k = 1 - Math.exp(-dt * 9);
    if (t && !this.visual) this.visual = { p: restTarget(this.side, this.activeHand), grasp: 0 };
    const goal = t ?? (this.visual ? { p: restTarget(this.side, this.activeHand), grasp: 0 } : null);
    if (!goal || !this.visual) return;
    const v = this.visual;
    for (let i = 0; i < 3; i++) v.p[i] += (goal.p[i] - v.p[i]) * k;
    v.grasp += (goal.grasp - v.grasp) * k;
    if (!t && Math.hypot(v.p[0] - goal.p[0], v.p[1] - goal.p[1], v.p[2] - goal.p[2]) < 0.012) this.visual = null; // both arms are back at rest
  }
}

/** A player at the table carries out one scenario action. Moves are only played by the player of that colour; a handshake or fist is idempotent, so two players can both call it. */
export function performAction(table: VirtualTable, a: TableAction, color: "w" | "b", now: number): boolean {
  if (a.kind === "handshake") { table.handshake(now); return true; }
  if (a.color !== color) return false;
  if (a.kind === "fist") { table.fistBang(color, now); return true; }
  return table.play(a.san, now);
}

export const virtualTable = new VirtualTable();
