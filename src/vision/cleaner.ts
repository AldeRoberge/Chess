import { averageFrames, enhance, noEnhance, resample } from "./enhance";
import type { GrayFrame } from "./types";

export interface CleanOptions {
  /** analysis size the board reader samples (480×360) */
  width: number; height: number;
  /** frames of a still board averaged together (1 = off) */
  keep: number;
  /** median denoise on/off */
  clean: boolean;
  /** the board was changing on the last read: drop the frames averaged so far so motion is never smeared in */
  reset: boolean;
}
export interface Cleaned { analysis: GrayFrame; cleaned: GrayFrame }

/**
 * One camera's picture clean-up: area-average down to the analysis size, the mean of the last few
 * frames of a still board, then a median filter (benchmarked: far fewer phantom and missed pieces
 * than reading raw frames). Runs inline, or inside the clean-up worker so the main thread stays free.
 */
export class FrameCleaner {
  recent: GrayFrame[] = [];
  run(frame: GrayFrame, o: CleanOptions): Cleaned {
    const analysis = resample(frame, o.width, o.height);
    const keep = Math.max(1, Math.round(o.keep || 1));
    if (o.reset) this.recent = [];
    this.recent.push(analysis);
    if (this.recent.length > keep) this.recent.splice(0, this.recent.length - keep);
    const mean = this.recent.length > 1 ? averageFrames(this.recent) : analysis;
    return { analysis, cleaned: enhance(mean, { ...noEnhance(), denoise: o.clean ? "median" : "none" }) };
  }
}
