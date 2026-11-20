import { afterEach, describe, expect, it } from "vitest";
import { installJoinBadge } from "./joinBadge";

afterEach(() => { document.body.innerHTML = ""; });

describe("join code chip", () => {
  it("shows a QR and the code in the top bar, and opens a centred popup on click", () => {
    const bar = document.createElement("div"); document.body.append(bar);
    const src = { available: null as boolean | null, code: "", urls: [] as string[], clients: 0 };
    const b = installJoinBadge(src, bar);
    expect(b.el.hidden).toBe(true); expect(bar.contains(b.el)).toBe(true);
    Object.assign(src, { available: true, code: "4821", urls: ["https://alderoberge.com/chess/#/remote?code=4821"] }); b.update();
    expect(b.el.hidden).toBe(false); expect(b.el.querySelector(".jb-code")!.textContent).toBe("4821");
    expect(b.el.querySelector(".jb-qr svg path")!.getAttribute("d")!.length).toBeGreaterThan(100);
    expect(b.modal.hidden).toBe(true);
    b.el.click();
    expect(b.modal.hidden).toBe(false);
    expect(b.modal.querySelector(".jb-bigcode")!.textContent).toBe("4821");
    expect(b.modal.querySelector(".jb-url")!.textContent).toBe("alderoberge.com/chess/");
    expect(b.modal.querySelector(".jb-bigqr svg")).not.toBeNull();
    dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); expect(b.modal.hidden).toBe(true);
    b.el.click(); (b.modal.querySelector(".jb-close") as HTMLButtonElement).click(); expect(b.modal.hidden).toBe(true);
    b.stop();
  });
  it("finds a mount point that appears later and hides when the phone relay is unavailable", () => {
    let host: HTMLElement | null = null;
    const src = { available: true as boolean | null, code: "1234", urls: [] as string[], clients: 2 };
    const b = installJoinBadge(src, () => host);
    expect(b.el.isConnected).toBe(false);
    host = document.createElement("div"); document.body.append(host); b.update();
    expect(host.contains(b.el)).toBe(true); expect(b.el.hidden).toBe(false);
    b.open(); expect(b.modal.querySelector(".jb-status")!.textContent).toContain("2 phones are connected");
    src.available = false; b.update(); expect(b.el.hidden).toBe(true); expect(b.modal.hidden).toBe(true);
    b.stop();
  });
});
