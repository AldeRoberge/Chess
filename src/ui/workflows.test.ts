import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRegistry } from "../plugins";
import { WORKFLOWS } from "../workflows";
import { openAiWizard, openWorkflowPanel, type WorkflowApi } from "./workflows";

const draft = JSON.stringify({ name: "Mine", summary: "Two nodes.", nodes: [{ id: "a", type: "source.synthetic" }, { id: "b", type: "vision.boardReader" }, { id: "z", type: "nope" }], edges: [{ from: "a.frame", to: "b.frame" }] });
const okFetch = () => vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: draft } }] }) })) as unknown as typeof fetch;
const wait = () => new Promise((r) => setTimeout(r, 10));
const q = <T extends Element>(s: string) => document.querySelector<T>(s)!;
const click = (label: string) => [...document.querySelectorAll<HTMLButtonElement>(".bk button")].find((b) => b.textContent === label)!.click();

let api: WorkflowApi, applied: any[], opened: File[];
beforeEach(() => {
  localStorage.clear(); document.body.innerHTML = "";
  applied = []; opened = [];
  api = { registry: createRegistry(), current: () => ({ nodes: [], edges: [] }), apply: (g, s, why) => applied.push({ g, s, why }), openFile: (f) => opened.push(f), fetchImpl: okFetch() };
});

describe("workflow panel", () => {
  it("lists the demos, loads one, opens a file, and Escape closes it", () => {
    openWorkflowPanel(api);
    expect([...document.querySelectorAll(".wf-row b")].map((b) => b.textContent)).toEqual([...WORKFLOWS].sort((a, b) => Number(b.id === "modular-vision") - Number(a.id === "modular-vision")).map((w) => w.name));
    click("Load"); expect(applied[0].why).toContain("Modular"); expect(document.querySelector(".bk")).toBeNull();
    openWorkflowPanel(api);
    const input = q<HTMLInputElement>(".bk input[type=file]");
    Object.defineProperty(input, "files", { value: [new File(["{}"], "w.json")] }); input.dispatchEvent(new Event("change"));
    expect(opened).toHaveLength(1); expect(document.querySelector(".bk")).toBeNull();
    openWorkflowPanel(api); click("Open workflow file…");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); expect(document.querySelector(".bk")).toBeNull();
  });
  it("Start opens the AI wizard", () => {
    openWorkflowPanel(api); click("Start"); expect(q(".bk-head h3").textContent).toBe("Build with AI");
  });
});

describe("AI wizard", () => {
  const fill = (text: string, key = "sk-test") => { q<HTMLTextAreaElement>(".wf-text").value = text; q<HTMLInputElement>("input[type=password]").value = key; };
  it("asks for a description and a key before calling the model", async () => {
    openAiWizard(api); click("Generate workflow");
    expect(q(".wf-status").textContent).toMatch(/Describe/);
    fill("something", ""); click("Generate workflow"); expect(q(".wf-status").textContent).toMatch(/API key/);
  });
  it("generates, shows what was left out, revises, and applies; the key is only kept when asked", async () => {
    openAiWizard(api); fill("two cameras");
    click("Generate workflow"); await wait();
    expect(q("h4").textContent).toBe("Mine"); expect(q(".wf-warn").textContent).toMatch(/nope/);
    expect(JSON.parse(localStorage.getItem("cx.ai.v1")!).apiKey).toBe("");
    q<HTMLTextAreaElement>(".wf-text").value = "add a camera"; click("Revise"); await wait();
    expect((api.fetchImpl as any).mock.calls).toHaveLength(2);
    click("Revise"); // empty tweak is ignored
    click("Apply workflow"); expect(applied[0].g.nodes).toHaveLength(2); expect(applied[0].s).toBeNull(); expect(applied[0].why).toContain("Mine");
    expect(document.querySelector(".bk")).toBeNull();
  });
  it("remembers the key when asked, starts over, and shows errors without losing the form", async () => {
    openAiWizard(api); fill("x"); q<HTMLInputElement>("input[type=checkbox]").checked = true; q<HTMLSelectElement>("select").value = "current";
    api.fetchImpl = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })) as unknown as typeof fetch;
    click("Generate workflow"); await wait();
    expect(q(".wf-status").textContent).toMatch(/key/); expect(JSON.parse(localStorage.getItem("cx.ai.v1")!).apiKey).toBe("sk-test");
    expect(q<HTMLButtonElement>("button.primary").disabled).toBe(false);
    api.fetchImpl = okFetch(); click("Generate workflow"); await wait(); click("Start over"); expect(q("textarea")).toBeTruthy();
  });
  it("surfaces a failed revision", async () => {
    openAiWizard(api); fill("x"); click("Generate workflow"); await wait();
    (api.fetchImpl as any).mockRejectedValueOnce(new Error("offline"));
    q<HTMLTextAreaElement>(".wf-text").value = "again"; click("Revise"); await wait();
    expect(q(".wf-status").textContent).toBe("offline");
  });
});
