import { describe, expect, it } from "vitest";
import { VirtualTable } from "../sim/virtualTable";
import { RIGS, rigCorners } from "../sim/rigs";
import { flatFrame, shoot } from "../test/helpers";
import { applyH, boardToImage, invertH, solveHomography } from "./homography";
import { Fusion } from "./fusion";
import { BoardSampler, defaultSamplerConfig } from "./sampler";
import { Stabilizer } from "./stabilizer";
import { rng, startGrid } from "./synthetic";
import { BONES, JOINT_NAMES, cameraMatrix, project, rayToPlane, triangulate } from "./triangulate";
import { clamp, logit, sigmoid, sqIndex, sqName, type BoardBelief, type GrayFrame, type SquareObs } from "./types";

const sq = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

describe("types helpers", () => {
  it("names and indexes squares symmetrically (a8=0, h1=63)", () => {
    expect(sqName(0)).toBe("a8"); expect(sqName(63)).toBe("h1"); expect(sqName(52)).toBe("e2");
    for (let i = 0; i < 64; i++) expect(sqIndex(sqName(i))).toBe(i);
  });
  it("clamps, and keeps logit finite at the extremes", () => {
    expect(clamp(5, 0, 1)).toBe(1); expect(clamp(-5, 0, 1)).toBe(0); expect(clamp(0.5, 0, 1)).toBe(0.5);
    expect(sigmoid(0)).toBe(0.5);
    expect(Number.isFinite(logit(0))).toBe(true); expect(Number.isFinite(logit(1))).toBe(true);
    expect(logit(sigmoid(2))).toBeCloseTo(2, 5);
  });
});

describe("homography", () => {
  it("maps the four source points exactly onto the four destination points", () => {
    const dst = [{ x: 10, y: 5 }, { x: 90, y: 12 }, { x: 80, y: 70 }, { x: 4, y: 60 }];
    const H = solveHomography(sq, dst);
    sq.forEach((p, i) => { const q = applyH(H, p.x, p.y); expect(q.x).toBeCloseTo(dst[i].x, 6); expect(q.y).toBeCloseTo(dst[i].y, 6); });
  });
  it("inverts: apply then invert returns the original point", () => {
    const H = solveHomography(sq, [{ x: 10, y: 5 }, { x: 90, y: 12 }, { x: 80, y: 70 }, { x: 4, y: 60 }]);
    const p = applyH(H, 0.3, 0.7), b = applyH(invertH(H), p.x, p.y);
    expect(b.x).toBeCloseTo(0.3, 6); expect(b.y).toBeCloseTo(0.7, 6);
  });
  it("rejects degenerate (collinear) correspondences", () => {
    const line = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }];
    expect(() => solveHomography(line, sq)).toThrow("degenerate homography");
  });
  it("boardToImage sends board corners to the given image corners", () => {
    const c = [{ x: 40, y: 20 }, { x: 440, y: 20 }, { x: 440, y: 340 }, { x: 40, y: 340 }];
    const H = boardToImage(c);
    expect(applyH(H, 0, 0).x).toBeCloseTo(40, 6); expect(applyH(H, 8, 8).y).toBeCloseTo(340, 6); expect(applyH(H, 4, 4).x).toBeCloseTo(240, 6);
  });
});

describe("synthetic helpers", () => {
  it("rng is deterministic per seed, uniform in [0,1), and tolerates seed 0", () => {
    const a = rng(5), b = rng(5), c = rng(6);
    const xs = Array.from({ length: 50 }, a), ys = Array.from({ length: 50 }, b), zs = Array.from({ length: 50 }, c);
    expect(xs).toEqual(ys); expect(xs).not.toEqual(zs);
    expect(xs.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(rng(0)()).toBeGreaterThan(0);
  });
  it("startGrid has 16 black, 16 white, 32 empty with colours on the right ranks", () => {
    const g = startGrid();
    expect(g.filter((x) => x === "b")).toHaveLength(16); expect(g.filter((x) => x === "w")).toHaveLength(16); expect(g.filter((x) => x === "")).toHaveLength(32);
    expect(g[0]).toBe("b"); expect(g[63]).toBe("w"); expect(g[8]).toBe("b"); expect(g[48]).toBe("w");
  });
});

describe("BoardSampler", () => {
  const cfg = () => ({ ...defaultSamplerConfig(), corners: rigCorners(RIGS.A) });

  it("default config exposes sane tunables", () => {
    const d = defaultSamplerConfig();
    expect(d.threshold).toBeGreaterThan(0); expect(d.corners).toHaveLength(4); expect(d.grid).toBe(6);
  });
  it("is uncalibrated until it has seen the start position, and then reads every piece's colour", () => {
    const t = new VirtualTable(), s = new BoardSampler("A", cfg());
    expect(s.calibrated).toBe(false);
    const blind = s.read(shoot(t));
    expect(Array.from(blind.occ).every((v) => v === 0.5)).toBe(true);
    s.calibrateFromStart(shoot(t, "A", 0, 4, 2));
    expect(s.calibrated).toBe(true);
    const o = s.read(shoot(t, "A", 100, 6, 3));
    t.game.board().flat().forEach((p, i) => {
      expect(o.occ[i] > 0.5).toBe(!!p);
      if (p) expect(o.white[i] > 0.5).toBe(p.color === "w");
    });
    expect(o.quality).toBe(1); expect(o.motion).toBe(0); expect(o.cam).toBe("A");
  });
  it("learns an empty-board reference too", () => {
    const empty = new VirtualTable(); empty.game.clear();
    const s = new BoardSampler("A", cfg());
    s.calibrateEmpty(shoot(empty));
    const full = new VirtualTable();
    const o = s.read(shoot(full, "A", 100, 6, 4));
    expect(o.occ[0]).toBeGreaterThan(0.9); expect(o.occ[27]).toBeLessThan(0.1);
  });
  it("does not invent a piece from a soft shadow on an empty square", () => {
    const t = new VirtualTable(), s = new BoardSampler("A", cfg());
    s.calibrateFromStart(shoot(t, "A", 0, 4, 2));
    const f = shoot(t, "A", 1, 4, 2), H = boardToImage(s.cfg.corners), sq = 3 * 8 + 3; // d5, empty at the start
    const c = applyH(H, 3.5, 3.5), rad = Math.hypot(applyH(H, 4, 3.5).x - c.x, applyH(H, 4, 3.5).y - c.y) * 1.1;
    const data = new Uint8ClampedArray(f.data);
    for (let y = 0; y < f.height; y++) for (let x = 0; x < f.width; x++) { const d = Math.hypot(x - c.x, y - c.y); if (d < rad) data[y * f.width + x] *= 1 - 0.4 * (1 - d / rad); }
    const o = s.read({ ...f, data });
    expect(o.occ[sq]).toBeLessThan(0.5);
  });
  it("does not keep a square occupied after the piece leaves just because a lamp makes the wood bright and flat", () => {
    const t = new VirtualTable(), s = new BoardSampler("A", cfg());
    s.calibrateFromStart(shoot(t, "A", 0, 4, 2));
    t.game.move("e4");
    const f = shoot(t, "A", 1, 4, 2);
    const H = boardToImage(s.cfg.corners), e2 = sqIndex("e2"), e4 = sqIndex("e4");
    const c = applyH(H, 4.5, 6.5), rad = Math.hypot(applyH(H, 5.2, 6.5).x - c.x, applyH(H, 5.2, 6.5).y - c.y);
    const data = new Uint8ClampedArray(f.data);
    for (let y = 0; y < f.height; y++) for (let x = 0; x < f.width; x++) {
      if (Math.hypot(x - c.x, y - c.y) < rad) data[y * f.width + x] = Math.min(255, data[y * f.width + x] + 70);
    }
    const o = s.read({ ...f, data });
    expect(o.occ[e2]).toBeLessThan(0.5);
    expect(o.occ[e4]).toBeGreaterThan(0.5);
  });
  it("reads a king that has stepped off its home square, and still sees the pawns beside it", () => {
    const start = new VirtualTable(), moved = new VirtualTable();
    moved.game.load("rnbqkbnr/pppppppp/8/8/4P3/8/PPPPKPPP/RNBQ1BNR w KQkq - 0 2");
    const s = new BoardSampler("C", { ...defaultSamplerConfig(), corners: rigCorners(RIGS.C), threshold: 0.1 });
    s.calibrateFromStart(shoot(start, "C", 0, 0, 2));
    const o = s.read(shoot(moved, "C", 1, 0, 3));
    expect(o.occ[sqIndex("e1")]).toBeLessThan(0.5);
    expect(o.occ[sqIndex("e2")]).toBeGreaterThan(0.5);
    expect(o.white[sqIndex("e2")]).toBeGreaterThan(0.5);
    for (const name of ["b2", "d2", "f2", "g2", "e4"]) expect(o.occ[sqIndex(name)]).toBeGreaterThan(0.5);
  });
  it("flags squares that changed sharply since the last frame as a hand / occlusion", () => {
    const t = new VirtualTable(), s = new BoardSampler("A", cfg());
    s.calibrateFromStart(shoot(t));
    s.read(shoot(t, "A", 1, 4, 2));
    t.play("e4", 0); t.tick(0); t.tick(500); t.tick(900); // hand carries the pawn over the board
    const o = s.read(shoot(t, "A", 2, 4, 3));
    expect(o.motion).toBeGreaterThan(0);
    expect(Array.from(o.handSquares).some((v) => v === 1)).toBe(true);
  });
  it("marks saturated / black frames as low quality", () => {
    const s = new BoardSampler("A", cfg());
    s.calibrateFromStart(flatFrame(120));
    expect(s.read(flatFrame(255)).quality).toBe(0);
    expect(s.read(flatFrame(0)).quality).toBe(0);
  });
  it("keeps readable pieces through fusion and stabilization when half the board is washed out", () => {
    const corners = defaultSamplerConfig().corners;
    const s = new BoardSampler("A", { ...defaultSamplerConfig(), corners });
    const bg = (sq: number) => sq % 8 < 4 ? 255 : 50;
    s.calibrateEmpty(boardPaint(corners, (sq) => bg(sq)));
    const piece = sqIndex("g2");
    const frame = boardPaint(corners, (sq, u, v) => sq === piece && Math.hypot(u - 6.5, v - 6.5) < 0.35 ? 190 : bg(sq));
    const o = s.read(frame);
    expect(o.quality).toBeGreaterThan(0);
    expect(o.occ[piece]).toBeGreaterThan(0.7);
    const fusion = new Fusion(), stab = new Stabilizer();
    let result: BoardBelief;
    for (let t = 0; t < 30; t++) result = stab.step(fusion.fuse([{ ...o, t }], t));
    expect(result!.occ[piece]).toBe(1);
  });
  it("treats board points that fall outside the image as unknown", () => {
    const s = new BoardSampler("A", { ...cfg(), corners: [{ x: -900, y: -900 }, { x: -800, y: -900 }, { x: -800, y: -800 }, { x: -900, y: -800 }] });
    expect(Number.isNaN(s.measure(flatFrame(100))[0])).toBe(true);
    s.calibrateFromStart(flatFrame(100));
    s.ref.fill(100); // calibrated flag needs a real ref; NaN measurements must still read as 0.5 / bad
    const o = s.read(flatFrame(100));
    expect(o.occ[10]).toBe(0.5); expect(o.quality).toBe(0);
  });
  it("slowly adapts the empty reference to lighting drift, but not on occupied squares", () => {
    const s = new BoardSampler("A", cfg());
    s.calibrateFromStart(flatFrame(100));
    const before = s.ref[27];
    for (let i = 0; i < 20; i++) s.read(flatFrame(104, 480, 360, i));
    expect(s.ref[27]).toBeGreaterThan(before);
    const beforeOcc = s.ref[27];
    const piece = flatFrame(180, 480, 360, 100);
    for (let i = 0; i < piece.data.length; i += 2) piece.data[i] = 30; // a real piece has shading; a flat lamp must not count
    for (let i = 0; i < 5; i++) s.read({ ...piece, t: 100 + i });
    expect(s.ref[27]).toBeCloseTo(beforeOcc, 3);
  });
  it("re-derives its sampling grid when the corners are edited", () => {
    const s = new BoardSampler("A", cfg()), t = new VirtualTable();
    const a = s.measure(shoot(t));
    s.cfg.corners = rigCorners(RIGS.B);
    const b = s.measure(shoot(t, "B"));
    expect(a[0]).not.toBeNaN(); expect(b[63]).not.toBeNaN();
  });
  it("leans the centre sample toward the far side of an oblique board", () => {
    const s = new BoardSampler("A", { ...defaultSamplerConfig(), corners: [{ x: 100, y: 40 }, { x: 200, y: 40 }, { x: 230, y: 300 }, { x: 70, y: 300 }] });
    expect(s.lean().v).toBeLessThan(0); // rank 1 edge is longer, so the piece body leans toward rank 8
    expect(Math.abs(s.lean().u)).toBeLessThan(0.02);
  });
  it("reads a piece that barely differs from its own square, and does not call a glare spot a piece", () => {
    const corners = [{ x: 40, y: 20 }, { x: 440, y: 20 }, { x: 440, y: 340 }, { x: 40, y: 340 }];
    const light = (sq: number) => ((sq % 8) + Math.floor(sq / 8)) % 2 === 0;
    const empty = (sq: number) => (light(sq) ? 190 : 48);
    const whiteSq = sqIndex("e4"), blackSq = sqIndex("e5"), glareSq = sqIndex("c4"), calm = sqIndex("f5");
    const paint = (over: (sq: number, u: number, v: number, bg: number) => number) => boardPaint(corners, (sq, u, v) => over(sq, u, v, empty(sq)));
    const disk = (sq: number, u: number, v: number, bg: number, delta: number, radius: number, cap = 249) => {
      const cx = (sq % 8) + 0.5, cy = Math.floor(sq / 8) + 0.5;
      return Math.hypot(u - cx, v - cy) < radius ? Math.max(0, Math.min(cap, bg + delta)) : bg;
    };
    const s = new BoardSampler("A", { ...defaultSamplerConfig(), corners });
    s.calibrateEmpty(paint((_sq, _u, _v, bg) => bg));
    const frame = paint((sq, u, v, bg) => {
      if (sq === whiteSq) return disk(sq, u, v, bg, 28, 0.3); // white on a light square: +28 is under the old 22% bar (42)
      if (sq === blackSq) return disk(sq, u, v, bg, -16, 0.3); // black on a dark square
      if (sq === glareSq) return disk(sq, u, v, bg, 80, 0.62, 255); // the whole square blown out
      return bg;
    });
    const o = s.read(frame);
    expect(o.occ[whiteSq]).toBeGreaterThan(0.7); expect(o.white[whiteSq]).toBeGreaterThan(0.6);
    expect(o.occ[blackSq]).toBeGreaterThan(0.7); expect(o.white[blackSq]).toBeLessThan(0.4);
    expect(o.occ[glareSq]).toBeLessThan(0.6); // undecided, not a confident white piece
    expect(o.occ[calm]).toBeLessThan(0.15);
  });
  it("reads an empty square that is bright by nature as empty, not as undecided glare", () => {
    const corners = [{ x: 40, y: 20 }, { x: 440, y: 20 }, { x: 440, y: 340 }, { x: 40, y: 340 }];
    const light = (sq: number) => ((sq % 8) + Math.floor(sq / 8)) % 2 === 0;
    const paint = () => boardPaint(corners, (sq) => (light(sq) ? 232 : 60));
    const s = new BoardSampler("A", { ...defaultSamplerConfig(), corners });
    s.calibrateEmpty(paint());
    const o = s.read(paint());
    for (const sq of [sqIndex("d4"), sqIndex("e4"), sqIndex("c4"), sqIndex("f5")]) expect(o.occ[sq]).toBeLessThan(0.15);
  });
  it("does not treat a lamp flicker as a hand, and does not vote a washed-out square empty", () => {
    const corners = [{ x: 40, y: 20 }, { x: 440, y: 20 }, { x: 440, y: 340 }, { x: 40, y: 340 }];
    const light = (sq: number) => ((sq % 8) + Math.floor(sq / 8)) % 2 === 0;
    const empty = (sq: number) => (light(sq) ? 160 : 50);
    const knight = sqIndex("g1");
    const paint = (bright: boolean) => boardPaint(corners, (sq, _u, _v) => {
      const bg = empty(sq);
      return bright && sq === knight ? 230 : bg; // the lamp flattens the knight's square
    });
    const s = new BoardSampler("A", { ...defaultSamplerConfig(), corners });
    s.calibrateEmpty(paint(false));
    s.read(paint(false));
    const o = s.read(paint(true));
    expect(o.occ[knight]).toBeGreaterThan(0.4);
    expect(o.occ[knight]).toBeLessThan(0.6);
    expect(o.motion).toBe(0);
  });
  it("does not invent pieces on the near and far ranks just because the lamp falls off", () => {
    const corners = [{ x: 40, y: 20 }, { x: 440, y: 20 }, { x: 440, y: 340 }, { x: 40, y: 340 }];
    const tone = (sq: number, row: number) => (((sq % 8) + row) % 2 === 0 ? 80 + row * 16 : 30 + row * 8);
    const frame = boardPaint(corners, (sq, _u, v) => tone(sq, Math.floor(v)));
    const s = new BoardSampler("A", { ...defaultSamplerConfig(), corners });
    s.calibrateFromStart(frame);
    const o = s.read(frame);
    const seen = Array.from(o.occ).filter((v) => v > 0.5);
    expect(seen).toHaveLength(0);
    expect(o.occ[sqIndex("a1")]).toBeLessThan(0.2);
    expect(o.occ[sqIndex("h8")]).toBeLessThan(0.2);
  });
});

/** Grey frame whose board squares are painted in board coordinates (u right, v down from rank 8). */
function boardPaint(corners: { x: number; y: number }[], colour: (sq: number, u: number, v: number) => number): GrayFrame {
  const w = 480, h = 360, data = new Uint8ClampedArray(w * h);
  const H = invertH(boardToImage(corners));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = applyH(H, x + 0.5, y + 0.5);
    const on = p.x >= 0 && p.y >= 0 && p.x < 8 && p.y < 8;
    const sq = on ? Math.floor(p.y) * 8 + Math.floor(p.x) : 0;
    data[y * w + x] = on ? colour(sq, p.x, p.y) : 28;
  }
  return { width: w, height: h, data, t: 1 };
}

const obs = (cam: string, occ: number, white: number, extra: Partial<SquareObs> = {}): SquareObs => ({ cam, t: 1000, quality: 1, weight: 1, occ: new Float32Array(64).fill(occ), white: new Float32Array(64).fill(white), motion: 0, handSquares: new Uint8Array(64), ...extra });

describe("Fusion", () => {
  it("keeps unusable and undecided camera readings unknown rather than confidently empty", () => {
    for (const extra of [{ quality: 0 }, { weight: 0 }]) {
      const b = new Fusion().fuse([obs("A", 0.99, 0.99, extra)], 1000);
      expect(b.occ[0]).toBe(0.5); expect(b.conf[0]).toBe(0);
      expect(b.fidelity).toBe(0); expect(b.cams).toBe(0);
    }
    const b = new Fusion().fuse([obs("A", 0.5, 0.5)], 1000);
    expect(b.occ[0]).toBe(0.5); expect(b.conf[0]).toBe(0);
  });
  it("reports zero fidelity and an undecided board with no cameras", () => {
    const b = new Fusion().fuse([], 1000);
    expect(b.fidelity).toBe(0); expect(b.cams).toBe(0); expect(b.occ[0]).toBe(0.5); expect(b.handOver).toBe(false);
  });
  it("two agreeing cameras are more confident than one", () => {
    const one = new Fusion().fuse([obs("A", 0.8, 0.8)], 1000), two = new Fusion().fuse([obs("A", 0.8, 0.8), obs("B", 0.8, 0.8)], 1000);
    expect(two.occ[0]).toBeGreaterThan(one.occ[0]); expect(two.fidelity).toBeGreaterThan(one.fidelity);
  });
  it("a confident camera outvotes a doubtful one that disagrees", () => {
    const b = new Fusion().fuse([obs("A", 0.98, 0.9), obs("B", 0.4, 0.5)], 1000);
    expect(b.occ[0]).toBeGreaterThan(0.9);
  });
  it("drops cameras whose frames are stale (went offline)", () => {
    const b = new Fusion().fuse([obs("A", 0.9, 0.9, { t: 100 }), obs("B", 0.9, 0.9, { t: 1000 })], 1000, 500);
    expect(b.cams).toBe(1);
  });
  it("silences an occluded camera but still flags the hand", () => {
    const b = new Fusion().fuse([obs("A", 0.05, 0.5, { motion: 0.5 }), obs("B", 0.95, 0.9)], 1000);
    expect(b.handOver).toBe(true); expect(b.occ[0]).toBeGreaterThan(0.8);
  });
  it("does not freeze the board for a lamp that only flickers a couple of squares", () => {
    const b = new Fusion().fuse([obs("A", 0.9, 0.9, { motion: 0.04 })], 1000, 500, 0.02);
    expect(b.handOver).toBe(false);
  });
  it("preserves moderate multi-camera evidence without converting it into absence", () => {
    // Moderate positive evidence must remain positive, regardless of camera count.
    const b = new Fusion().fuse([obs("A", 0.62, 0.8), obs("B", 0.62, 0.8)], 1000);
    expect(b.occ[0]).toBeGreaterThan(0.5);
    expect(b.occ[0]).toBeLessThan(0.8);
    expect(new Fusion().fuse([obs("A", 0.8, 0.8), obs("B", 0.62, 0.8)], 1000).occ[0]).toBeGreaterThan(0.7);
  });
  it("colour evidence only counts where a piece is believed present", () => {
    expect(new Fusion().fuse([obs("A", 0, 0.99)], 1000).white[0]).toBe(0.5); // no piece anywhere: colour unknown
    expect(new Fusion().fuse([obs("A", 0.02, 0.99)], 1000).white[0]).toBeCloseTo(0.5, 1); // barely any weight
  });
  it("confidence combines occupancy and colour decisiveness", () => {
    const f = new Fusion();
    const sure = f.fuse([obs("A", 0.99, 0.99)], 1000), unsureColour = f.fuse([obs("A", 0.99, 0.55)], 1000), empty = f.fuse([obs("A", 0.01, 0.5)], 1000);
    expect(sure.conf[0]).toBeGreaterThan(unsureColour.conf[0]); expect(empty.conf[0]).toBeGreaterThan(0.9);
  });
  it("learns each camera's reliability from agreement with the consensus, and ignores occluded frames when learning", () => {
    const f = new Fusion();
    const good = obs("A", 0.95, 0.9), good2 = obs("B", 0.95, 0.9), liar = obs("C", 0.05, 0.1);
    for (let i = 0; i < 200; i++) f.fuse([good, good2, liar], 1000);
    expect(f.reliability.get("A")!).toBeGreaterThan(0.9); expect(f.reliability.get("C")!).toBeLessThan(0.5);
    const before = f.reliability.get("C")!;
    f.fuse([good, good2, obs("C", 0.05, 0.1, { motion: 0.9 })], 1000);
    expect(f.reliability.get("C")).toBe(before);
    expect(f.lastSeen.get("A")).toBe(1000);
  });
});

const belief = (over: Partial<BoardBelief> = {}, occ = 1, white = 1): BoardBelief => ({ t: 0, occ: new Float32Array(64).fill(occ), white: new Float32Array(64).fill(white), conf: new Float32Array(64).fill(1), fidelity: 0.9, handOver: false, settled: false, cams: 2, ...over });

describe("Stabilizer", () => {
  it("resolves sustained weak evidence but rejects flicker and unknown squares", () => {
    const s = new Stabilizer();
    let last: BoardBelief;
    for (let t = 0; t <= 2000; t += 100) {
      const b = belief({ t }, 0.5, 0.5);
      b.occ[0] = 0.6;
      b.occ[1] = t % 200 ? 0.6 : 0.4;
      last = s.step(b);
    }
    expect(last!.occ[0]).toBe(1);
    expect(last!.occ[1]).toBe(0);
    expect(last!.occ[2]).toBe(0);
    for (let t = 2100; t <= 4000; t += 100) last = s.step(belief({ t }, 0.4, 0.4));
    expect(last!.occ[0]).toBe(0);
    expect(last!.white[0]).toBe(0);
  });

  it("does not count time under a hand or offline as sustained evidence", () => {
    const s = new Stabilizer();
    s.step(belief({ t: 0 }, 0.6));
    s.step(belief({ t: 1000, handOver: true }, 0.6));
    expect(s.step(belief({ t: 1100 }, 0.6)).occ[0]).toBe(0);
    s.step(belief({ t: 2000, cams: 0 }, 0.6));
    expect(s.step(belief({ t: 2100 }, 0.6)).occ[0]).toBe(0);
  });

  it("needs sustained evidence to turn a square on (hysteresis) and settles after a quiet period", () => {
    const s = new Stabilizer();
    let last = s.step(belief({ t: 0 }, 0.5, 0.5));
    expect(last.occ[0]).toBe(0);
    for (let t = 100; t <= 600; t += 100) last = s.step(belief({ t }, 0.99, 0.99));
    expect(last.occ[0]).toBe(1); expect(last.white[0]).toBe(1);
    expect(last.settled).toBe(false);
    for (let t = 700; t <= 2000; t += 100) last = s.step(belief({ t }, 0.99, 0.99));
    expect(last.settled).toBe(true); expect(last.fidelity).toBeLessThanOrEqual(0.9);
  });
  it("turns a square off again and flips colour, with hysteresis in both directions", () => {
    const s = new Stabilizer();
    for (let t = 0; t <= 800; t += 100) s.step(belief({ t }, 0.99, 0.99));
    let last = s.step(belief({ t: 900 }, 0.6, 0.6));
    expect(last.occ[0]).toBe(1); // a mild contrary reading does not flip it
    for (let t = 1000; t <= 1800; t += 100) last = s.step(belief({ t }, 0.01, 0.01));
    expect(last.occ[0]).toBe(0);
    const s2 = new Stabilizer();
    for (let t = 0; t <= 800; t += 100) s2.step(belief({ t }, 0.99, 0.99));
    for (let t = 900; t <= 1800; t += 100) last = s2.step(belief({ t }, 0.99, 0.01));
    expect(last.white[0]).toBe(0); expect(last.occ[0]).toBe(1);
    for (let t = 1900; t <= 2800; t += 100) last = s2.step(belief({ t }, 0.99, 0.99));
    expect(last.white[0]).toBe(1); // and back
  });
  it("freezes while a hand is over the board and restarts the quiet timer", () => {
    const s = new Stabilizer();
    for (let t = 0; t <= 2000; t += 100) s.step(belief({ t }, 0.99, 0.99));
    const hand = s.step(belief({ t: 2100, handOver: true }, 0.01, 0.01));
    expect(hand.occ[0]).toBe(1); expect(hand.settled).toBe(false);
    const after = s.step(belief({ t: 2200 }, 0.99, 0.99));
    expect(after.settled).toBe(false);
  });
  it("can be configured to keep integrating through hands", () => {
    const s = new Stabilizer({ decay: 0.5, on: 1, off: -1, settleMs: 0, holdOnHand: false });
    let last: BoardBelief | null = null;
    for (let t = 0; t <= 500; t += 100) last = s.step(belief({ t, handOver: true }, 0.99, 0.99));
    expect(last!.occ[0]).toBe(1);
  });
  it("does nothing without cameras", () => {
    const s = new Stabilizer();
    const out = s.step(belief({ t: 5000, cams: 0 }, 0.99, 0.99));
    expect(out.occ[0]).toBe(0); expect(out.settled).toBe(false);
  });
});

describe("triangulation", () => {
  const A = cameraMatrix([-3, 2, -3], [0, 1, 0], 60, 640, 480), B = cameraMatrix([3, 2, -3], [0, 1, 0], 60, 640, 480);
  it("recovers a 3D point from two views and exposes the skeleton topology", () => {
    const X: [number, number, number] = [0.4, 1.2, 0.3];
    const t = triangulate([A, B], [project(A, X), project(B, X)])!;
    expect(Math.hypot(t[0] - X[0], t[1] - X[1], t[2] - X[2])).toBeLessThan(1e-6);
    expect(JOINT_NAMES).toHaveLength(17);
    expect(BONES.every(([a, b]) => a < 17 && b < 17)).toBe(true);
  });
  it("solves with views from very different directions (pivoting)", () => {
    const cams = [cameraMatrix([0, 6, 0.1], [0, 0, 0], 50, 640, 480), cameraMatrix([5, 1, 0], [0, 1, 0], 50, 640, 480), cameraMatrix([0, 1, -5], [0, 1, 0], 50, 640, 480)];
    const X: [number, number, number] = [-0.5, 0.7, 0.9];
    const t = triangulate(cams, cams.map((c) => project(c, X)))!;
    expect(Math.hypot(t[0] - X[0], t[1] - X[1], t[2] - X[2])).toBeLessThan(1e-6);
  });
  it("refuses with fewer than two views, or when the views are degenerate", () => {
    expect(triangulate([A], [{ x: 1, y: 1 }])).toBeNull();
    expect(triangulate([A, A], [project(A, [0, 1, 0]), project(A, [0, 1, 0])])).toBeNull();
  });
  it("places a single camera's floor point by ray/plane intersection, and gives up on a degenerate camera", () => {
    const foot: [number, number, number] = [0.5, 0, 0.8];
    const g = rayToPlane([-3, 2, -3], A, project(A, foot), 0)!;
    expect(Math.hypot(g[0] - foot[0], g[2] - foot[2])).toBeLessThan(1e-6);
    expect(rayToPlane([0, 0, 0], new Array(12).fill(0), { x: 1, y: 1 })).toBeNull();
  });
});

it("retains moderate single-camera evidence until a piece stabilizes", () => {
  const fusion = new Fusion(), stabilizer = new Stabilizer();
  const observation: SquareObs = {
    cam: "A", t: 0, quality: 1, weight: 1, motion: 0,
    occ: new Float32Array(64).fill(0.01), white: new Float32Array(64).fill(0.95),
    handSquares: new Uint8Array(64),
  };
  observation.occ[42] = 0.69; // faint knight on c3
  let result: BoardBelief | undefined;
  for (let i = 0; i < 40; i++) {
    observation.t = i * 100;
    const fused = fusion.fuse([observation], observation.t);
    expect(fused.occ[42]).toBeGreaterThan(0.5);
    result = stabilizer.step(fused);
  }
  expect(result!.occ[42]).toBe(1);
  expect(result!.settled).toBe(true);
});
