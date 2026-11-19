import { afterEach, describe, expect, it, vi } from "vitest";
import { installJoinBadge } from "./joinBadge";

afterEach(() => { document.body.innerHTML = ""; });

describe("join code badge", () => {
  it("keeps the code visible despite a previously saved hide preference and opens the Phone window", () => {
    const src = { available: null as boolean | null, code: "", urls: [] as string[], clients: 0 }, open = vi.fn();
    localStorage.setItem("chess.joinBadge.hidden", "1");
    const b = installJoinBadge(src, open);
    expect(b.el.hidden).toBe(true);
    Object.assign(src, { available: true, code: "4821", urls: ["https://alderoberge.com/chess/#/remote?code=4821"] }); b.update();
    expect(b.el.hidden).toBe(false); expect(b.el.querySelector(".jb-code")!.textContent).toBe("4821");
    expect(b.el.querySelector(".jb-url")!.textContent).toBe("alderoberge.com/chess/");
    expect(b.el.querySelector(".jb-qr svg path")!.getAttribute("d")!.length).toBeGreaterThan(100);
    (b.el.querySelector(".jb-main") as HTMLButtonElement).click(); expect(open).toHaveBeenCalled();
    b.update(); expect(b.el.hidden).toBe(false);
    expect(b.el.querySelector(".jb-x")).toBeNull();
    localStorage.removeItem("chess.joinBadge.hidden");
    b.stop();
  });
});
