/** A board moment the effects react to: where it happened, how big it was. Produced by the trigger node. */
export interface FxCue {
  id: number;
  /** What happened: capture | move | check | mate | castle | promotion | test. */
  kind: string;
  /** Board position in squares (0..8, square centre = +0.5); column from the a-file, row from rank 8. */
  col: number;
  row: number;
  /** Moving and captured piece letters (p n b r q k), "" when none. */
  piece: string;
  captured: string;
  /** Material swing: captured value minus the mover's value (can be 0 or negative). */
  gap: number;
  /** 0..1 how dramatic this was. Effects scale size, brightness and sound pitch with it. */
  strength: number;
  /** Which side moved. */
  side: "w" | "b";
}

export type FxRGB = [number, number, number];

/** One effect or sound request travelling down the wires: a cue plus how to play it. */
export interface FxCall {
  kind: "visual" | "sound";
  /** Effect or sound id (see EFFECTS / SOUNDS). */
  id: string;
  cue: FxCue;
  /** Seconds to wait before it starts. */
  delay: number;
  /** Visual: color, reach in squares, intensity, speed, count. Sound: volume, pitch in semitones. */
  opts: Record<string, number | string>;
}

export const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export const PALETTE: Record<string, FxRGB> = {
  cyan: [60, 220, 255], magenta: [255, 70, 220], gold: [255, 200, 70], emerald: [70, 255, 160], ice: [190, 230, 255],
  ember: [255, 110, 50], rose: [255, 100, 140], violet: [160, 110, 255], white: [255, 255, 255],
};
export const COLOR_NAMES = ["auto", ...Object.keys(PALETTE)];

/** The color of the captured piece when a node says "auto": bigger prizes get hotter colors. */
const AUTO: Record<string, string> = { p: "ice", n: "emerald", b: "cyan", r: "violet", q: "gold", k: "ember" };
export function resolveColor(name: string, cue: FxCue): FxRGB {
  if (PALETTE[name]) return PALETTE[name];
  return PALETTE[AUTO[cue.captured] ?? AUTO[cue.piece] ?? "cyan"];
}
