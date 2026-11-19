import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ mount: vi.fn(), desktop: vi.fn() }));
vi.mock("./app", () => { mocks.desktop(); throw new Error("Desktop must not load on the phone"); });
vi.mock("./remote/client", () => ({ mountRemote: mocks.mount }));
vi.mock("./ui/appTheme", () => ({ applyAppTheme: vi.fn(), onAppTheme: vi.fn(), watchSystemScheme: vi.fn() }));
vi.mock("./ui/brandIcon", () => ({ syncFavicon: vi.fn() }));
vi.mock("./ui/uiScale", () => ({ installUiScale: vi.fn() }));

afterEach(() => { history.replaceState({}, "", "/"); vi.clearAllMocks(); vi.resetModules(); });

it("opens a phone link without loading the desktop app", async () => {
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState({}, "", "/#/remote?code=4321");
  await import("./main");
  await vi.waitFor(() => expect(mocks.mount).toHaveBeenCalledWith(document.getElementById("app")));
  expect(mocks.desktop).not.toHaveBeenCalled();
});

it("shows a retry button if the phone page cannot load", async () => {
  mocks.mount.mockImplementationOnce(() => { throw new Error("Phone startup failed"); });
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  document.body.innerHTML = '<div id="app"></div>';
  history.replaceState({}, "", "/#/remote?code=4321");
  try {
    await import("./main");
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain("Phone startup failed"));
    expect(document.querySelector("button")?.textContent).toBe("Try again");
  } finally { log.mockRestore(); }
});
