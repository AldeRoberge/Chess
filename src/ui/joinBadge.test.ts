import { afterEach, describe, expect, it, vi } from "vitest";
import { HIDE_KEY, installJoinBadge } from "./joinBadge";

const store = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
afterEach(() => { document.body.innerHTML = ""; });

describe("join code badge", () => {
  it("shows the code and address once the relay answers, opens the Phone window, and stays hidden after ×", () => {
    const src = { available: null as boolean | null, code: "", urls: [] as string[], clients: 0 }, open = vi.fn(), s = store();
    const b = installJoinBadge(src, open, s);
    expect(b.el.hidden).toBe(true);
    Object.assign(src, { available: true, code: "4821", urls: ["https://alderoberge.com/chess/#/remote?code=4821"] }); b.update();
    expect(b.el.hidden).toBe(false); expect(b.el.querySelector(".jb-code")!.textContent).toBe("4821");
    expect(b.el.querySelector(".jb-url")!.textContent).toBe("alderoberge.com/chess/");
    (b.el.querySelector(".jb-main") as HTMLButtonElement).click(); expect(open).toHaveBeenCalled();
    (b.el.querySelector(".jb-x") as HTMLButtonElement).click(); b.update(); expect(b.el.hidden).toBe(true); expect(s.getItem(HIDE_KEY)).toBe("1");
    b.stop();
  });
});
