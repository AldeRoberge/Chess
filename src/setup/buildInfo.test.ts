import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILD, buildBadge, ciBadge, latestCi, short, type CiRun } from "./buildInfo";

const NOW = Date.parse("2026-11-18T12:00:00Z");
const ago5 = NOW - 5 * 60_000;
const run = (over: Record<string, unknown> = {}) => ({ status: "completed", conclusion: "success", head_sha: "abcdef1234567", run_started_at: "2026-11-18T11:55:00Z", html_url: "https://github.com/AldeRoberge/Chess/actions/runs/1", ...over });
const reply = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response);

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("latestCi", () => {
  it("asks GitHub for the newest ci.yml run on main and reads a passed run", async () => {
    const f = reply({ workflow_runs: [run()] });
    const ci = await latestCi(f as unknown as typeof fetch);
    expect((f.mock as unknown as { calls: string[][] }).calls[0][0]).toBe("https://api.github.com/repos/AldeRoberge/Chess/actions/workflows/ci.yml/runs?branch=main&per_page=1");
    expect(ci).toEqual({ state: "passed", commit: "abcdef1234567", at: Date.parse("2026-11-18T11:55:00Z"), url: "https://github.com/AldeRoberge/Chess/actions/runs/1" });
  });
  it("maps a finished non-success run to failed and an unfinished one to running", async () => {
    expect((await latestCi(reply({ workflow_runs: [run({ conclusion: "failure" })] }) as unknown as typeof fetch))!.state).toBe("failed");
    expect((await latestCi(reply({ workflow_runs: [run({ status: "in_progress", conclusion: null })] }) as unknown as typeof fetch))!.state).toBe("running");
  });
  it("falls back to the creation time and empty strings when a run lacks them", async () => {
    const ci = await latestCi(reply({ workflow_runs: [{ status: "completed", conclusion: "success", created_at: "2026-11-18T10:00:00Z" }] }) as unknown as typeof fetch);
    expect(ci).toEqual({ state: "passed", commit: "", at: Date.parse("2026-11-18T10:00:00Z"), url: "" });
  });
  it("returns null when GitHub refuses, has no runs, or answers with nothing usable", async () => {
    expect(await latestCi(reply({}, false) as unknown as typeof fetch)).toBeNull();
    expect(await latestCi(reply({ workflow_runs: [] }) as unknown as typeof fetch)).toBeNull();
    expect(await latestCi(reply({}) as unknown as typeof fetch)).toBeNull();
    expect(await latestCi(reply(null) as unknown as typeof fetch)).toBeNull();
  });
  it("returns null when the request fails (offline), without throwing", async () => {
    expect(await latestCi((async () => { throw new TypeError("offline"); }) as unknown as typeof fetch)).toBeNull();
  });
  it("uses the page's fetch when none is given", async () => {
    vi.stubGlobal("fetch", reply({ workflow_runs: [run({ conclusion: "failure" })] }));
    expect((await latestCi())!.state).toBe("failed");
  });
});

describe("short", () => {
  it("keeps the first seven characters of a commit", () => {
    expect(short("abcdef1234567890")).toBe("abcdef1");
    expect(BUILD.time).toBeTypeOf("number");
  });
});

describe("buildBadge", () => {
  const ci = (commit: string): CiRun => ({ state: "passed", commit, at: ago5, url: "" });
  it("says the build is latest when CI last checked the same commit", () => {
    const b = buildBadge({ time: NOW - 300_000, commit: "1234567abc" }, ci("1234567abc"), NOW);
    expect(b).toMatchObject({ tone: "ok", text: "build 5 min ago · 1234567 · latest" });
    expect(b.tip).toContain("This is the commit CI last checked on main.");
    expect(b.tip).toContain("from commit 1234567");
  });
  it("warns when CI on main has moved past this build", () => {
    const b = buildBadge({ time: NOW - 300_000, commit: "1234567abc" }, ci("fffffff000"), NOW);
    expect(b).toMatchObject({ tone: "warn", text: "build 5 min ago · 1234567 · behind main" });
    expect(b.tip).toContain("reload to get it");
  });
  it("stays neutral while asking, when GitHub can't say, or when the commit is unknown", () => {
    expect(buildBadge({ time: NOW, commit: "1234567" }, undefined, NOW)).toMatchObject({ tone: "", text: "build just now · 1234567" });
    expect(buildBadge({ time: NOW, commit: "1234567" }, null, NOW).tip).toContain("when GitHub can be reached");
    expect(buildBadge({ time: NOW, commit: "" }, ci("1234567"), NOW)).toMatchObject({ tone: "", text: "build just now" });
    expect(buildBadge({ time: NOW, commit: "1234567" }, ci(""), NOW)).toMatchObject({ tone: "", text: "build just now · 1234567" });
    expect(buildBadge({ time: NOW, commit: "" }, ci("1234567"), NOW).tip).not.toContain("from commit");
  });
});

describe("ciBadge", () => {
  const run = (state: CiRun["state"]): CiRun => ({ state, commit: "abcdef1234", at: ago5, url: "https://example.test/run" });
  it("shows the state of the latest run, linked to GitHub, with its age", () => {
    expect(ciBadge(run("passed"), NOW)).toMatchObject({ tone: "ok", text: "CI passed · 5 min ago", href: "https://example.test/run" });
    expect(ciBadge(run("failed"), NOW)).toMatchObject({ tone: "bad", text: "CI failed · 5 min ago" });
    expect(ciBadge(run("running"), NOW)).toMatchObject({ tone: "warn", text: "CI running · 5 min ago" });
    expect(ciBadge(run("passed"), NOW).tip).toContain("abcdef1");
  });
  it("says so while asking and when GitHub can't answer", () => {
    expect(ciBadge(undefined)).toMatchObject({ tone: "", text: "CI checking…" });
    expect(ciBadge(null)).toMatchObject({ tone: "", text: "CI unavailable" });
    expect(ciBadge(null).href).toBeUndefined();
  });
});
