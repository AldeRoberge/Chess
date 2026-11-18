import type { TrackResult } from "../chess/tracker";
import type { NarrationLine } from "../narrator/narrator";
import type { DirectorOut } from "../experience/director";
import type { SceneState } from "../scene/types";
import type { BoardBelief } from "../vision/types";
import type { ClockEstimate } from "../clock/types";
import type { ExperienceEvent } from "./events";

export interface ClockView { mode: "digits" | "circle" | "square"; showCert: boolean; clock: ClockEstimate }
export interface PoseData { id: string; joints: ([number, number, number] | null)[]; seat?: string }

/** Latest values published by sink nodes for the side panels (3D view, projector output, log). */
export const bus = {
  board: null as BoardBelief | null,
  game: null as TrackResult | null,
  director: null as DirectorOut | null,
  scene: null as SceneState | null,
  poses: [] as PoseData[],
  lines: [] as NarrationLine[],
  events: [] as ExperienceEvent[],
  engineHint: null as { from: string; to: string } | null,
  clock: null as ClockEstimate | null,
  /** What the projector should show of the clock; set by the Clock Overlay node. */
  clockView: null as ClockView | null,
  cameras: [] as { id: string; online: boolean; quality: number; reliability: number }[],
};

export function pushLog<T>(arr: T[], items: T[], max = 60) {
  arr.push(...items);
  if (arr.length > max) arr.splice(0, arr.length - max);
}
