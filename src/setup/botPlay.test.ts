import { describe, expect, it } from "vitest";
import { createRegistry } from "../plugins";
import { buildBotPlay, botColor } from "./botPlay";

const reg = createRegistry();
const find = (g: { nodes: { type: string; params: any }[] }, type: string) => g.nodes.filter((n) => n.type === type);

describe("botColor", () => {
  it("gives the bot the opposite colour of who starts", () => { expect(botColor("me-white")).toBe("b"); expect(botColor("me-black")).toBe("w"); });
  it("randomizes", () => { expect(botColor("random", () => 0.1)).toBe("w"); expect(botColor("random", () => 0.9)).toBe("b"); });
});

describe("buildBotPlay", () => {
  it("simulated: virtual cameras, seated human, bot's virtual hand plays", () => {
    const r = buildBotPlay(reg, { start: "me-black", presence: "simulated", elo: 900 });
    expect(r.bot).toBe("w"); expect(r.setup.completed).toBe(true);
    expect(find(r.graph as any, "game.engine")[0].params).toMatchObject({ color: "w", virtualHand: true });
    expect(find(r.graph as any, "sim.person")[0].params.seated).toBe(true);
    expect(find(r.graph as any, "experience.director")[0].params).toMatchObject({ preset: "engine", presetElo: "900" });
    expect(find(r.graph as any, "source.synthetic").length).toBe(2);
  });
  it("webcams: real sources and pose tracking, the bot only announces its move", () => {
    const r = buildBotPlay(reg, { start: "me-white", presence: "webcams", elo: 1500 });
    expect(find(r.graph as any, "game.engine")[0].params).toMatchObject({ color: "b", virtualHand: false });
    expect(find(r.graph as any, "source.webcam").length).toBe(1);
    expect(find(r.graph as any, "tracking.pose").length).toBe(1);
  });
});
