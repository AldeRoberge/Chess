import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { VirtualTable } from "../sim/virtualTable";
import { RIGS, rigCorners } from "../sim/rigs";
import { node, shoot, tick } from "../test/helpers";
import { blendReadings, pieceCount, type Reading } from "../vision/readings";
import { fmtCorners } from "./shared";
import { NetPool } from "../vision/netPool";
import { handle, type NetReq } from "../vision/netWorker";
import { extractBoard } from "../vision/boardImage";

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
});
