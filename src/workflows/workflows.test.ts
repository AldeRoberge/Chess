import { beforeEach, describe, expect, it, vi } from "vitest";
import { Graph } from "../core/graph";
import { createRegistry } from "../plugins";
import { AiSession, catalog, chat, draftToGraph, loadAiSettings, parseDraft, saveAiSettings, systemPrompt, toDraft } from "./ai";
import { WORKFLOWS } from "./index";

const reg = createRegistry();

describe("demo workflow files", () => {
  it("ships basic, complete and chess.com, easiest first", () => {
    expect(WORKFLOWS.map((w) => w.id)).toEqual(["basic", "complete", "chesscom", "pieceless", "botplay", "humanvsbot"]);
    expect(WORKFLOWS[0].graph.nodes.length).toBeLessThan(WORKFLOWS[1].graph.nodes.length);
    expect(WORKFLOWS[2].graph.nodes.some((n) => n.type === "game.chesscom")).toBe(true);
    expect(WORKFLOWS[2].graph.nodes.some((n) => n.type === "game.engine")).toBe(false);
  });
  for (const w of WORKFLOWS) {
    it(`${w.id}: every node exists, every wire is legal, and it runs`, () => {
      const g = new Graph(reg);
      g.load(w.graph);
      expect(g.nodes.size).toBe(w.graph.nodes.length);
      expect(g.edges).toHaveLength(w.graph.edges.length); // nothing was dropped by the graph's own rules
      for (let i = 0; i < 5; i++) g.tick(i * 100);
      expect([...g.stats.values()].filter((s) => s.error)).toEqual([]);
    });
  }
});

describe("ids stay unique after loading a save", () => {
  it("never reuses an id that a loaded node or wire already holds", () => {
    const g = new Graph(reg); g.load(WORKFLOWS[0].graph);
    const before = g.nodes.size, extra = g.addNode("sim.person");
    expect(g.nodes.size).toBe(before + 1); expect(WORKFLOWS[0].graph.nodes.some((n) => n.id === extra.id)).toBe(false);
  });
});

describe("draftToGraph", () => {
  it("builds a patch from a draft, clamps params, drops secrets and unknowns, and reports each", () => {
    const b = draftToGraph(reg, {
      name: "T", summary: "S",
      nodes: [
        { id: "c", type: "source.synthetic", params: { cam: "B", bogus: 1 } },
        { id: "r", type: "vision.boardReader" },
        { id: "t", type: "game.tracker", params: { confirm: 99, promotion: "z", resync: "true" } },
        { id: "ai", type: "narration.ai", params: { aiKey: "sk-secret", nameA: "Zed" } },
        { id: "x", type: "no.such" },
      ],
      edges: [{ from: "c.frame", to: "r.frame" }, { from: "r.obs", to: "t.board" }, { from: "c.nope", to: "r.frame" }, { from: "ghost.a", to: "r.frame" }, { from: "c.frame", to: "c.frame" }],
    });
    expect(b.graph.nodes).toHaveLength(4); expect(b.graph.edges).toHaveLength(1);
    const t = b.graph.nodes.find((n) => n.type === "game.tracker")!;
    expect(t.params.confirm).toBe(8); expect(t.params.promotion).toBe("q"); expect(t.params.resync).toBe(true);
    const ai = b.graph.nodes.find((n) => n.type === "narration.ai")!;
    expect(ai.params.aiKey).toBe(""); expect(ai.params.nameA).toBe("Zed");
    expect(b.warnings.join("\n")).toMatch(/no\.such/); expect(b.warnings.join("\n")).toMatch(/bogus/); expect(b.warnings.join("\n")).toMatch(/aiKey/);
    expect(b.warnings.filter((w) => w.startsWith("Skipped wire"))).toHaveLength(4);
    expect(b.name).toBe("T");
  });
  it("lays the result out in titled sections by role, and copes with junk and feedback loops", () => {
    const b = draftToGraph(reg, { nodes: [{ id: "a", type: "source.synthetic" }, { id: "b", type: "vision.boardReader" }, { id: "c", type: "vision.fuse" }], edges: [{ from: "a.frame", to: "b.frame" }, { from: "b.obs", to: "c.o1" }] });
    expect(b.graph.groups!.map((g) => g.title)).toEqual(["Demo & input", "Analysis"]);
    const [src, rd, fuse] = b.graph.nodes; expect(src.y).toBeLessThan(rd.y); expect(rd.x).toBeLessThan(fuse.x);
    expect(draftToGraph(reg, {}).graph.nodes).toEqual([]);
    expect(draftToGraph(reg, { nodes: "x" as any, edges: "y" as any }).name).toBe("AI workflow");
    const loop = draftToGraph(reg, { nodes: [{ id: "t", type: "game.tracker" }, { id: "d", type: "experience.director" }], edges: [{ from: "d.director", to: "t.director" }, { from: "t.events", to: "d.events" }] });
    expect(loop.graph.edges).toHaveLength(2);
  });
});

describe("prompt", () => {
  it("lists node types without secret params, and the draft form never carries secrets", () => {
    const c = catalog(reg);
    expect(c).toContain("game.chesscom"); expect(c).not.toMatch(/aiKey|apiKey/);
    const g = new Graph(reg); g.addNode("narration.ai", 0, 0, { aiKey: "sk-secret" });
    expect(JSON.stringify(toDraft(g.toJSON()))).not.toContain("sk-secret");
    expect(systemPrompt(reg)).toContain("ONE JSON object");
  });
  it("parseDraft accepts fenced JSON and rejects the rest", () => {
    expect(parseDraft("```json\n{\"name\":\"x\"}\n```")).toEqual({ name: "x" });
    expect(parseDraft("nope")).toBeNull(); expect(parseDraft("null")).toBeNull();
  });
});

const reply = (content: unknown, ok = true, status = 200) => vi.fn(async () => ({ ok, status, json: async () => ({ choices: [{ message: { content } }] }) })) as unknown as typeof fetch;
const draft = JSON.stringify({ name: "Mine", summary: "s", nodes: [{ id: "a", type: "source.synthetic" }, { id: "b", type: "vision.boardReader" }], edges: [{ from: "a.frame", to: "b.frame" }] });

describe("chat + session", () => {
  it("sends the key and model, and maps failures to readable errors", async () => {
    const f = reply("ok"); await chat([{ role: "user", content: "hi" }], { apiKey: " k ", model: "" }, f);
    const [url, init] = (f as any).mock.calls[0]; expect(url).toContain("openai.com"); expect(init.headers.Authorization).toBe("Bearer k");
    expect(JSON.parse(init.body).model).toBeTruthy();
    await expect(chat([], { apiKey: "k", model: "m" }, reply("", true))).rejects.toThrow(/empty/);
    await expect(chat([], { apiKey: "k", model: "m" }, reply("x", false, 401))).rejects.toThrow(/key/);
    await expect(chat([], { apiKey: "k", model: "m" }, reply("x", false, 500))).rejects.toThrow(/500/);
    const hang = vi.fn((_u: string, init: any) => new Promise((_r, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("a"), { name: "AbortError" }))))) as unknown as typeof fetch;
    await expect(chat([], { apiKey: "k", model: "m", timeoutMs: 5 }, hang)).rejects.toThrow(/timed out/);
  });
  it("builds a workflow, keeps the conversation for revisions, and rejects unusable replies", async () => {
    const f = reply(draft), s = new AiSession(reg, { apiKey: "k", model: "m" }, undefined, f);
    expect((await s.ask("two nodes")).graph.nodes).toHaveLength(2);
    await s.ask("add more");
    const msgs = JSON.parse((f as any).mock.calls[1][1].body).messages; expect(msgs.map((m: any) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(msgs[3].content).toContain("Revise");
    await expect(new AiSession(reg, { apiKey: "k", model: "m" }, undefined, reply("not json")).ask("x")).rejects.toThrow(/valid JSON/);
    await expect(new AiSession(reg, { apiKey: "k", model: "m" }, undefined, reply("{}")).ask("x")).rejects.toThrow(/no usable nodes/);
  });
  it("can start from the current patch without sending its secrets", async () => {
    const g = new Graph(reg); g.addNode("narration.ai", 0, 0, { aiKey: "sk-secret" });
    const f = reply(draft); await new AiSession(reg, { apiKey: "k", model: "m" }, g.toJSON(), f).ask("tweak");
    const body = (f as any).mock.calls[0][1].body as string; expect(body).toContain("Current workflow"); expect(body).not.toContain("sk-secret");
  });
});

describe("ai settings", () => {
  beforeEach(() => localStorage.clear());
  it("remembers the model always, the key only when asked", () => {
    saveAiSettings({ apiKey: "sk-1", model: "m1", remember: false });
    expect(loadAiSettings()).toEqual({ apiKey: "", model: "m1", remember: false });
    saveAiSettings({ apiKey: "sk-1", model: "m1", remember: true });
    expect(loadAiSettings().apiKey).toBe("sk-1");
    localStorage.setItem("cx.ai.v1", "{bad"); expect(loadAiSettings().apiKey).toBe("");
  });
});
