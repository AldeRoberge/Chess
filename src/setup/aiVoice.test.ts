import { afterEach, describe, expect, it, vi } from "vitest";
import { Graph } from "../core/graph";
import { createRegistry } from "../plugins";
import { STEPS, type StepCtx } from "../ui/wizardSteps";
import { buildGraphFromConfig, defaultSetup, loadSetup, saveSetup, validateSetup } from "./config";
import { testElevenLabs, testOpenAiKey } from "./keyTests";

const reply = (ok: boolean, status = 200, body: unknown = { data: [{ id: "gpt-4.1-nano" }] }) => vi.fn(async () => ({ ok, status, json: async () => body }) as Response) as unknown as typeof fetch;
const paramsOf = (c: ReturnType<typeof defaultSetup>, type: string) => { const g = new Graph(createRegistry()); buildGraphFromConfig(g, c); return [...g.nodes.values()].find((n) => n.type === type)!.params; };

describe("AI and voice setup", () => {
  afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

  it("defaults to built-in commentary and system voices with no warnings, and old saved setups gain them", () => {
    const c = defaultSetup();
    expect(c.ai.engine).toBe("builtin"); expect(c.voice.engine).toBe("browser"); expect(validateSetup(c)).toEqual([]);
    const { ai, voice, ...old } = c; void ai; void voice; localStorage.setItem("cx.setup.v1", JSON.stringify(old));
    expect(loadSetup()!.ai.engine).toBe("builtin");
    saveSetup({ ...c, ai: { ...c.ai, engine: "openai", apiKey: "sk-x" } }); expect(loadSetup()!.ai).toMatchObject({ engine: "openai", apiKey: "sk-x" });
  });

  it("warns when a keyed engine has no key or a key of the wrong shape", () => {
    const c = defaultSetup(); c.ai.engine = "openai"; c.voice.engine = "elevenlabs";
    expect(validateSetup(c).map((i) => [i.level, i.field])).toEqual([["warn", "ai"], ["warn", "voice"]]);
    c.ai.apiKey = "nope"; expect(validateSetup(c)[0].message).toMatch(/sk-/);
    c.ai.apiKey = "sk-ok"; c.voice.apiKey = "k"; expect(validateSetup(c)).toEqual([]);
  });

  it("puts the choices into the narration nodes", () => {
    const c = defaultSetup(); c.ai = { engine: "openai", apiKey: " sk-1 ", model: "gpt-4.1-mini" }; c.voice = { engine: "elevenlabs", apiKey: " el-1 ", voiceIdA: "", voiceIdB: "vB" };
    expect(paramsOf(c, "narration.ai")).toMatchObject({ provider: "openai", aiKey: "sk-1", aiModel: "gpt-4.1-mini" });
    expect(paramsOf(c, "narration.speech")).toMatchObject({ provider: "elevenlabs", apiKey: "el-1", voiceIdB: "vB" });
    expect(paramsOf(c, "narration.speech").voiceIdA).toBeTruthy(); // blank falls back to the default voice
    expect(paramsOf(defaultSetup(), "narration.ai")).toMatchObject({ provider: "builtin", aiKey: "" });
  });

  it("explains each failure of the OpenAI key test", async () => {
    expect((await testOpenAiKey("")).tone).toBe("warn");
    expect(await testOpenAiKey("sk-1", reply(true))).toMatchObject({ tone: "ok" });
    expect((await testOpenAiKey("sk-1", reply(false, 401))).text).toMatch(/rejected/);
    expect((await testOpenAiKey("sk-1", reply(false, 429))).text).toMatch(/credit|quota/);
    expect((await testOpenAiKey("sk-1", vi.fn(async () => { throw new TypeError("offline"); }) as unknown as typeof fetch)).text).toMatch(/reach/);
  });

  it("reports an ElevenLabs failure instead of falling back silently", async () => {
    const s = { provider: "elevenlabs" as const, volume: 1, browserA: "", browserB: "", apiKey: "", voiceIdA: "", voiceIdB: "", model: "" };
    expect((await testElevenLabs("x", "A", s)).tone).toBe("warn");
    vi.stubGlobal("fetch", reply(false, 401));
    expect((await testElevenLabs("x", "A", { ...s, apiKey: "k" })).text).toMatch(/rejected/);
    vi.unstubAllGlobals();
  });

  it("shows the how-to steps only for the keyed engine, and masks the key field", () => {
    const c = defaultSetup(), opened: string[] = [], tests: string[] = [];
    const ctx = { cfg: c, state: { tests: {} }, refresh: () => {}, open: (u: string) => opened.push(u), test: (id: string) => tests.push(id), voiceSettings: () => ({}), speak: () => {} } as unknown as StepCtx;
    const ai = STEPS.find((s) => s.id === "ai")!, voice = STEPS.find((s) => s.id === "voice")!;
    // the how-to steps are always listed; the key fields only appear once OpenAI is chosen
    const before = ai.items(ctx);
    expect(before[0].label).toBe("Commentary");
    expect(before.filter((i) => i.kind === "info")).toHaveLength(4);
    expect(before.find((i) => i.kind === "text")).toBeUndefined();
    c.ai.engine = "openai"; c.voice.engine = "elevenlabs";
    for (const step of [ai, voice]) {
      const items = step.items(ctx);
      expect(items.filter((i) => i.kind === "info").map((i) => i.label.slice(0, 2))).toEqual(["1.", "2.", "3.", "4."].slice(0, step === ai ? 4 : 4));
      expect(items.find((i) => i.kind === "text" && i.secret)).toBeTruthy();
      for (const a of items.filter((i) => i.kind === "action" && i.label.startsWith("Open"))) if (a.kind === "action") a.run();
    }
    expect(opened.every((u) => u.startsWith("https://"))).toBe(true); expect(opened).toHaveLength(4);
    const test = ai.items(ctx).find((i) => i.kind === "action" && i.label === "Test key"); if (test?.kind === "action") test.run(); expect(tests).toEqual(["openai"]);
  });
});
