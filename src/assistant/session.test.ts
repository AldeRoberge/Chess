import { beforeEach, describe, expect, it } from "vitest";
import { bus } from "../core/bus";
import { ChatSession, type SessionEvent } from "./session";
import { fakeHost, scripted } from "./testHost";

const flush = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 5)); };
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }; };
const make = (replies: Parameters<typeof scripted>[0], o: { key?: string; opts?: Parameters<typeof scripted>[1]; storage?: ReturnType<typeof mem> } = {}) => {
  const events: SessionEvent[] = [], f = scripted(replies, o.opts), storage = o.storage ?? mem(), taken: string[][] = [];
  const s = new ChatSession({ host: fakeHost().host, watcher: { take: () => { taken.push([]); return ["a move"]; } }, settings: () => ({ apiKey: o.key ?? "sk-t", model: "m" }), emit: (e) => events.push(e), fetchImpl: f.fetch, storage });
  return { s, events, f, storage, types: () => events.map((e) => e.type) };
};
beforeEach(() => { bus.events.length = 0; bus.cameras.length = 0; });

describe("ChatSession (no DOM)", () => {
  it("runs a turn, reports state changes, counts tokens and saves", async () => {
    const { s, events, f, storage, types } = make([{ content: "Hi" }]);
    s.submit("  hello  "); expect(s.busy).toBe(true); await flush();
    expect(types()).toEqual(expect.arrayContaining(["user", "busy", "agent"])); expect(events.filter((e) => e.type === "busy").map((e: any) => e.on)).toEqual([true, false]);
    expect(s.busy).toBe(false); expect(s.usage).toEqual({ prompt: 10, completion: 4 }); expect(s.transcript()).toEqual([{ role: "user", text: "hello" }, { role: "assistant", text: "Hi" }]);
    expect(f.calls[0].messages[0].content).toContain("a move"); // what happened since the last message reaches the model
    expect(JSON.parse(storage.m.get("cx.assistant.v1")!)).toHaveLength(2);
    expect(new ChatSession({ host: fakeHost().host, watcher: { take: () => [] }, settings: () => ({ apiKey: "k", model: "m" }), emit: () => {}, storage }).transcript()).toHaveLength(2);
  });

  it("needs a key, and says so without sending", async () => {
    const { s, events, f } = make([{ content: "x" }], { key: " " }); s.submit("hello"); await flush();
    expect(events).toEqual([{ type: "needKey", draft: "hello" }]); expect(f.calls).toHaveLength(0); s.retry(); await flush(); expect(events.at(-1)).toEqual({ type: "needKey", draft: "" }); s.submit(" ");
    expect(events).toHaveLength(2);
  });

  it("queues messages typed during a reply and runs them after", async () => {
    const { s, events } = make([{ tools: [{ name: "wait_for_event", args: { timeout_s: 0.2 } }] }, { content: "done" }, { content: "second" }]);
    s.submit("one"); s.submit("two"); expect(s.queued).toBe(1); expect(events.find((e) => e.type === "user" && e.queued)).toBeTruthy(); await flush(80);
    expect(events.some((e) => e.type === "dequeued")).toBe(true); expect(s.transcript().map((m) => m.text)).toEqual(["one", "done", "two", "second"]);
  });

  it("settles open questions when stopped", async () => {
    const { s, events } = make([{ tools: [{ name: "ask_user", args: { question: "q", options: ["a", "b"] } }, { name: "table_reset", args: {} }] }, { content: "ok" }]);
    s.submit("go"); await flush(); expect(events.some((e) => e.type === "choice")).toBe(true); s.stop(); await flush(10);
    expect(events.some((e) => e.type === "stopped")).toBe(true); expect(s.busy).toBe(false);
  });

  it("answers approvals and choices through the events", async () => {
    const { s, events } = make([{ tools: [{ name: "table_reset", args: {} }] }, { tools: [{ name: "ask_user", args: { question: "q", options: ["a", "b"] } }] }, { content: "ok" }]);
    s.submit("go"); await flush(); (events.find((e) => e.type === "approval") as any).answer(true); await flush(); (events.find((e) => e.type === "choice") as any).answer("b"); await flush(10);
    expect(s.history.filter((m) => m.role === "tool").map((m) => m.content).join()).toMatch(/reset.*answer.*b/);
  });

  it("reports failures, and a bad key apart, and retries", async () => {
    const bad = make([{}], { opts: { status: 401 } }); bad.s.submit("hi"); await flush(); expect(bad.events.find((e) => e.type === "error")).toMatchObject({ badKey: true });
    const down = make([{}], { opts: { status: 500 } }); down.s.submit("hi"); await flush(); expect(down.events.find((e) => e.type === "error")).toMatchObject({ badKey: false });
    expect(down.s.history).toHaveLength(1); down.s.retry(); await flush(); expect(down.events.filter((e) => e.type === "error")).toHaveLength(2);
  });

  it("clears, survives broken storage, and ignores junk in it", () => {
    const st = mem(); st.m.set("cx.assistant.v1", JSON.stringify([{ role: "tool", content: "x" }, { role: "user", content: "kept" }, null, { role: "assistant", content: "a" }]));
    const { s, events } = make([{ content: "x" }], { storage: st }); expect(s.history.map((m) => m.content)).toEqual(["kept", "a"]);
    s.clear(); expect(s.history).toEqual([]); expect(events.at(-1)).toEqual({ type: "cleared" }); expect(st.m.has("cx.assistant.v1")).toBe(false);
    st.m.set("cx.assistant.v1", "{bad"); expect(make([{}], { storage: st }).s.history).toEqual([]);
    const boom = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); }, removeItem: () => { throw new Error("x"); } };
    const t = new ChatSession({ host: fakeHost().host, watcher: { take: () => [] }, settings: () => ({ apiKey: "k", model: "m" }), emit: () => {}, storage: boom, fetchImpl: scripted([{ content: "x" }]).fetch });
    t.submit("hi"); t.clear(); expect(t.history).toEqual([]);
  });
});
