import { afterEach, describe, expect, it, vi } from "vitest";
import { bindDialogUrl, dialogOpened } from "./dialogUrl";
import type { Dialog } from "./route";

describe("dialogUrl", () => {
  afterEach(() => { bindDialogUrl(() => {}); });

  it("writes the open popup into the URL and clears it when it closes", () => {
    const write = vi.fn();
    bindDialogUrl(write);
    const close = dialogOpened("settings" as Dialog);
    expect(write).toHaveBeenLastCalledWith("settings");
    close();
    expect(write).toHaveBeenLastCalledWith(null);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("does not clear a newer popup when an older one closes late", () => {
    const write = vi.fn();
    bindDialogUrl(write);
    const closeA = dialogOpened("a" as Dialog);
    const closeB = dialogOpened("b" as Dialog);
    closeA();
    expect(write).not.toHaveBeenCalledWith(null);
    expect(write).toHaveBeenLastCalledWith("b");
    closeB();
    expect(write).toHaveBeenLastCalledWith(null);
  });

  it("works with no writer bound", () => {
    bindDialogUrl(undefined as unknown as () => void);
    expect(() => dialogOpened("x" as Dialog)()).not.toThrow();
  });
});
