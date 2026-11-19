import { beforeEach, describe, expect, it, vi } from "vitest";
import { bus } from "../core/bus";
import { fakeHost, scripted } from "../assistant/testHost";
import { AssistantPanel, md } from "./assistantPanel";

const flush = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 5)); };
const store = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
const q = <T extends Element>(p: AssistantPanel, s: string) => p.root.querySelector<T>(s)!;
const qa = (p: AssistantPanel, s: string) => [...p.root.querySelectorAll<HTMLElement>(s)];
const btn = (p: AssistantPanel, label: string) => qa(p, "button").find((b) => b.textContent!.trim() === label)!;
const mount = (replies: Parameters<typeof scripted>[0], o: { key?: string; opts?: Parameters<typeof scripted>[1] } = {}) => {
  localStorage.clear(); if (o.key !== "") localStorage.setItem("cx.ai.v1", JSON.stringify({ apiKey: o.key ?? "sk-test", model: "gpt-4.1-mini", remember: true }));
  const f = scripted(replies, o.opts), h = fakeHost(), st = store(), p = new AssistantPanel(h.host, { fetchImpl: f.fetch, storage: st });
  document.body.append(p.root); return { p, f, h, st };
};
beforeEach(() => { document.body.innerHTML = ""; bus.events.length = 0; bus.cameras.length = 0; bus.game = null; bus.board = null; });

describe("markdown", () => {
  it("renders a safe subset", () => {
    expect(md("**hi** `x<y` *it*\n- a\n- b\n\n1. one\n# Title\nplain <script>")).toBe("<p><b>hi</b> <code>x&lt;y</code> <i>it</i></p><ul><li>a</li><li>b</li></ul><ul><li>one</li></ul><p>Title<br>plain &lt;script&gt;</p>");
    expect(md("")).toBe("");
  });
});

describe("assistant panel", () => {
  it("answers with streamed text, shows context chips, and remembers the chat", async () => {
    const { p, f, st } = mount([{ content: "You have **two** cameras." }]);
    expect(qa(p, ".as-chip").length).toBeGreaterThan(1);
    q<HTMLTextAreaElement>(p, ".as-in").value = "how many cameras?"; q<HTMLElement>(p, ".as-send").click(); await flush();
    expect(qa(p, ".as-msg.user")[0].textContent).toBe("how many cameras?"); expect(q(p, ".as-msg.assistant .as-body").innerHTML).toContain("<b>two</b>");
    expect(f.calls[0].messages[0].content).toContain("LIVE STATE"); expect(f.calls[0].messages.at(-1)).toEqual({ role: "user", content: "how many cameras?" });
    expect(qa(p, ".as-chip").length).toBeGreaterThan(0); expect(p.history.map((m) => m.role)).toEqual(["user", "assistant"]);
    const again = new AssistantPanel(fakeHost().host, { storage: st }); expect(qa(again, ".as-msg").map((m) => m.className)).toEqual(["as-msg user", "as-msg assistant"]);
    btn(p, "Clear").click(); expect(qa(p, ".as-msg")).toHaveLength(0); expect(p.history).toEqual([]);
  });

  it("shows thinking, tool cards with timings, and an Undo for changes", async () => {
    const { p, h } = mount([{ tools: [{ name: "think", args: { thought: "plan it" } }, { name: "update_setup", args: { changes: { scene: "cavern" } } }, { name: "get_node", args: { id: "zz" } }] }, { content: "Changed the scene." }]);
    p.submit("cavern please"); await flush(12);
    expect(h.host.applySetup).toHaveBeenCalled(); const cards = qa(p, ".as-tool");
    expect(cards.map((c) => c.className.includes("think"))).toEqual([true, false, false]); expect(cards[0].querySelector(".as-thought")!.textContent).toBe("plan it"); expect(cards[0].classList.contains("collapsed")).toBe(true);
    cards[0].querySelector<HTMLElement>(".as-tool-h")!.click(); expect(cards[0].classList.contains("collapsed")).toBe(false);
    expect(cards[1].classList.contains("ok")).toBe(true); expect(cards[2].classList.contains("bad")).toBe(true); expect(cards[2].textContent).toContain("No node");
    const undo = cards[1].querySelector<HTMLButtonElement>(".as-undo")!; undo.click(); expect(h.host.undo).toHaveBeenCalled(); expect(undo.disabled).toBe(true);
  });

  it("asks approval for dangerous tools and offers choices", async () => {
    const draft = { name: "Mini", nodes: [{ id: "a", type: "source.synthetic" }] };
    const { p, h } = mount([{ tools: [{ name: "ask_user", args: { question: "Which?", options: ["One", "Two"] } }] }, { tools: [{ name: "apply_workflow", args: { draft } }, { name: "table_reset", args: {} }] }, { content: "ok" }]);
    p.submit("go"); await flush(); btn(p, "Two").click(); await flush();
    expect(qa(p, ".as-ask")[0].textContent).toContain("→ Two"); const approvals = qa(p, ".as-ask");
    expect(approvals[1].textContent).toContain("Needs your approval"); btn(p, "Approve").click(); await flush(); btn(p, "Decline").click(); await flush(12);
    expect(h.host.applyGraph).toHaveBeenCalledTimes(1); expect(h.host.table.reset).not.toHaveBeenCalled(); expect(qa(p, ".as-tool").some((c) => c.textContent!.includes("You declined"))).toBe(true);
    const free = q<HTMLInputElement>(p, ".as-ask input"); expect(free).toBeNull;
  });

  it("types in a free answer", async () => {
    const { p } = mount([{ tools: [{ name: "ask_user", args: { question: "Name?", options: ["A", "B"] } }] }, { content: "hi" }]);
    p.submit("x"); await flush(); const free = q<HTMLInputElement>(p, ".as-ask input"); free.value = ""; free.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" })); free.value = "Zed"; free.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" })); await flush();
    expect(p.history.find((m) => m.role === "tool")!.content).toContain("Zed");
  });

  it("stops a running reply, and queues messages typed meanwhile", async () => {
    const { p, f } = mount([{ tools: [{ name: "wait_for_event", args: { timeout_s: 30 } }] }, { content: "after" }]);
    p.submit("watch"); await flush(); expect(q(p, ".as-send").classList.contains("on")).toBe(true); expect(qa(p, ".as-chip")).toHaveLength(0);
    p.submit("and then?"); expect(qa(p, ".as-msg.queued")).toHaveLength(1); q<HTMLElement>(p, ".as-send").click(); await flush(10);
    expect(qa(p, ".as-stopped")).toHaveLength(1); expect(p.history.filter((m) => m.role === "user").map((m) => m.content)).toEqual(["watch", "and then?"]); expect(f.calls.length).toBeGreaterThan(1);
    p.submit("   "); expect(p.history.filter((m) => m.role === "user")).toHaveLength(2);
  });

  it("explains errors and retries", async () => {
    const { p } = mount([{}], { opts: { status: 401 } }); p.submit("hi"); await flush();
    expect(q(p, ".as-err").textContent).toContain("rejected"); expect(q(p, ".as-key").classList.contains("open")).toBe(true);
    const f = scripted([{ content: "fine now" }]); (p as any).deps.fetchImpl = f.fetch; btn(p, "Retry").click(); await flush();
    expect(qa(p, ".as-msg.retry")).toHaveLength(0); expect(q(p, ".as-msg.assistant:last-child .as-body").textContent).toBe("fine now"); expect(p.history.filter((m) => m.role === "user")).toHaveLength(1);
  });

  it("asks for a key when there is none, and saves one", async () => {
    const { p, f } = mount([{ content: "x" }], { key: "" });
    expect(q(p, ".as-key").classList.contains("need")).toBe(true); p.submit("hello"); expect(f.calls).toHaveLength(0); expect(q<HTMLTextAreaElement>(p, ".as-in").value).toBe("hello");
    q<HTMLInputElement>(p, ".as-key input[type=password]").value = "sk-new"; btn(p, "Save").click(); expect(JSON.parse(localStorage.getItem("cx.ai.v1")!).apiKey).toBe(""); // not remembered unless asked
    expect(q(p, ".as-key").classList.contains("open")).toBe(true); // still no key persisted, so it stays open
    btn(p, "Key").click();
  });

  it("notices trouble by itself and lights up a nudge", () => {
    const { p } = mount([{ content: "x" }]); const ping = vi.fn(); p.onNudge = ping; bus.cameras.push({ id: "B", online: false, quality: 0, reliability: 0 });
    p.frame(1000); p.frame(1100); p.frame(9000); expect(qa(p, ".as-nudge")).toHaveLength(1); expect(ping).toHaveBeenCalledTimes(1);
    expect(qa(p, ".as-pill")[0].textContent).toBe("page: table"); p.frame(9100);
    q<HTMLElement>(p, ".as-nudge .ghost").click(); expect(qa(p, ".as-nudge")).toHaveLength(0);
    for (const id of ["a", "b", "c", "d"]) bus.cameras.push({ id, online: false, quality: 0, reliability: 0 }); p.frame(20000); p.frame(30000); expect(qa(p, ".as-nudge").length).toBeLessThanOrEqual(3);
    q<HTMLElement>(p, ".as-nudge .primary").click(); expect(p.history[0]?.role).toBe("user");
  });
});
