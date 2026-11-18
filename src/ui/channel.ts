import type { TrackResult } from "../chess/tracker";
import type { DirectorOut } from "../experience/director";
import type { SceneState } from "../scene/types";
import type { ClockOverlay } from "../world/clockOverlay";

export type OutMsg =
  | { type: "state"; scene: SceneState; overlay: { game: Pick<TrackResult, "last" | "lifted" | "diff" | "status"> | null; director: DirectorOut | null; hint: { from: string; to: string } | null; clock?: ClockOverlay | null } }
  | { type: "calib"; cmd: { kind: "black" } | { kind: "white" } | { kind: "dot"; x: number; y: number } | { kind: "end" } }
  | { type: "mapping" };
export type InMsg = { type: "size"; index: number; w: number; h: number };

export const openChannel = () => new BroadcastChannel("chess-experience");
