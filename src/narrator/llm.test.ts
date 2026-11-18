import { describe, expect, it } from "vitest";
import { buildMessages, commentate, parseReply } from "./llm";

const s = { apiKey: "k", model: "", names: ["Jean", "Margot"] as [string, string], voices: 2 as const };
const reply = (content: string, ok = true) => (async () => ({ ok, status: ok ? 200 : 401, json: async () => ({ choices: [{ message: { content } }] }) })) as unknown as typeof fetch;

describe("AI commentary", () => {
  it("maps model JSON to speakers, collapsing to voice A in single-voice mode", () => {
    const raw = JSON.stringify({ lines: [{ speaker: "A", text: "Oh !" }, { speaker: "B", text: "Quel coup." }, { speaker: "A", text: "x" }, { speaker: "B", text: "y" }] });
    expect(parseReply(raw, s, 5, 2).map((l) => l.speaker)).toEqual(["A", "B", "A"]);
    expect(parseReply(raw, { ...s, voices: 1 }, 5, 2).every((l) => l.speaker === "A")).toBe(true);
    expect(parseReply("nope", s, 5, 2)).toEqual([]);
  });
  it("asks for English commentary when the language is en", () => {
    const m = buildMessages([{ type: "check", t: 1 }] as any, ["e4", "e5"], { ...s, lang: "en" });
    expect(m[0].content).toContain("Speak English"); expect(m[1].content).toContain("Recent moves: e4 e5");
  });
  it("sends recent moves and events to the model", () => {
    const m = buildMessages([{ type: "check", t: 1 }] as any, ["e4", "e5"], s);
    expect(m[1].content).toContain("e4 e5"); expect(m[1].content).toContain("check");
  });
  it("returns lines on success and rejects on HTTP errors or empty replies so the caller can fall back", async () => {
    const ev = [{ type: "check", t: 9 }] as any;
    expect((await commentate(ev, [], s, 3, reply('{"lines":[{"speaker":"A","text":"Échec !"}]}')))[0]).toMatchObject({ text: "Échec !", t: 9, priority: 3 });
    await expect(commentate(ev, [], s, 3, reply("{}", false))).rejects.toThrow();
    await expect(commentate(ev, [], s, 3, reply('{"lines":[]}'))).rejects.toThrow();
  });
});
