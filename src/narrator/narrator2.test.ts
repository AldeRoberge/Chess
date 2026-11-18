import { describe, expect, it } from "vitest";
import type { ExperienceEvent } from "../core/events";
import { Narrator, defaultNarratorConfig } from "./narrator";

const quiet = () => new Narrator({ ...defaultNarratorConfig(), minGapMs: 0 });
const say = (n: Narrator, type: string, data: Record<string, any> = {}, t = 100000) => n.handle([{ type, t, data } as ExperienceEvent]);
const texts = (l: { text: string }[]) => l.map((x) => x.text).join(" | ");

describe("Narrator", () => {
  it("has two default commentators with a minimum gap", () => { expect(defaultNarratorConfig()).toEqual({ voices: 2, names: ["Jean", "Margot"], seed: 7, minGapMs: 900 }); });
  it("announces seat and leave events at critical priority", () => {
    const n = quiet();
    expect(say(n, "seat")[0]).toMatchObject({ speaker: "A", name: "Jean", priority: 3 });
    expect(say(n, "leave", {}, 200000)[0].priority).toBe(3);
  });
  it("describes the chosen mode: Stockfish with its Elo, or two players", () => {
    const n = quiet();
    expect(texts(say(n, "mode", { mode: "engine", elo: 1500 }))).toContain("1500 Elo");
    expect(texts(say(n, "mode", { mode: "human" }, 200000))).toContain("deux joueurs");
  });
  it("narrates phases: intro colour, outro with or without a result, silence otherwise", () => {
    const n = quiet();
    expect(say(n, "phase", { phase: "intro" })[0].speaker).toBe("B");
    expect(say(n, "phase", { phase: "outro", result: "partie nulle" }, 200000)[0].text).toContain("partie nulle");
    expect(say(n, "phase", { phase: "outro" }, 300000)[0].text).toBe("La partie est terminée.");
    expect(say(n, "phase", { phase: "menu" }, 400000)).toEqual([]);
  });
  it("calls ordinary moves, with colour commentary every sixth ply", () => {
    const n = quiet();
    const l = say(n, "move", { color: "w", piece: "n", to: "f3", san: "Nf3", ply: 1, flags: "n" });
    expect(l).toHaveLength(1); expect(l[0].priority).toBe(1);
    const six = say(n, "move", { color: "b", piece: "p", to: "d5", san: "d5", ply: 6, flags: "b" }, 200000);
    expect(six.map((x) => x.speaker)).toEqual(["A", "B"]);
  });
  it("leaves captures, castling and promotion moves to their dedicated events", () => {
    const n = quiet();
    expect(say(n, "move", { color: "w", piece: "p", to: "d5", captured: "p", flags: "c", ply: 3 })).toEqual([]);
    expect(say(n, "move", { color: "w", piece: "k", to: "g1", flags: "k", ply: 3 })).toEqual([]);
    expect(say(n, "move", { color: "w", piece: "p", to: "a8", flags: "np", promotion: "q", ply: 3 })).toEqual([]);
  });
  it("reacts to a lost queen with both voices, to other captures with a name for each piece, in both genders", () => {
    const n = quiet();
    const q = say(n, "capture", { color: "w", piece: "p", captured: "q", to: "d5" });
    expect(q.map((x) => x.speaker)).toEqual(["A", "B"]); expect(q[0].text).toContain("la dame en d5"); expect(q.every((x) => x.priority === 3)).toBe(true);
    const names: Record<string, string> = { p: "pion", n: "cavalier", b: "fou", r: "tour", q: "dame", k: "roi" };
    let t = 200000;
    for (const piece of Object.keys(names)) { const l = say(n, "capture", { color: "b", piece, captured: "n", to: "e5" }, (t += 10000)); expect(l[0].text.toLowerCase()).toContain(names[piece]); expect(l[0].text).toContain("un cavalier"); }
    expect(say(n, "capture", { color: "b", piece: "r", captured: "r", to: "a1" }, (t += 10000))[0].text).toContain("une tour");
  });
  it("describes castling sides, promotion, check, mate for either colour, draws", () => {
    const n = quiet(); let t = 0; const next = () => (t += 10000);
    expect(say(n, "castle", { color: "w", flags: "k" }, next())[0].text).toBe("Les blancs roquent côté roi.");
    expect(say(n, "castle", { color: "b", flags: "q" }, next())[0].text).toBe("Les noirs roquent côté dame.");
    expect(say(n, "promotion", { to: "a8", promotion: "q" }, next())[0].text).toContain("devient la dame");
    expect(say(n, "promotion", { to: "a8", promotion: "n" }, next())[0].text).toContain("un cavalier");
    expect(say(n, "promotion", { to: "a8" }, next())[0].text).toContain("devient une dame"); // unknown piece defaults to a queen
    expect(say(n, "check", {}, next())[0]).toMatchObject({ text: "Échec !", priority: 3 });
    expect(say(n, "mate", { color: "w" }, next())[0].text).toContain("Les blancs l'emportent");
    expect(say(n, "mate", { color: "b" }, next())[0].text).toContain("Les noirs l'emportent");
    expect(say(n, "draw", {}, next())[0].text).toContain("nulle");
  });
  it("stays silent on a lifted piece or unreadable board, and comments on the engine's reply (SAN preferred, else UCI)", () => {
    const n = quiet();
    expect(say(n, "lifted", {}, 100000)).toEqual([]); expect(say(n, "illegal", {}, 200000)).toEqual([]); // never guess what the players are doing
    expect(say(n, "engine-move", { san: "Nf6", uci: "g8f6" }, 300000)[0].text).toContain("Nf6");
    expect(say(n, "engine-move", { uci: "g8f6" }, 400000)[0].text).toContain("g8f6");
  });
  it("ignores unknown events and events with no data", () => {
    const n = quiet();
    expect(say(n, "teleport")).toEqual([]);
    expect(n.handle([{ type: "seat", t: 5 }])).toHaveLength(1);
    expect(n.handle([{ type: "mode", t: 6000 }])[0].text).toContain("deux joueurs"); // no data: the human branch
  });
  it("single-voice mode never uses voice B", () => {
    const n = new Narrator({ voices: 1, names: ["Solo", "Unused"], seed: 1, minGapMs: 0 });
    const l = say(n, "capture", { color: "w", piece: "p", captured: "q", to: "d5" });
    expect(l.every((x) => x.speaker === "A" && x.name === "Solo")).toBe(true);
  });
  it("rate-limits chatter: low-priority lines inside 2.5 s of the last chatter are dropped; critical ones always pass; gap rule spares same-instant lines", () => {
    const n = new Narrator({ ...defaultNarratorConfig(), minGapMs: 900 });
    expect(say(n, "move", { color: "w", piece: "p", to: "e4", san: "e4", ply: 1, flags: "b" }, 10000)).toHaveLength(1);
    expect(say(n, "move", { color: "b", piece: "p", to: "e5", san: "e5", ply: 2, flags: "b" }, 11000)).toEqual([]); // throttled chatter
    expect(say(n, "move", { color: "w", piece: "p", to: "d4", san: "d4", ply: 4, flags: "b" }, 13000)).toHaveLength(1);
    expect(say(n, "check", {}, 13100)).toHaveLength(2); // critical passes right after chatter
    // priority 2 inside the minimum gap after a priority-3 line is dropped; same-instant pairs survive
    const m = new Narrator({ ...defaultNarratorConfig(), minGapMs: 900 });
    expect(say(m, "seat", {}, 50000)).toHaveLength(1);
    expect(say(m, "castle", { color: "w", flags: "k" }, 50300)).toEqual([]);
    expect(say(m, "castle", { color: "w", flags: "k" }, 51500).length).toBeGreaterThan(0);
    const pair = m.handle([{ type: "capture", t: 90000, data: { color: "w", piece: "p", captured: "q", to: "d5" } }]);
    expect(pair).toHaveLength(2);
  });
  it("is deterministic for a given seed and varies across seeds", () => {
    const a = new Narrator({ ...defaultNarratorConfig(), minGapMs: 0, seed: 1 }), b = new Narrator({ ...defaultNarratorConfig(), minGapMs: 0, seed: 1 }), c = new Narrator({ ...defaultNarratorConfig(), minGapMs: 0, seed: 99 });
    const run = (n: Narrator) => Array.from({ length: 12 }, (_, i) => texts(say(n, "move", { color: "w", piece: "n", to: "f3", san: "Nf3", ply: 1, flags: "n" }, 10000 + i * 5000))).join("/");
    expect(run(a)).toBe(run(b)); expect(run(a)).not.toBe(run(c));
  });
});
