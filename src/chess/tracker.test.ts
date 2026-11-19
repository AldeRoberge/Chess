import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { Fusion } from "../vision/fusion";
import { BoardSampler, defaultSamplerConfig } from "../vision/sampler";
import { Stabilizer } from "../vision/stabilizer";
import { render3D } from "../sim/render3d";
import { FRAME_H, FRAME_W, RIGS, rigCorners } from "../sim/rigs";
import { VirtualTable } from "../sim/virtualTable";
import type { BoardBelief } from "../vision/types";
import { PositionTracker } from "./tracker";

const settled = (g: Chess, flip?: number[]): BoardBelief => {
  const occ = new Float32Array(64), white = new Float32Array(64), conf = new Float32Array(64).fill(0.95);
  g.board().flat().forEach((p, i) => { occ[i] = p ? 1 : 0; white[i] = p?.color === "w" ? 1 : 0; });
  for (const i of flip ?? []) { occ[i] = occ[i] ? 0 : 1; conf[i] = 0.3; }
  return { t: 1, occ, white, conf, fidelity: 0.9, handOver: false, settled: true, cams: 2 };
};

describe("PositionTracker", () => {
  it("accepts a legal move after the confirm count and emits events", () => {
    const t = new PositionTracker();
    const g = new Chess(); g.move("e4");
    expect(t.observe(settled(g)).status).toBe("pending");
    const r = t.observe(settled(g));
    expect(r.status).toBe("moved");
    expect(r.last?.san).toBe("e4");
    expect(r.events.map((e) => e.type)).toContain("move");
  });
  it("never explains an extra occupied square as a move: a soft shadow leaves the position standing", () => {
    const t = new PositionTracker(), g = new Chess(); g.move("Nc3");
    const covered = settled(new Chess(), [42]); // start position + a phantom piece on c3, nothing vanished
    covered.white[42] = 1; covered.conf[42] = 0.2;
    for (let i = 0; i < 5; i++) { const r = t.observe(covered); expect(r.status).toBe("synced"); expect(r.history).toEqual([]); }
    expect(t.observe(settled(g)).status).toBe("pending"); expect(t.observe(settled(g)).history).toEqual(["Nc3"]); // once the arm is gone the real move is accepted
  });
  it("waits out a confident extra piece, which is a hand and not a lamp", () => {
    const t = new PositionTracker();
    const hand = settled(new Chess(), [42]);
    hand.white[42] = 1; hand.conf[42] = 0.9;
    for (let i = 0; i < 4; i++) { const r = t.observe(hand); expect(r.status).toBe("pending"); expect(r.history).toEqual([]); }
  });
  it("still accepts a pawn move when one soft extra square is also lit", () => {
    const t = new PositionTracker();
    const g = new Chess(); g.move("e4");
    const lit = settled(g);
    lit.occ[42] = 1; lit.white[42] = 1; lit.conf[42] = 0.25; // c3 glows, but e2-e4 is clear
    t.observe(lit);
    expect(t.observe(lit).history).toEqual(["e4"]);
    expect(t.observe(lit).status).toBe("synced"); // the glow stays, but the move already counted, so the reply can start
  });
  it("accepts a knight hop when the squares it changes are only softly read", () => {
    const after = new Chess(); after.move("Nf3");
    const t = new PositionTracker();
    const soft = settled(after);
    soft.conf[62] = 0.35; soft.conf[45] = 0.35; // g1 and f3: the hop is there, just not crisp
    t.observe(soft);
    expect(t.observe(soft).history).toEqual(["Nf3"]);
  });
  it("keeps a played knight when the picture will not settle again", () => {
    const t = new PositionTracker();
    const g = new Chess(); g.move("Nf3");
    t.observe(settled(g));
    expect(t.observe(settled(g)).history).toEqual(["Nf3"]);
    const wobble = settled(g); wobble.settled = false;
    const held = t.observe(wobble);
    expect(held.status).toBe("synced"); expect(held.history).toEqual(["Nf3"]);
    const glow = settled(g); glow.occ[42] = 1; glow.white[42] = 1; glow.conf[42] = 0.25; glow.settled = false;
    expect(t.observe(glow).status).toBe("synced");
  });
  it("accepts a king step even when the square it lands on is only softly read", () => {
    const before = new Chess("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1");
    const after = new Chess(before.fen()); after.move("Ke2");
    const t = new PositionTracker(); t.reset(before.fen());
    const soft = settled(after);
    soft.conf[60] = 0.35; soft.conf[52] = 0.35; // e1 and e2: the camera sees the step, just not crisply
    t.observe(soft);
    expect(t.observe(soft).history).toEqual(["Ke2"]);
  });
  it("will not commit a king step while the rook's square is still unread: half a castle waits, then O-O is accepted", () => {
    const castled = new Chess("r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R b KQkq - 0 1"), after = new Chess(castled.fen()); after.move("O-O");
    const t = new PositionTracker(); t.reset(castled.fen());
    const half = settled(castled); // e8 gone, f8 and g8 ambiguous (low confidence), h8 rook still read
    half.occ[4] = 0; half.occ[5] = 0; half.occ[6] = 0; half.conf[5] = 0.2; half.conf[6] = 0.2;
    for (let i = 0; i < 5; i++) { const r = t.observe(half); expect(r.history).toEqual([]); expect(r.status).not.toBe("moved"); }
    t.observe(settled(after)); expect(t.observe(settled(after)).history).toEqual(["O-O"]);
  });
  it("accepts a first move the cameras read softly even when a tall piece casts a faint ghost on the next square", () => {
    const g = new Chess(); g.move("Nf3");
    const t = new PositionTracker();
    const seen = settled(g); // g1 empty, f3 knight, both read softly; e3 half-sees the knight leaning over it
    seen.conf[45] = 0.4; seen.conf[62] = 0.4;
    seen.occ[44] = 0.6; seen.white[44] = 0.3; seen.conf[44] = 0.2;
    expect(t.observe(seen).status).toBe("pending");
    const r = t.observe(seen);
    expect(r.status).toBe("moved"); expect(r.history).toEqual(["Nf3"]);
  });
  it("never tells the player to put a piece back over a reading the cameras are unsure of", () => {
    const t = new PositionTracker();
    const blurry = settled(new Chess()); // the white pieces fade out of a poor picture
    for (let i = 48; i < 64; i++) { blurry.occ[i] = 0.4; blurry.conf[i] = 0.2; }
    for (let i = 0; i < 5; i++) { const r = t.observe(blurry); expect(r.status).toBe("synced"); expect(r.events).toEqual([]); }
  });
  it("calls a board misread on many squares unclear, not an illegal move", () => {
    const t = new PositionTracker();
    const misread = settled(new Chess());
    for (let i = 48; i < 64; i++) misread.occ[i] = 0; // every white piece read as gone, confidently
    for (let i = 0; i < 5; i++) { const r = t.observe(misread); expect(r.status).toBe("unclear"); expect(r.events.map((e) => e.type)).not.toContain("illegal"); }
    expect(t.observe(settled(new Chess())).status).toBe("synced");
  });
  it("forgets a wrong reading once the board reads right again", () => {
    const t = new PositionTracker(), bad = settled(new Chess());
    bad.occ[52] = 0; bad.occ[20] = 1; bad.white[20] = 1; bad.conf.fill(0.99);
    t.observe(bad); t.observe(bad); t.observe(settled(new Chess()));
    expect(t.observe(bad).status).toBe("pending");
  });
  it("finds the knight move from the squares that changed, even when its neighbour is misread with confidence", () => {
    const g = new Chess(); g.move("Nf3");
    const t = new PositionTracker();
    const seen = settled(g); // g1 emptied and f3 filled, as the camera saw it; e3 confidently reads a dark blob
    seen.occ[44] = 1; seen.white[44] = 0; seen.conf[44] = 0.8;
    t.observe(seen);
    expect(t.observe(seen).history).toEqual(["Nf3"]);
    for (let i = 0; i < 10; i++) expect(t.observe(seen).status).toBe("synced");
    seen.settled = false;
    expect(t.observe(seen).status).toBe("synced");
    seen.handOver = true;
    expect(t.observe(seen).status).toBe("pending");
    seen.handOver = false; seen.settled = true;
    // The reply still counts with the same blob present.
    g.move("e5");
    const reply = settled(g); reply.occ[44] = 1; reply.white[44] = 0; reply.conf[44] = 0.8;
    t.observe(reply);
    expect(t.observe(reply).history).toEqual(["Nf3", "e5"]);
    expect(t.observe(reply).status).toBe("synced");
    // Once the blob clears, a new object in that square must be checked again.
    expect(t.observe(settled(g)).status).toBe("synced");
    expect(t.observe(reply).status).toBe("pending");
    t.reset();
    expect(t.observe(seen).history).toEqual([]);
  });
  it("reads a capture and a pawn push from the changed squares alone", () => {
    const g = new Chess(); for (const m of ["e4", "d5"]) g.move(m);
    const t = new PositionTracker(); t.reset(g.fen());
    g.move("exd5");
    const seen = settled(g); seen.occ[0] = 0; seen.conf[0] = 0.9; // a8 rook misread as gone: a square the move does not touch, not the mover's
    t.observe(seen);
    expect(t.observe(seen).history.at(-1)).toBe("exd5");
  });
  it("does not guess when another piece of the mover's also vanished", () => {
    const g = new Chess(); g.move("Nf3");
    const t = new PositionTracker();
    const seen = settled(g); seen.occ[44] = 1; seen.conf[44] = 0.8; seen.occ[48] = 0; seen.conf[48] = 0.9; // a2 pawn gone too
    for (let i = 0; i < 4; i++) expect(t.observe(seen).history).toEqual([]);
  });
  it("recovers two plies when frames were dropped", () => {
    const t = new PositionTracker();
    const g = new Chess(); g.move("e4"); g.move("e5");
    t.observe(settled(g));
    const r = t.observe(settled(g));
    expect(r.history).toEqual(["e4", "e5"]);
  });
  it("detects a piece in hand and illegal placement", () => {
    const t = new PositionTracker();
    const g = new Chess(); g.move("e4");
    const lifted = settled(new Chess());
    lifted.occ[52] = 0; // e2 vanished, nothing landed
    lifted.conf.fill(0.99);
    expect(t.observe(lifted).status).toBe("lifted");
    const bad = settled(new Chess());
    bad.occ[52] = 0; bad.occ[20] = 1; bad.white[20] = 1; // e2 -> e6: not a legal pawn move
    bad.conf.fill(0.99);
    expect(t.observe(bad).status).toBe("pending"); expect(t.observe(bad).status).toBe("pending"); // one noisy reading is not a mistake
    expect(t.observe(bad).status).toBe("illegal");
  });
  it("detects captures, castling and checkmate", () => {
    const t = new PositionTracker();
    const g = new Chess();
    for (const m of ["f3", "e5", "g4", "Qh4#"]) {
      g.move(m);
      t.observe(settled(g)); const r = t.observe(settled(g));
      if (m === "Qh4#") expect(r.events.map((e) => e.type)).toContain("mate");
    }
  });
  it("tolerates one low-confidence wrong square", () => {
    const t = new PositionTracker();
    const g = new Chess(); g.move("d4");
    t.observe(settled(g, [0])); // a8 rook "missing" but low confidence
    expect(t.observe(settled(g, [0])).last?.san).toBe("d4");
  });
});

describe("full vision pipeline on 3D camera feeds", () => {
  it("tracks e2-e4 through perspective, occlusion, noise, and a hand over the board", () => {
    const table = new VirtualTable();
    const sA = new BoardSampler("A", { ...defaultSamplerConfig(), corners: rigCorners(RIGS.A) }), sB = new BoardSampler("B", { ...defaultSamplerConfig(), corners: rigCorners(RIGS.B) });
    const fusion = new Fusion(), stab = new Stabilizer(), tracker = new PositionTracker();
    let t = 0, seed = 1, last: any;
    const frame = (rig: string) => render3D(table.scene3d(), { width: FRAME_W, height: FRAME_H, rig: RIGS[rig], noise: 10, gradient: 0.15, seed: ++seed, t });
    sA.calibrateFromStart(frame("A")); sB.calibrateFromStart(frame("B"));
    const run = (ms: number) => { for (let k = 0; k < ms; k += 100) { t += 100; table.tick(t); last = tracker.observe(stab.step(fusion.fuse([sA.read(frame("A")), sB.read(frame("B"))], t))); } };
    run(1500);
    expect(last.status).toBe("synced");
    table.play("e4", t);
    run(6000);
    expect(last.history).toEqual(["e4"]);
    expect(last.fidelity).toBeGreaterThan(0.5);
  });
});

 describe("five-second detection deadline", () => {
  it("guesses from partial evidence after five seconds and logs a later correction", () => {
    const tracker = new PositionTracker();
    const g = new Chess(); g.move("e4");
    const partial = settled(g);
    partial.occ[52] = 1; // e2 is still misread as occupied
    partial.conf[52] = 0.2;
    partial.t = 100;
    expect(tracker.observe(partial).status).not.toBe("moved");
    partial.t = 5099;
    expect(tracker.observe(partial).status).not.toBe("moved");
    partial.t = 5100;
    const guess = tracker.observe(partial);
    expect(guess.history).toEqual(["e4"]);
    expect(guess.events.some((e) => e.type === "detection-guess")).toBe(true);
    const actual = new Chess(); actual.move("d4");
    const clear = settled(actual); clear.t = 5200;
    tracker.observe(clear); clear.t = 5300;
    const corrected = tracker.observe(clear);
    expect(corrected.history).toEqual(["d4"]);
    expect(corrected.events.find((e) => e.type === "detection-correction")?.data?.previous).toBe("e4");
  });
 });
