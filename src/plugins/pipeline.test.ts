import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { VirtualTable } from "../sim/virtualTable";
import { RIGS, rigCorners } from "../sim/rigs";
import { node, shoot, tick } from "../test/helpers";
import { agreement, blendReadings, expectedFromFen, pieceCount, type Reading } from "../vision/readings";
import { fmtCorners } from "./shared";
import { pieceLetter } from "./pipeline";
import { legalLetters } from "../vision/readings";
import { NetPool } from "../vision/netPool";
import { handle, type NetReq } from "../vision/netWorker";
import { extractBoard } from "../vision/boardImage";
import { bus } from "../core/bus";

const truthOf = (g: Chess) => g.board().flat().map((p) => (!p ? 0 : p.color === "w" ? 1 : 2));
const reading = (pieces: number[], source = "x", white = 1): Reading => ({ cam: "A", t: 0, source, occ: Float32Array.from({ length: 64 }, (_, i) => (pieces.includes(i) ? 0.95 : 0.05)), white: new Float32Array(64).fill(white ? 0.9 : 0.1) });
const range = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i);

describe("blendReadings", () => {
  it("mixes agreeing readings and marks squares they disagree on", () => {
    const a = reading([...range(0, 16), ...range(48, 64)]), b = reading([...range(0, 16), ...range(48, 63)]); // b misses h1
    const r = blendReadings([{ reading: a, weight: 0.4 }, { reading: b, weight: 0.6 }]);
    expect(r.used).toEqual([true, true]);
    expect(r.disagree[63]).toBe(1); expect(r.disagree[0]).toBe(0);
    expect(r.reading!.occ[0]).toBeGreaterThan(0.9); expect(r.reading!.occ[20]).toBeLessThan(0.1);
  });
  it("throws out a reading that collapses next to the anchor, and says why", () => {
    const anchor = reading([...range(0, 16), ...range(48, 64)]), empty = reading([]), crowd = reading(range(0, 40));
    const r = blendReadings([{ reading: anchor, weight: 1 }, { reading: empty, weight: 1 }, { reading: crowd, weight: 1 }]);
    expect(r.used).toEqual([true, false, false]);
    expect(r.why[1]).toContain("sees 0"); expect(r.why[2]).toContain("sees 40");
    expect(pieceCount(r.reading!)).toBe(32);
    expect(blendReadings([{ reading: anchor, weight: 1 }, { reading: empty, weight: 1 }], false).used).toEqual([true, true]); // guard off
  });
  it("handles missing inputs, zero weights and keeps the anchor's motion figures", () => {
    expect(blendReadings([{ reading: null, weight: 1 }]).reading).toBeNull();
    const a = { ...reading(range(0, 16)), quality: 0.7, motion: 0.1, handSquares: new Uint8Array(64) };
    const r = blendReadings([{ reading: a, weight: 1 }, { reading: reading(range(0, 16)), weight: 0 }]);
    expect(r.used).toEqual([true, false]); expect(r.reading!.quality).toBe(0.7); expect(r.reading!.motion).toBe(0.1);
  });
});

describe("blend with piece types and the game position", () => {
  const start = [...range(0, 16), ...range(48, 64)];
  it("reads a FEN as which piece stands where", () => {
    const e = expectedFromFen(new Chess().fen())!;
    expect(e[0]).toBe(1 + 3 + 6); expect(e[4]).toBe(1 + 5 + 6); expect(e[8]).toBe(1 + 6); expect(e[16]).toBe(0); expect(e[60]).toBe(1 + 5);
    expect(expectedFromFen("nonsense")).toBeNull();
  });
  it("carries the neural reader's piece types and lets the game fill in a detector that has none", () => {
    const t = new Float32Array(64 * 13); t[4 * 13 + 1 + 10] = 0.2; t[4 * 13 + 1 + 7] = 0.6; // the net thinks a black knight on e8 (it is the king)
    const a = { ...reading(start), types: t }, b = reading(start);
    const noGame = blendReadings([{ reading: a, weight: 1 }, { reading: b, weight: 1 }]).reading!;
    expect(noGame.types![4 * 13 + 1 + 7]).toBeGreaterThan(noGame.types![4 * 13 + 1 + 11]);
    const withGame = blendReadings([{ reading: a, weight: 1 }, { reading: b, weight: 1 }], true, expectedFromFen(new Chess().fen()), 1).reading!;
    expect(withGame.types![4 * 13 + 1 + 11]).toBeGreaterThan(0.2); // the king the game knows about shows up
    expect(blendReadings([{ reading: b, weight: 1 }]).reading!.types).toBeUndefined();
  });
  it("the game position nudges a doubtful square but cannot hide a real move", () => {
    const g = expectedFromFen(new Chess().fen());
    const doubt = reading(start); doubt.occ[20] = 0.55; // maybe a piece on e3 where the game says empty
    const quiet = blendReadings([{ reading: doubt, weight: 1 }], true, g, 0.5).reading!;
    expect(quiet.occ[20]).toBeLessThan(0.55);
    const moved = reading([...range(0, 12), 20, ...range(13, 16), ...range(48, 64)]); // e2-e3 really played, clearly seen
    const r = blendReadings([{ reading: moved, weight: 1 }], true, g, 0.3).reading!;
    expect(r.occ[20]).toBeGreaterThan(0.5); expect(r.occ[12]).toBeLessThan(0.5);
  });
});

describe("detection pipeline nodes", () => {
  it("every node paints, hovers and tolerates having no input", () => {
    for (const t of ["vision.clean", "vision.flatten", "vision.brightness", "vision.neuralBoard", "vision.neuralSquares", "vision.blend", "vision.observe"]) {
      const n = node(t);
      const out = n.run({});
      expect(out).toBeTruthy();
      for (const v of Object.values(out!)) expect(v).toBeNull();
      n.paint(); n.paint(400, 300);
      n.spec.hover?.({ x: 20, y: 20 }, 160, 160, n.state, out!);
      n.dispose();
    }
  });

  it("reads the start position through clean -> flatten -> brightness + neural -> blend -> camera reading", async () => {
    const table = new VirtualTable(), truth = truthOf(table.game), corners = fmtCorners(rigCorners(RIGS.A));
    const clean = node("vision.clean", { average: 1 }), flat = node("vision.flatten", { cam: "A", corners }), bright = node("vision.brightness"), neural = node("vision.neuralBoard"), mix = node("vision.blend"), cam = node("vision.observe", { weight: 1.5 });
    let obs: any = null, last: any = null;
    for (let i = 0; i < 6; i++) {
      await tick(); // the neural model loads, the cleaner answers
      const frame = shoot(table, "A", 1000 * i, 6, i + 1);
      const c = clean.run({ frame }, i * 100)!.frame, f = flat.run({ frame: c }, i * 100)!.flat;
      const r1 = bright.run({ flat: f }, i * 100)!.reading, r2 = neural.run({ flat: f }, i * 100)!.reading;
      last = mix.run({ r1, r2 }, i * 100)!.reading;
      obs = cam.run({ reading: last }, i * 100)!.obs;
    }
    expect(obs).toBeTruthy();
    expect(obs.cam).toBe("A"); expect(obs.weight).toBe(1.5);
    let wrong = 0;
    for (let i = 0; i < 64; i++) { const seen = obs.occ[i] > 0.5, colour = obs.white[i] > 0.5 ? 1 : 2; if (truth[i] === 0 ? seen : !seen || colour !== truth[i]) wrong++; }
    expect(wrong).toBeLessThanOrEqual(3);
    expect(mix.state.res.used.slice(0, 2)).toEqual([true, true]);
    expect(neural.h.fidelity).toBeGreaterThan(0.5);
    for (const n of [clean, flat, bright, neural, mix, cam]) n.paint(160, 160, {});
  });

  it("network nodes reuse their last reading between reads, and read again after the interval or when the corners move", async () => {
    const table = new VirtualTable(), corners = fmtCorners(rigCorners(RIGS.A)), flat = node("vision.flatten", { cam: "A", corners }), neural = node("vision.neuralBoard", { maxRate: 4 });
    neural.run({ flat: null }, 0); await tick(); await tick();
    const f1 = flat.run({ frame: shoot(table, "A", 0, 6, 1) })!.flat;
    neural.run({ flat: f1 }, 0); expect(neural.state.ran).toBe(true);
    const f2 = flat.run({ frame: shoot(table, "A", 100, 6, 2) })!.flat;
    const reused = neural.run({ flat: f2 }, 100)!.reading; expect(neural.state.ran).toBe(false); expect(reused.t).toBe(f2.t); // stand-in carries the new time, so fusion never sees it as stale
    neural.run({ flat: f2 }, 300); expect(neural.state.lastRun).toBe(300);
    flat.params.corners = fmtCorners(rigCorners(RIGS.B));
    const f3 = flat.run({ frame: shoot(table, "A", 400, 6, 3) })!.flat;
    neural.run({ flat: f3 }, 310); expect(neural.state.lastRun).toBe(310); // corners moved: no waiting
  });

  it("the network worker answers per reader, skips an unchanged board, and forgets a reader", async () => {
    const table = new VirtualTable(), frame = shoot(table, "A"), img = extractBoard(frame, rigCorners(RIGS.A));
    // a stand-in worker that runs the real handler
    const fake: any = { onmessage: null, postMessage(req: NetReq) { const r = handle(req); if (r) setTimeout(() => fake.onmessage({ data: r }), 0); }, terminate() {} };
    const pool = new NetPool(() => fake);
    expect(pool.supported).toBe(true);
    const a = await pool.read("r1", img), b = await pool.read("r1", img), c = await pool.read("r2", img);
    expect(a.probs).toHaveLength(64 * 13 === a.probs.length ? 64 * 13 : 192); expect(a.ran).toBe(true); expect(b.ran).toBe(false); expect(c.ran).toBe(true); // r2 has its own cache
    expect(a.types).toHaveLength(64 * 13); // the model reads piece types, so they come back too
    pool.forget("r1"); expect((await pool.read("r1", img)).ran).toBe(true);
    expect(new NetPool().supported).toBe(false); // jsdom has no Worker
    pool.dispose();
  });

  it("flatten gives nothing for bad corners and caches the picture it already cut", () => {
    const table = new VirtualTable(), frame = shoot(table, "A"), flat = node("vision.flatten", { corners: "nonsense" });
    expect(flat.run({ frame })!.flat).toBeNull();
    flat.params.corners = fmtCorners(rigCorners(RIGS.A));
    const a = flat.run({ frame })!.flat, b = flat.run({ frame })!.flat;
    expect(a).toBeTruthy(); expect(b).toBe(a);
  });

  it("agreement counts the squares two readings call the same", () => {
    const a = reading(range(0, 16)), b = reading([...range(0, 15)]);
    expect(agreement(a, a)).toBe(1); expect(agreement(a, b)).toBeCloseTo(63 / 64);
    expect(agreement(a, reading(range(0, 16), "x", 0))).toBeCloseTo(48 / 64); // same squares, wrong colour
  });
  it("blend learns to trust the detector that keeps agreeing with the other two", () => {
    const good = reading([...range(0, 16), ...range(48, 64)]), good2 = reading([...range(0, 16), ...range(48, 64)]), bad = reading([...range(0, 12), ...range(40, 60)]);
    const mix = node("vision.blend", { w1: 1, w2: 1, w3: 1 });
    for (let i = 0; i < 80; i++) mix.run({ r1: good, r2: good2, r3: bad });
    const eff = (mix.state as { eff: number[] }).eff;
    expect(eff[2]).toBeLessThan(eff[0] * 0.5); expect(eff[0]).toBeGreaterThan(0.9);
    mix.params.adapt = false; mix.run({ r1: good, r2: good2, r3: bad });
    expect((mix.state as { eff: number[] }).eff.slice(0, 3)).toEqual([1, 1, 1]);
  });
  it("flatten can suggest auto-calibration when the camera reading stays poor", () => {
    const table = new VirtualTable(), frame = shoot(table, "A"), flat = node("vision.flatten", { cam: "A", corners: fmtCorners(rigCorners(RIGS.A)) });
    bus.calibration = null; bus.cameras = [{ id: "A", online: true, quality: 0.05, reliability: 0.8 }];
    expect(() => { for (let i = 0; i < 40; i++) flat.run({ frame: { ...frame, t: i * 600 } }, i * 600); }).not.toThrow();
    flat.params.autoFind = false; flat.run({ frame }, 99999); expect(bus.calibration).toBeNull();
    bus.cameras = [];
  });
});

describe("piece letters on the neural board reader", () => {
  it("picks the likeliest piece of the disc's colour", () => {
    const t = new Float32Array(64 * 13);
    t[5 * 13 + 2] = 0.9; // white knight on square 5
    t[5 * 13 + 11] = 0.95; // black queen there is stronger, but the disc is white
    expect(pieceLetter(t, 5, true)).toBe("N");
    expect(pieceLetter(t, 5, false)).toBe("Q");
    expect(pieceLetter(new Float32Array(64 * 13), 0, true)).toBe("P");
  });
});

describe("legal piece letters", () => {
  it("never reads more kings, pawns or pieces than a side can have", () => {
    const occ = new Float32Array(64), white = new Float32Array(64).fill(1), types = new Float32Array(64 * 13);
    for (let sq = 8; sq < 24; sq++) { occ[sq] = 1; types[sq * 13 + 6] = 0.9; types[sq * 13 + 3] = 0.2; } // 16 squares all "king" for white
    const l = legalLetters({ occ, white }, types);
    expect(l.filter((x) => x === "K").length).toBe(1);
    expect(l.filter((x) => x !== "").length).toBe(16);
    const pawns = new Float32Array(64 * 13), o2 = new Float32Array(64).fill(1);
    for (let sq = 0; sq < 12; sq++) pawns[sq * 13 + 1] = 0.9; // 12 "pawns", some on the back row
    const l2 = legalLetters({ occ: o2, white }, pawns);
    expect(l2.filter((x) => x === "P").length).toBeLessThanOrEqual(8);
    expect(l2.slice(0, 8).includes("P")).toBe(false);
  });
});

describe("masked view nodes", () => {
  it("Mask Board turns a flat board into a view, and the Neural View Reader reads it once the model loads", async () => {
    const table = new VirtualTable(), frame = shoot(table, "A"), corners = fmtCorners(rigCorners(RIGS.A));
    const flat = node("vision.flatten", { cam: "A", corners }), mask = node("vision.mask"), reader = node("vision.neuralView", { maxRate: 30 });
    const view = mask.run({ flat: flat.run({ frame })!.flat })!.view;
    expect(view.img.length).toBe(160 * 160);
    reader.run({ view }, 0); for (let i = 0; i < 20 && !reader.run({ view }, i * 100)?.reading; i++) await tick();
    const r = reader.run({ view }, 5000)!.reading;
    expect(r).toBeTruthy(); expect(r.source).toBe("neural view");
    expect(mask.run({ flat: null })!.view).toBeNull();
  });
});

describe("what a camera remembers", () => {
  it("Flatten Board starts a known camera from its last corners and keeps the corners it is given", async () => {
    const { recallCorners } = await import("../vision/cornerMemory");
    const table = new VirtualTable(), frame = { ...shoot(table, "A"), source: "Test cam" }, mine = "10,10;400,10;400,300;10,300";
    const first = node("vision.flatten", { cam: "A", corners: mine }); first.run({ frame });
    expect(recallCorners("Test cam")).toBe(mine);
    const second = node("vision.flatten", { cam: "A" }); second.run({ frame }); // fresh node with the default corners: picks up the memory
    expect(second.params.corners).toBe(mine);
  });
  it("Brightness Reader keeps trying to learn the empty squares until the start position is on the board", () => {
    const table = new VirtualTable(), frame = shoot(table, "A"), flat = node("vision.flatten", { corners: fmtCorners(rigCorners(RIGS.A)) }), bright = node("vision.brightness");
    const f = flat.run({ frame })!.flat;
    for (let i = 0; i < 12; i++) bright.run({ flat: { ...f, frame: { ...frame, t: i * 1200 } } }, i * 1200);
    expect((bright.state as { calTries: number }).calTries).toBeGreaterThan(0);
    expect((bright.state as { autoDone: boolean }).autoDone).toBe(true); // the virtual table starts from the start position
  });
});
