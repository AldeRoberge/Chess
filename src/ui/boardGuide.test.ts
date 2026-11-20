import { describe, expect, it } from "vitest";
import type { GrayFrame, Pt } from "../vision/types";
import { AlignmentMeter, GOOD, alignColor, drawEdgeIcons, drawMatrixGround, edgeIcons, pieceSides, piecesLookTurned, readPerspective, scoreAlignment, snapLevel, netFit, startOrientation, traceSquareGuide } from "./boardGuide";
import { VirtualTable } from "../sim/virtualTable";
import { RIGS, rigCorners } from "../sim/rigs";
import { shoot } from "../test/helpers";
import { loadBoardCnn } from "../vision/boardModel";
import { squareToQuad } from "./quadEditor";

/** A flat checkerboard: squares of `sq` px with the board's a8 corner at (x0, y0). a1 is dark unless `flip`. */
function board(sq = 40, x0 = 80, y0 = 20, flip = false, noise = 0, W = 480, H = 360): GrayFrame {
  const data = new Uint8ClampedArray(W * H).fill(128); let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * noise;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = Math.floor((x - x0) / sq), r = Math.floor((y - y0) / sq);
    if (c >= 0 && c < 8 && r >= 0 && r < 8) { const dark = (c + 8 - r) % 2 === 1; data[y * W + x] = Math.max(0, Math.min(255, (dark !== flip ? 70 : 190) + rnd())); }
  }
  return blur({ width: W, height: H, data, t: 0 }, 3); // a real lens is never razor sharp
}
/** Box blur (radius r, both directions) so the brightness step across an edge is a ramp, like a camera picture. */
function blur(f: GrayFrame, r: number): GrayFrame {
  const { width: W, height: H } = f, tmp = new Float32Array(W * H), out = new Uint8ClampedArray(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let a = 0, n = 0; for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < W) { a += f.data[y * W + xx]; n++; } } tmp[y * W + x] = a / n; }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let a = 0, n = 0; for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < H) { a += tmp[yy * W + x]; n++; } } out[y * W + x] = a / n; }
  return { ...f, data: out };
}
const corners = (sq = 40, x0 = 80, y0 = 20, dx = 0, dy = 0): Pt[] => [{ x: x0 + dx, y: y0 + dy }, { x: x0 + 8 * sq + dx, y: y0 + dy }, { x: x0 + 8 * sq + dx, y: y0 + 8 * sq + dy }, { x: x0 + dx, y: y0 + 8 * sq + dy }];
const q = (f: GrayFrame, c: Pt[]) => scoreAlignment(f, squareToQuad(c));

describe("piece sides", () => {
  /** Start-position blotches: `top` ink on the two top rows, `bottom` ink on the two bottom rows. */
  const withPieces = (top: number, bottom: number) => {
    const f = board();
    for (const [r, ink] of [[0, top], [1, top], [6, bottom], [7, bottom]] as const) for (let c = 0; c < 8; c++)
      for (let y = 20 + r * 40 + 10; y < 20 + r * 40 + 30; y++) for (let x = 80 + c * 40 + 10; x < 80 + c * 40 + 30; x++) f.data[y * 480 + x] = ink;
    return f;
  };
  it("is positive with white at the bottom and flags a turned board", () => {
    expect(pieceSides(withPieces(15, 245), corners())).toBeGreaterThan(0.25);
    expect(piecesLookTurned(withPieces(15, 245), corners())).toBe(false);
    expect(pieceSides(withPieces(245, 15), corners())).toBeLessThan(-0.25);
    expect(piecesLookTurned(withPieces(245, 15), corners())).toBe(true);
  });
  it("says nothing for an empty board", () => { expect(piecesLookTurned(board(), corners())).toBe(false); });
});

describe("alignment score", () => {
  it("falls steadily as the grid drifts off the squares", () => {
    const f = board(), qs = [0, 1, 2, 4, 8, 16].map((d) => q(f, corners(40, 80, 20, d, d)));
    expect(qs[0].q).toBeGreaterThan(0.9); expect(qs[0].error).toBeLessThan(0.03); expect(qs[1].q).toBeGreaterThan(GOOD);
    for (let i = 1; i < qs.length; i++) expect(qs[i].q).toBeLessThanOrEqual(qs[i - 1].q + 1e-9);
    expect(qs[3].q).toBeLessThan(GOOD); expect(qs[4].q).toBeLessThan(0.45); expect(qs[5].q).toBeLessThan(0.1); expect(qs[0].flipped).toBe(false);
  });
  it("copes with noise, a tilted grid, a pieces-like blotch and a different scale", () => {
    expect(q(board(40, 80, 20, false, 30), corners()).q).toBeGreaterThan(GOOD);
    const tilted: Pt[] = [{ x: 80, y: 20 }, { x: 400, y: 30 }, { x: 400, y: 340 }, { x: 80, y: 330 }];
    expect(q(board(), tilted).q).toBeLessThan(q(board(), corners()).q);
    expect(q(board(30, 100, 40), corners(30, 100, 40)).q).toBeGreaterThan(0.9); expect(q(board(), corners(30, 100, 40)).q).toBeLessThan(0.5);
    const f = board(); for (const [cx, cy] of [[100, 40], [180, 60], [260, 100], [300, 140]]) for (let y = cy - 12; y < cy + 12; y++) for (let x = cx - 12; x < cx + 12; x++) f.data[y * 480 + x] = 20; // pieces on a few squares
    expect(q(f, corners()).q).toBeGreaterThan(GOOD);
  });
  it("gives nothing for a flat picture, a grid off the picture, and flags swapped colours", () => {
    const flat = { width: 480, height: 360, data: new Uint8ClampedArray(480 * 360).fill(100), t: 0 };
    expect(q(flat, corners())).toMatchObject({ q: 0, flipped: false }); expect(q(board(), corners(40, 700, 20)).q).toBe(0);
    const flipped = q(board(40, 80, 20, true), corners()); expect(flipped.flipped).toBe(true); expect(flipped.q).toBeLessThanOrEqual(0.45);
  });
  it("does not call the colours flipped just because pieces cover the square centres", () => {
    const f = board();
    for (let r = 1; r < 7; r++) for (let c = 1; c < 7; c++) {
      const dark = (c + 8 - r) % 2 === 1, ink = dark ? 235 : 15;
      for (let y = 20 + r * 40 + 14; y < 20 + r * 40 + 26; y++) for (let x = 80 + c * 40 + 14; x < 80 + c * 40 + 26; x++) f.data[y * 480 + x] = ink;
    }
    const a = q(f, corners());
    expect(a.flipped).toBe(false); expect(a.q).toBeGreaterThan(GOOD);
  });
  it("treats a pure shift as a shift, and a pulled corner as a tilt", () => {
    const f = board();
    expect(q(f, corners()).warp).toBeLessThan(0.025);
    expect(q(f, corners(40, 80, 20, 5, 0)).warp).toBeLessThan(0.04);
    const pulled: Pt[] = [{ x: 80, y: 20 }, { x: 400, y: 20 }, { x: 400, y: 340 }, { x: 40, y: 300 }];
    expect(q(f, pulled).warp).toBeGreaterThan(q(f, corners()).warp + 0.015);
  });
  it("rebuilds the corners from the square edges, and still does when only the middle is visible", () => {
    const f = board(), truth = corners();
    const off = corners(40, 80, 20, 6, -4);
    const g = traceSquareGuide(f, off);
    expect(g).not.toBeNull();
    expect(Math.max(...g!.corners.map((p, i) => Math.hypot(p.x - truth[i].x, p.y - truth[i].y)))).toBeLessThan(4);
    // pieces and the border hide the rim; the empty middle is what is left to trace
    const bare = board();
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      if (r >= 2 && r <= 5 && c >= 2 && c <= 5) continue;
      for (let y = 20 + r * 40; y < 20 + (r + 1) * 40; y++) for (let x = 80 + c * 40; x < 80 + (c + 1) * 40; x++) bare.data[y * 480 + x] = 110;
    }
    const mid = traceSquareGuide(bare, off);
    expect(mid).not.toBeNull();
    expect(Math.max(...mid!.corners.map((p, i) => Math.hypot(p.x - truth[i].x, p.y - truth[i].y)))).toBeLessThan(6);
  });
  it("draws the traced edges as a transparent ground", () => {
    const g = readPerspective(board(), corners());
    expect(g).not.toBeNull();
    expect(g!.lines.length).toBeGreaterThan(8);
    const c = document.createElement("canvas").getContext("2d")!;
    let strokes = 0, fills = 0;
    const stroke = c.stroke.bind(c), fill = c.fill.bind(c);
    c.stroke = (() => { strokes++; return stroke(); }) as typeof c.stroke;
    c.fill = (() => { fills++; return fill(); }) as typeof c.fill;
    drawMatrixGround(c, g!, (p) => p);
    expect(strokes).toBeGreaterThan(6);
    expect(fills).toBe(1);
  });
});

describe("alignment meter and colours", () => {
  it("smooths the score and says what to do", () => {
    const m = new AlignmentMeter(); expect(m.feed({ q: 0, flipped: false, contrast: 0, error: 0, outside: 0, fine: 0, warp: 0 })).toBe(0); expect(m.label).toMatch(/Can't see/);
    m.feed({ q: 1, flipped: false, contrast: 90, error: 0, outside: 0, fine: 0, warp: 0 }); expect(m.q).toBeCloseTo(0.25); expect(m.good).toBe(false); expect(m.label).toMatch(/Not lined up/);
    m.feed({ q: 0.6, flipped: false, contrast: 90, error: 0, outside: 0, fine: 0, warp: 0 }, 1); expect(m.label).toMatch(/closer/); m.feed({ q: 0.95, flipped: false, contrast: 90, error: 0, outside: 0, fine: 0, warp: 0 }, 1); expect(m.good).toBe(true); expect(m.label).toBe("Nicely aligned");
    m.feed({ q: 0.4, flipped: true, contrast: 90, error: 0, outside: 0, fine: 0, warp: 0 }, 1); expect(m.good).toBe(false); expect(m.label).toMatch(/flipped/);
  });
  it("goes from orange to green", () => {
    expect(alignColor(0)).toBe("hsl(28 92% 54%)"); expect(alignColor(1)).toBe("hsl(130 92% 54%)"); expect(alignColor(-3)).toBe(alignColor(0)); expect(alignColor(9, 40)).toBe("hsl(130 92% 40%)");
  });
});

describe("edge icons", () => {
  it("lays the starting pieces along the four edges, outside the board", () => {
    const icons = edgeIcons(), by = (e: string) => icons.filter((i) => i.edge === e);
    expect(by("bottom").map((i) => i.code)).toEqual(["wr", "wn", "wb", "wq", "wk", "wb", "wn", "wr"]); expect(by("top").map((i) => i.code)).toEqual(["br", "bn", "bb", "bq", "bk", "bb", "bn", "br"]);
    expect(by("left").map((i) => i.code)).toEqual(["br", "bp", "wp", "wr"]); expect(by("right")).toHaveLength(4);
    expect(by("bottom").every((i) => i.v > 1) && by("top").every((i) => i.v < 0) && by("left").every((i) => i.u < 0) && by("right").every((i) => i.u > 1)).toBe(true);
    expect(by("left")[0].v).toBeCloseTo(0.0625); expect(by("left")[3].v).toBeCloseTo(0.9375);
  });
  it("snaps certainty to sure / unsure / guess / unknown", () => {
    expect([1, 0.9, 0.7, 0.3, 0.05].map(snapLevel)).toEqual([1, 1, 0.5, 0.2, 0]);
  });
  it("draws one badge per icon", () => {
    const c = document.createElement("canvas").getContext("2d")!, m = squareToQuad(corners()); let arcs = 0; const arc = c.arc.bind(c); c.arc = ((...a: Parameters<typeof c.arc>) => { arcs++; return arc(...a); }) as typeof c.arc;
    drawEdgeIcons(c, m, "#f90"); expect(arcs).toBe(edgeIcons().length);
  });
});

describe("which way round the corners are (neural, start position)", () => {
  const rot2 = (c: { x: number; y: number }[]) => [c[2], c[3], c[0], c[1]];
  it("says right for the corners as they are, turned for the same corners turned half way, and nothing for a bare or a wrongly gridded board", async () => {
    const net = await loadBoardCnn(), c = rigCorners(RIGS.A), table = new VirtualTable(), f = shoot(table, "A");
    const right = startOrientation(net, f, c), turned = startOrientation(net, f, rot2(c));
    expect(right.verdict).toBe("right"); expect(right.here).toBeGreaterThan(0.7); expect(right.here - right.turned).toBeGreaterThan(0.2);
    expect(turned.verdict).toBe("turned"); expect(turned.turned).toBeCloseTo(right.here, 5);
    const bare = new VirtualTable(); bare.piecesVisible = false;
    expect(startOrientation(net, shoot(bare, "A"), c).verdict).toBe("unknown");
    const off = c.map((p) => ({ x: p.x + 70, y: p.y + 40 }));
    expect(startOrientation(net, f, off).verdict).not.toBe("turned");
  });
  it("never calls a board turned unless the other order really reads as the start position", async () => {
    const net = await loadBoardCnn(), c = rigCorners(RIGS.A), table = new VirtualTable();
    for (const san of ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6"]) table.game.move(san);
    const f = shoot(table, "A");
    for (const k of [c, rot2(c)]) { const r = startOrientation(net, f, k); expect(r.verdict === "turned" ? r.turned >= 0.7 && r.turned - r.here >= 0.2 : true).toBe(true); }
  });
});

describe("netFit ranks layouts by how much the board reader believes them", () => {
  it("scores the right corners above a shifted, a shrunken and an oversized guess, at the start and mid-game", async () => {
    const net = await loadBoardCnn(), c = rigCorners(RIGS.A);
    const mid = c.reduce((a, p) => ({ x: a.x + p.x / 4, y: a.y + p.y / 4 }), { x: 0, y: 0 });
    const scale = (k: number) => c.map((p) => ({ x: mid.x + (p.x - mid.x) * k, y: mid.y + (p.y - mid.y) * k }));
    const shift = c.map((p) => ({ x: p.x + 60, y: p.y + 35 }));
    for (const moves of [[], ["e4", "e5", "Nf3", "Nc6"]]) {
      const table = new VirtualTable(); for (const m of moves) table.game.move(m);
      const f = shoot(table, "A"), good = netFit(net, f, c);
      for (const bad of [shift, scale(0.45), scale(2.2)]) expect(good).toBeGreaterThan(netFit(net, f, bad));
    }
  });
});
