import type { TrackResult } from "../chess/tracker";
import type { DirectorOut } from "../experience/director";
import type { SceneState } from "../scene/types";
import type { FxCall } from "../fx/types";
import type { ClockOverlay } from "../world/clockOverlay";
import type { PieceOverlay } from "../world/pieceOverlay";

/** What an output window should show instead of the scene. `head` is that projector's index; omit it to address every head. */
export type CalibCmd =
  | { kind: "black"; head?: number }
  | { kind: "white"; head?: number }
  | { kind: "grid"; head?: number }
  | { kind: "dot"; x: number; y: number; head?: number }
  | { kind: "end"; head?: number };

export type OutMsg =
  | { type: "state"; scene: SceneState; overlay: { game: Pick<TrackResult, "last" | "lifted" | "diff" | "status"> | null; director: DirectorOut | null; hint: { from: string; to: string } | null; clock?: ClockOverlay | null; pieces?: PieceOverlay | null }; fx?: FxCall[] }
  | { type: "calib"; cmd: CalibCmd }
  | { type: "mapping" };
export type InMsg = { type: "size"; index: number; w: number; h: number };

export const openChannel = () => new BroadcastChannel("chess-experience");
