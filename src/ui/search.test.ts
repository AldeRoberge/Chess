import { afterEach, describe, expect, it, vi } from "vitest";
import { AppSearch, domSearchEntries, matchSearch, type SearchHit } from "./search";
import { settingSearchEntries } from "./wizardSteps";
import { defaultSetup } from "../setup/config";

let search: AppSearch | undefined;
afterEach(() => { search?.destroy(); search = undefined; document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks(); });
const key = (target: EventTarget, key: string, extra = {}) => target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra }));
function make() {
  const target = document.createElement("div"); document.body.append(target);
  const reveal = vi.fn(() => target), ask = vi.fn();
  const hits: SearchHit[] = [{ id: "1", label: "Board corners", location: "Settings", text: "camera alignment", reveal }, { id: "2", label: "Board reader", location: "Workflow", text: "camera", reveal }];
  const entries = vi.fn(() => hits);
  search = new AppSearch({ entries, ask });
  const input = search.root.querySelector("input")!;
  return { search, input, target, entries, reveal, ask };
}

describe("app search", () => {
  it("opens from Ctrl+F while typing, debounces a local tour, and cleans up on Escape", () => {
    vi.useFakeTimers(); const { search, input, reveal, target, ask } = make();
    const typing = document.createElement("textarea"); document.body.append(typing); typing.focus();
    expect(key(typing, "f", { ctrlKey: true })).toBe(false);
    expect(search.root.hidden).toBe(false); expect(document.activeElement).toBe(input);
    input.value = "board"; input.dispatchEvent(new Event("input"));
    expect(reveal).not.toHaveBeenCalled(); vi.advanceTimersByTime(160);
    expect(reveal).toHaveBeenCalledOnce(); expect(target.classList.contains("search-match")).toBe(true);
    key(input, "ArrowDown"); expect(reveal).toHaveBeenCalledTimes(2);
    expect(ask).not.toHaveBeenCalled(); key(input, "Escape");
    expect(search.root.hidden).toBe(true); expect(target.classList.contains("search-match")).toBe(false);
    expect(document.activeElement).toBe(typing);
  });
  it("changes scopes explicitly and Enter sends the newest query once, even before debounce", () => {
    const { search, input, entries, ask } = make(); search.open();
    const scope = search.root.querySelector("select")!; scope.value = "everywhere"; scope.dispatchEvent(new Event("change"));
    expect(entries).toHaveBeenLastCalledWith("everywhere");
    input.value = "camera alignment"; key(input, "Enter");
    expect(ask).toHaveBeenCalledOnce(); expect(ask.mock.calls[0][0]).toBe("camera alignment");
    expect(ask.mock.calls[0][1]).toBe("everywhere"); expect(ask.mock.calls[0][2]).toHaveLength(1);
    expect(search.root.hidden).toBe(false);
  });
  it("does not submit composition Enter or let app shortcuts process search navigation", () => {
    const { search, input, ask } = make(); search.open(); input.value = "board";
    key(input, "Enter", { isComposing: true }); expect(ask).not.toHaveBeenCalled();
    const listener = vi.fn(); window.addEventListener("keydown", listener);
    key(input, "Delete"); expect(listener).not.toHaveBeenCalled(); window.removeEventListener("keydown", listener);
  });
  it("matches multiple terms without treating input as a regular expression", () => {
    const { entries } = make(); expect(matchSearch(entries(), "CAMERA board")).toHaveLength(2);
    expect(matchSearch(entries(), "[")).toHaveLength(0); expect(matchSearch(entries(), " ")).toHaveLength(0);
  });
  it("indexes closed details without leaking values and expands them without activating controls", () => {
    const root = document.createElement("div");
    root.innerHTML = '<details><summary>Advanced</summary><label>API key<input type="password" value="super-secret"></label><button>Reset</button></details>';
    document.body.append(root); const clicked = vi.fn(); root.querySelector("button")!.onclick = clicked;
    const entries = domSearchEntries(root, "Test");
    expect(matchSearch(entries, "super-secret")).toHaveLength(0);
    matchSearch(entries, "reset")[0].reveal(); expect(root.querySelector("details")!.open).toBe(true);
    expect(clicked).not.toHaveBeenCalled();
  });
  it("indexes nested settings without requests, configuration edits, or secret values", () => {
    const fetch = vi.spyOn(globalThis, "fetch"); const cfg = defaultSetup(); cfg.ai.apiKey = "secret-search-test";
    const before = JSON.stringify(cfg), entries = settingSearchEntries(cfg);
    expect(entries.some(e => e.label === "Across (x)" && e.path.length === 3)).toBe(true);
    expect(JSON.stringify(entries)).not.toContain("secret-search-test");
    expect(JSON.stringify(cfg)).toBe(before); expect(fetch).not.toHaveBeenCalled();
  });
});
