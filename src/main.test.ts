import { afterEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ boot: vi.fn(), start: vi.fn(), output: vi.fn() }));
vi.mock("./app", () => ({ boot: (el: HTMLElement) => { calls.boot(el); return { start: calls.start }; } }));
vi.mock("./outputPage", () => ({ startOutputPage: calls.output }));

afterEach(() => { vi.resetModules(); vi.clearAllMocks(); history.replaceState({}, "", "/"); document.body.innerHTML = ""; });

describe("entry point", () => {
  it("boots the app into #app and starts it when no output is requested", async () => {
    document.body.innerHTML = '<div id="app"></div>'; await import("./main");
    expect(calls.boot).toHaveBeenCalledWith(document.getElementById("app")); expect(calls.start).toHaveBeenCalled(); expect(calls.output).not.toHaveBeenCalled();
  });
  it("starts a projector page for ?output=N (bad numbers mean projector 0)", async () => {
    history.replaceState({}, "", "/?output=2"); await import("./main"); expect(calls.output).toHaveBeenCalledWith(2); expect(calls.boot).not.toHaveBeenCalled();
    vi.resetModules(); history.replaceState({}, "", "/?output=abc"); await import("./main"); expect(calls.output).toHaveBeenLastCalledWith(0);
  });
});
