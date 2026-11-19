import { describe, expect, it } from "vitest";
import { guideLines, guideReply, isGuideStart, plainSpeech } from "./guide";

describe("spoken setup guide", () => {
  it("walks cameras, corners, then the start position, and mentions how many cameras exist", () => {
    const lines = guideLines(0).map((l) => l.say);
    expect(lines[0]).toMatch(/reply in this box/i);
    expect(lines[1]).toMatch(/No camera/);
    expect(lines[2]).toMatch(/a8, h8, h1, a1/);
    expect(lines[3]).toMatch(/Learn now/);
    expect(guideLines(2)[1].say).toMatch(/2 cameras/);
  });
  it("treats a short acknowledgement as next, and a real question as a question", () => {
    expect(guideReply("next")).toBe("next");
    expect(guideReply("Got it.")).toBe("next");
    expect(guideReply("back")).toBe("back");
    expect(guideReply("again")).toBe("repeat");
    expect(guideReply("the king didn't move")).toBe("ask");
  });
  it("recognises a request to start the guide", () => {
    expect(isGuideStart("Talk me through the cameras")).toBe(true);
    expect(isGuideStart("why is camera B dark?")).toBe(false);
  });
  it("strips markdown before speaking", () => {
    expect(plainSpeech("Drag **a8**, then `h8`.\n\n- done")).toBe("Drag a8, then h8. - done");
  });
});
