import type { Pt } from "../vision/types";

/** Four draggable board corners (a8, h8, h1, a1) over a camera preview, in image-pixel space. */
export class CornerPicker {
  active = -1;
  constructor(public corners: Pt[], public w: number, public h: number, public radius = 14) {}

  /** Index of the corner within grab radius of (x,y), or -1. Picks the nearest if several overlap. */
  hit(x: number, y: number): number {
    let best = -1, bd = this.radius;
    this.corners.forEach((c, i) => { const d = Math.hypot(c.x - x, c.y - y); if (d <= bd) { bd = d; best = i; } });
    return best;
  }

  down(x: number, y: number) { this.active = this.hit(x, y); return this.active >= 0; }
  move(x: number, y: number) { if (this.active >= 0) this.set(this.active, x, y); }
  up() { this.active = -1; }

  set(i: number, x: number, y: number) { this.corners[i] = { x: Math.min(this.w, Math.max(0, x)), y: Math.min(this.h, Math.max(0, y)) }; }
  nudge(i: number, dx: number, dy: number) { this.set(i, this.corners[i].x + dx, this.corners[i].y + dy); }

  /** A board must be a convex quad listed clockwise on screen; reports why not. */
  validate(): string | null {
    const c = this.corners;
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = c[i], b = c[(i + 1) % 4], d = c[(i + 2) % 4];
      const cross = (b.x - a.x) * (d.y - b.y) - (b.y - a.y) * (d.x - b.x);
      if (Math.abs(cross) < 1) return "Corners are collinear.";
      const s = Math.sign(cross);
      if (sign && s !== sign) return "Corners must form a convex quadrilateral, in order a8, h8, h1, a1.";
      sign = s;
    }
    return null;
  }
}
