import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { Coach, type CoachLine } from "./coach";
import { coachTier, parseCoachSettings } from "./coachSettings";
import { Narrator, defaultNarratorConfig } from "./narrator";
import type { ExperienceEvent } from "../core/events";
import type { CoachLevel } from "./coachSettings";

/** The move events the tracker would send for a list of SAN moves. */
function events(sans: string[]): ExperienceEvent[][] {
  const g = new Chess();
  return sans.map((san, i) => {
    const m = g.move(san);
    const data = { san: m.san, from: m.from, to: m.to, piece: m.piece, color: m.color, captured: m.captured, flags: m.flags, ply: i + 1, check: g.inCheck(), mate: g.isCheckmate() };
    const out: ExperienceEvent[] = [{ type: "move", t: i * 4000, data }];
    if (m.captured) out.push({ type: "capture", t: i * 4000, data });
    if (data.check && !data.mate) out.push({ type: "check", t: i * 4000, data });
    return out;
  });
}

function play(sans: string[], level: CoachLevel, opts: { opponent?: "w" | "b" | null; talks?: boolean; lang?: "en" | "fr" } = {}) {
  const c = new Coach({ level, lang: opts.lang ?? "en", opponent: opts.opponent ?? null, opponentTalks: opts.talks ?? false, names: { A: "Jean", C: "Vega" } }, 7);
  const lines: CoachLine[][] = [];
  for (const evs of events(sans)) lines.push(evs.flatMap((e) => c.react(e)));
  return lines;
}

describe("coach", () => {
  it("names the Queen's Gambit with its reason and lights its squares", () => {
    const ls = play(["d4", "d5", "c4"], "beginner");
    const l = ls[2].find((x) => x.label === "Queen's Gambit")!;
    expect(l.text).toMatch(/^This is known as the Queen's Gambit, because White offers the c-pawn/);
    expect(l.squares).toEqual(["d4", "d5", "c4"]);
    expect(l.speaker).toBe("B");
  });

  it("the opponent asks what a gambit is, and a commentator answers after the next move", () => {
    const ls = play(["d4", "d5", "c4", "e6"], "beginner", { opponent: "b", talks: true });
    const q = ls[2].find((x) => x.speaker === "C" && /gambit is\?/.test(x.text));
    expect(q).toBeTruthy();
    const a = ls[3].find((x) => x.speaker === "A");
    expect(a?.text).toMatch(/^To answer Vega: A gambit is an opening where a player sacrifices material/);
    expect(ls[3].some((x) => x.speaker === "C")).toBe(true); // the opponent reacts to the answer
  });

  it("without an opponent the second commentator asks instead", () => {
    const ls = play(["d4", "d5", "c4", "e6"], "beginner");
    expect(ls[2].some((x) => x.speaker === "B" && /gambit/.test(x.text) && x.text.endsWith("?"))).toBe(true);
    expect(ls[3].find((x) => x.speaker === "A")?.text).toMatch(/^A gambit is/);
  });

  it("spots a knight fork of king and rook", () => {
    // White knight takes on c7 (backed by the f4 bishop), attacking the king on e8 and the rook on a8
    const ls = play(["d4", "Nf6", "Bf4", "g6", "Nc3", "Bg7", "Nb5", "h6", "Nxc7+"], "intermediate");
    const f = ls[8].find((x) => x.label === "fork");
    expect(f?.text).toMatch(/This is known as a fork, because one piece attacks two/);
    expect(f?.squares).toEqual(expect.arrayContaining(["c7", "e8", "a8"]));
  });

  it("spots a pin to the king", () => {
    const ls = play(["e4", "e5", "Nf3", "d6", "d4", "Nc6", "Bb5"], "advanced");
    const pin = ls[6].find((x) => x.label === "pin");
    expect(pin?.text).toMatch(/^That's a pin: /);
    expect(pin?.squares).toEqual(["b5", "c6", "e8"]);
  });

  it("the opponent comments on a tactic in character", () => {
    const ls = play(["d4", "Nf6", "Bf4", "g6", "Nc3", "Bg7", "Nb5", "h6", "Nxc7+"], "beginner", { opponent: "b", talks: true });
    expect(ls[8].some((x) => x.speaker === "C" && /fork/.test(x.text))).toBe(true);
  });

  it("expert is terse and skips the basics", () => {
    const ls = play(["e4", "c5", "Nf3", "d6"], "expert").flat();
    expect(ls.some((x) => x.label === "Sicilian Defence")).toBe(false);
    const qgd = play(["d4", "d5", "c4", "e6"], "expert").flat().find((x) => x.label === "Queen's Gambit Declined");
    expect(qgd?.text).toBe("Queen's Gambit Declined: solid d5 chain, at the cost of locking in the light-squared bishop.");
    expect(play(["d4", "d5", "c4", "e6", "Nc3", "Nf6", "Bg5", "Be7", "e3", "O-O", "Nf3", "h6"], "expert").flat().some((x) => /\?$/.test(x.text))).toBe(false); // no trivia
  });

  it("off says nothing", () => {
    expect(play(["d4", "d5", "c4", "e6", "Nc3"], "off").flat()).toEqual([]);
  });

  it("speaks French by default", () => {
    const l = play(["e4", "c5"], "beginner", { lang: "fr" })[1][0];
    expect(l.text).toMatch(/^On appelle ça la défense sicilienne, parce que les noirs/);
  });

  it("names a fianchetto and an isolated queen's pawn once", () => {
    const fi = play(["Nf3", "d5", "g3", "Nf6", "Bg2"], "intermediate").flat().filter((x) => x.label === "fianchetto");
    expect(fi).toHaveLength(1);
    expect(fi[0].squares).toEqual(["g2", "g3"]);
    const iqp = play(["d4", "d5", "c4", "e6", "Nc3", "c5", "cxd5", "exd5", "Nf3", "Nc6", "dxc5", "Bxc5"], "beginner").flat().filter((x) => x.label === "isolated queen's pawn");
    expect(iqp).toHaveLength(1);
    expect(iqp[0].squares).toEqual(["d5"]);
  });

  it("greets on its first move and banters now and then", () => {
    const c = new Coach({ level: "beginner", lang: "en", opponent: "b", opponentTalks: true, names: { A: "Jean", C: "Vega" } }, 3);
    const first = c.react({ type: "engine-move", t: 0, data: { san: "e5" } });
    expect(first[0].text).toMatch(/Vega/);
    const more = Array.from({ length: 6 }, (_, i) => c.react({ type: "engine-move", t: i, data: {} })).flat();
    expect(more.length).toBeGreaterThan(0);
    expect(more.length).toBeLessThan(6);
  });

  it("the opponent is quiet when it doesn't talk or isn't playing", () => {
    expect(play(["e4", "d5", "exd5"], "beginner", { opponent: "b", talks: false }).flat().some((x) => x.speaker === "C")).toBe(false);
    expect(play(["e4", "d5", "exd5"], "beginner", { opponent: null, talks: true }).flat().some((x) => x.speaker === "C")).toBe(false);
  });
});

describe("coach settings", () => {
  it("parses saved settings and falls back on junk", () => {
    expect(parseCoachSettings('{"level":"expert","opponentTalks":false}')).toEqual({ level: "expert", opponentTalks: false });
    expect(parseCoachSettings("{oops")).toEqual({ level: "intermediate", opponentTalks: true });
    expect(parseCoachSettings('{"level":"grandmaster"}').level).toBe("intermediate");
    expect(coachTier("off")).toBe(0); expect(coachTier("expert")).toBe(4);
  });
});

describe("narrator with the coach", () => {
  it("adds the opponent's voice under its own name and keeps the lesson's squares", () => {
    const n = new Narrator({ ...defaultNarratorConfig(), lang: "en", level: "beginner", opponent: "b", opponentTalks: true, opponentName: "Vega", seed: 5 });
    const all = events(["d4", "d5", "c4"]).flatMap((evs) => n.handle(evs));
    const lesson = all.find((l) => l.squares);
    expect(lesson).toMatchObject({ speaker: "B", name: "Margot", label: "Queen's Gambit", tag: "coach" });
    expect(all.some((l) => l.speaker === "C" && l.name === "Vega")).toBe(true);
  });

  it("stays as before when the level is not set", () => {
    const n = new Narrator({ ...defaultNarratorConfig(), lang: "en", seed: 5 });
    const all = events(["d4", "d5", "c4"]).flatMap((evs) => n.handle(evs));
    expect(all.some((l) => l.tag)).toBe(false);
  });
});
