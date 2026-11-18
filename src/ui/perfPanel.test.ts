import { afterEach, describe, expect, it } from "vitest";
import { Graph } from "../core/graph";
import { profiler } from "../core/profiler";
import { Registry } from "../core/types";
import { NodeEditor } from "./editor";
import { PerfPanel } from "./perfPanel";

const setup = () => {
  const r = new Registry();
  r.register({ type: "slow", title: "Slow", category: "Vision", inputs: [], outputs: [], process: (_i, rt) => { rt.span("inner work", () => 1); } });
  r.register({ type: "fast", title: "Fast", category: "Game", inputs: [], outputs: [], process: () => undefined });
  const g = new Graph(r), a = g.addNode("slow"), b = g.addNode("fast");
  const ed = new NodeEditor(g);
  const panel = new PerfPanel(g, { reveal: (id) => ed.reveal(id), setHeat: (on) => ed.setHeat(on), heatOn: () => ed.heatOn });
  document.body.append(panel.root);
  const run = (n = 5) => { for (let i = 0; i < n; i++) { profiler.beginFrame(i * 16); profiler.span("graph.tick", () => g.tick(i * 66)); profiler.endFrame(); } };
  return { g, ed, panel, a, b, run };
};

afterEach(() => { profiler.enabled = false; profiler.paused = false; profiler.reset(); document.body.replaceChildren(); });

describe("PerfPanel", () => {
  it("lists every node with timings and expands inner spans", () => {
    profiler.enabled = true;
    const { panel, a, run } = setup();
    run();
    panel.frame(1000);
    const rows = panel.root.querySelectorAll("tr[data-id]");
    expect(rows).toHaveLength(2);
    (panel.root.querySelector(`tr[data-id="${a.id}"] .perf-x`) as HTMLElement).click();
    expect(panel.root.querySelector("tr.lines")!.textContent).toContain("inner work");
  });

  it("clicking a row reveals that node and the heat toggle drives the editor overlay", () => {
    profiler.enabled = true;
    const { ed, panel, b, run } = setup();
    run(); panel.frame(1000);
    (panel.root.querySelector(`tr[data-id="${b.id}"] td.n`) as HTMLElement).click();
    expect((ed as any).selected.has(b.id)).toBe(true);
    (panel.root.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
    expect(ed.heatOn).toBe(true);
    expect(ed.root.classList.contains("heat")).toBe(true);
    ed.frame(1000);
    expect(ed.root.querySelector(".ne-heat-t")!.textContent).toMatch(/avg/);
  });
});

describe("PerfPanel baseline and budget", () => {
  it("shows a delta column once a baseline is set and flags nodes over budget", () => {
    profiler.enabled = true;
    const { panel, ed, g, a, run } = setup();
    run(); panel.frame(1000);
    expect(panel.root.querySelector("th")!.parentElement!.textContent).not.toContain("Δ base");
    const btn = [...panel.root.querySelectorAll("button")].find((b) => b.textContent === "Set baseline")!;
    btn.click();
    expect(panel.root.querySelector("thead")!.textContent).toContain("Δ base");
    profiler.budget = 0.0000001; // everything is over
    ed.setHeat(true); ed.frame(1000);
    expect(ed.root.querySelector(".ne-node.over")).not.toBeNull();
    void g; void a;
    profiler.budget = 0;
  });
});
