/** Spoken setup guide. The Assistant page shows each line and speaks it; the person replies in the same box. */

export interface GuideLine { say: string }

/** Short lines, written to be spoken. One step at a time. */
export function guideLines(cameraCount: number): GuideLine[] {
  const cams = cameraCount > 0
    ? `You already have ${cameraCount} camera${cameraCount === 1 ? "" : "s"} listed.`
    : "No camera is listed yet.";
  return [
    { say: "I'll talk you through the setup. Everything I say shows here as well, so reply in this box. Say next for the next step, again to hear a step once more, or just ask a question." },
    { say: `${cams} Open Setup, then Cameras, and switch on the webcam that can see the board. A high angle is the easiest. Say next when that picture is live.` },
    { say: "Open the Board step. Drag the four green handles onto the corners of the board, in this order: a8, h8, h1, a1. The outline should sit on the edge of the board, not on the table around it. Say next when it matches." },
    { say: "Set the pieces in the start position and press Learn now. You should see rings on the pieces, and the words start position assumed. Then move one piece. Its old square should fade and the new square should light up. Tell me here if a piece stays where it was." },
    { say: "That's the alignment. I'll keep using the ElevenLabs voice from Setup when that engine is turned on. Reply here whenever a camera or a piece looks wrong." },
  ];
}

export type GuideAct = "next" | "back" | "repeat" | "ask";

/** What a short reply means while the guide is running. Anything else is a real question. */
export function guideReply(text: string): GuideAct {
  const t = text.trim().toLowerCase().replace(/[.!?]+$/g, "");
  if (/^(next|done|ok|okay|yes|yep|yeah|ready|continue|go|got it|sounds good)$/.test(t)) return "next";
  if (/^(back|previous)$/.test(t)) return "back";
  if (/^(again|repeat|say that again|what)$/.test(t)) return "repeat";
  return "ask";
}

/** The chip and a few phrasings that start the guide instead of going to the model. */
export function isGuideStart(text: string): boolean {
  return /talk me through|set the game up from scratch|set up the cameras|align the cameras/i.test(text);
}

/** Markdown is for the page. Speech gets the words only. */
export function plainSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
