import { afterEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ boot: vi.fn(), start: vi.fn(), output: vi.fn(), remote: vi.fn() }));
vi.mock("./app", () => ({ boot: (el: HTMLElement) => { calls.boot(el); return { start: calls.start }; } }));
vi.mock("./outputPage", () => ({ startOutputPage: calls.output }));
vi.mock("./remote/client", () => ({ mountRemote: calls.remote }));
const phone = vi.hoisted(() => ({ on: false, land: vi.fn() }));
vi.mock("./remote/landing", () => ({ wantsJoinScreen: () => phone.on, mountJoinLanding: (el: HTMLElement, d: unknown) => phone.land(el, d) }));

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

describe("phone page", () => {
  it("shows the phone remote instead of the app for #/remote", async () => {
    document.body.innerHTML = '<div id="app"></div>'; history.replaceState({}, "", "/#/remote?code=1234"); await import("./main"); await new Promise((r) => setTimeout(r, 10));
    expect(calls.remote).toHaveBeenCalledWith(document.getElementById("app")); expect(calls.boot).not.toHaveBeenCalled();
  });
  it("asks phones for the join code at the site root, then joins or opens the full app", async () => {
    phone.on = true; document.body.innerHTML = '<div id="app"></div>'; await import("./main");
    expect(phone.land).toHaveBeenCalled(); expect(calls.boot).not.toHaveBeenCalled();
    const d = phone.land.mock.calls[0][1] as { onJoin: (c: string) => void; onApp: () => void };
    d.onJoin("4321"); await new Promise((r) => setTimeout(r, 10));
    expect(location.hash).toBe("#/remote?code=4321"); expect(calls.remote).toHaveBeenCalled();
    d.onApp(); expect(calls.boot).toHaveBeenCalled(); phone.on = false;
  });
});
