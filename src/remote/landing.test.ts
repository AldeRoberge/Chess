import { afterEach, describe, expect, it, vi } from "vitest";
import { mountJoinLanding, SKIP_KEY, wantsJoinScreen } from "./landing";

const store = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
const win = (coarse: boolean, w: number, h: number) => ({ matchMedia: () => ({ matches: coarse }), screen: { width: w, height: h }, innerWidth: w, innerHeight: h }) as unknown as Window;
afterEach(() => { document.body.innerHTML = ""; document.body.className = ""; });

describe("phone front door", () => {
  it("shows only on phone-sized touch screens, in either orientation, until skipped", () => {
    const s = store();
    expect(wantsJoinScreen(win(true, 390, 844), s)).toBe(true);
    expect(wantsJoinScreen(win(true, 844, 390), s)).toBe(true);
    expect(wantsJoinScreen(win(true, 1024, 1366), s)).toBe(false);
    expect(wantsJoinScreen(win(false, 390, 844), s)).toBe(false);
    s.setItem(SKIP_KEY, "1"); expect(wantsJoinScreen(win(true, 390, 844), s)).toBe(false);
  });
  it("waits for Join so six-digit production codes are not cut off after four digits", () => {
    const onJoin = vi.fn(), root = document.createElement("div"); document.body.append(root);
    const { input } = mountJoinLanding(root, { onJoin, onApp: vi.fn(), store: store() });
    input.value = "12a3"; input.dispatchEvent(new Event("input")); expect(input.value).toBe("123"); expect(onJoin).not.toHaveBeenCalled();
    input.value = "1234"; input.dispatchEvent(new Event("input")); expect(onJoin).not.toHaveBeenCalled();
    input.value = "123456"; input.dispatchEvent(new Event("input"));
    root.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(onJoin).toHaveBeenCalledWith("123456");
    expect(root.querySelector(".rm-land")).toBeNull();
  });
  it("asks again on an empty Join, and remembers 'always open the app' only when ticked", () => {
    const onJoin = vi.fn(), onApp = vi.fn(), s = store(), root = document.createElement("div"); document.body.append(root);
    mountJoinLanding(root, { onJoin, onApp, store: s });
    root.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(onJoin).not.toHaveBeenCalled(); expect(root.querySelector(".rm-err")!.textContent).toMatch(/code/);
    (root.querySelector(".rm-land-keep input") as HTMLInputElement).checked = true;
    (root.querySelector(".rm-land-app") as HTMLButtonElement).click();
    expect(onApp).toHaveBeenCalled(); expect(s.getItem(SKIP_KEY)).toBe("1");
  });
});
