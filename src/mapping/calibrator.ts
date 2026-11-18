import type { GrayFrame, Pt } from "../vision/types";
import { calibrate, detectDot, dotGrid, quadFromLit, type CalibrationResult } from "./autocal";

export interface CalibIO {
  /** Make the projector show: black, full white, or a single dot at projector pixel (x,y). */
  show(cmd: { kind: "black" } | { kind: "white" } | { kind: "dot"; x: number; y: number }): void;
  /** Wait for the projector + camera to settle, then return the newest camera frame. */
  grab(): Promise<GrayFrame | null>;
}

export interface CalibrationOutput {
  result: CalibrationResult | null;
  /** The projector's lit footprint in camera pixels (table / wall extent), TL,TR,BR,BL. */
  footprint: Pt[] | null;
  hits: number;
  missed: number;
}

/**
 * Structured-light auto-calibration with a webcam: black reference, white frame (footprint = the
 * surface the projector actually reaches), then one dot at a time. Dots that aren't seen are skipped
 * and outliers are dropped by `calibrate`, so a partially occluded table still solves.
 */
export async function runCalibration(io: CalibIO, proj: { w: number; h: number }, onProgress: (p: number) => void = () => {}): Promise<CalibrationOutput> {
  io.show({ kind: "black" });
  const dark = await io.grab();
  if (!dark) return { result: null, footprint: null, hits: 0, missed: 0 };
  io.show({ kind: "white" });
  const white = await io.grab();
  const footprint = white ? quadFromLit(dark, white) : null;
  const dots = dotGrid(proj.w, proj.h);
  const hits: { proj: Pt; cam: Pt }[] = [];
  let missed = 0;
  for (let i = 0; i < dots.length; i++) {
    io.show({ kind: "dot", x: dots[i].x, y: dots[i].y });
    const f = await io.grab();
    const d = f && detectDot(dark, f);
    if (d) hits.push({ proj: dots[i], cam: d.pt }); else missed++;
    onProgress((i + 1) / dots.length);
  }
  io.show({ kind: "black" });
  if (hits.length < 6) return { result: null, footprint, hits: hits.length, missed };
  return { result: calibrate(hits), footprint, hits: hits.length, missed };
}
