import { Chess } from "chess.js";
import { sqIndex } from "../vision/types";
import { SQUARE, TABLE_Y, boardToWorld } from "../world/coords";
import type { Piece3D, Scene3D } from "./render3d";
import { armPose, restTarget, type ArmPose, type Hand, type V3 } from "./arm";

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

  reset() { this.game = new Chess(); this.carried = null; this.hand = null; this.queue = []; this.visual = null; this.lastT = null; this.side = 1; }

  /** Changes whenever anything a camera could see changes (lets renderers cache the clean image). */
  get sceneKey() {
    const v = this.visual;
    return `${this.game.fen()}|${this.carried}|${this.hand?.x},${this.hand?.y}|${v ? `${Math.round(v.p[0] * 1000)},${Math.round(v.p[1] * 1000)},${Math.round(v.p[2] * 1000)},${Math.round(v.grasp * 10)},${this.side}${this.activeHand}` : ""}`;
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
    const t = this.visual ?? this.handTarget();
    if (!t) return [];
    const idle: Hand = this.activeHand === "R" ? "L" : "R";
    const poses = [
      armPose({ side: this.side, hand: this.activeHand, tip: t.p, grasp: t.grasp, active: true }),
      armPose({ side: this.side, hand: idle, tip: restTarget(this.side, idle), grasp: 0, active: false }),
    ];
    return this.forearms ? poses : poses.map((p) => ({ ...p, capsules: p.capsules.slice(2) })); // the first two capsules are upper arm and forearm
  }

  /** True while a physical move is still being animated. */
  get busy() { return this.queue.length > 0; }

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
      if (idx === this.carried && this.hand) {
        const [x, , z] = boardToWorld(this.hand.x, this.hand.y);
        pieces.push({ type: p.type, color: p.color, x, y: TABLE_Y + 0.06, z });
      } else {
        const [x, y, z] = boardToWorld(c + 0.5, r + 0.5);
        pieces.push({ type: p.type, color: p.color, x, y, z });
      }
    }));
    return { pieces, blobs: [], capsules: this.arms().flatMap((a) => a.capsules) };
  }

  /** Physically play a move (SAN or UCI): hand goes to `from`, lifts, travels, drops. Returns false when illegal. */
  play(move: string, now: number): boolean {
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

  tick(now: number) {
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

export const virtualTable = new VirtualTable();
