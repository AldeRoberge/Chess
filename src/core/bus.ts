import type { TrackResult } from "../chess/tracker";
import type { NarrationLine } from "../narrator/narrator";
import type { DirectorOut } from "../experience/director";
import type { SceneState } from "../scene/types";
import type { BoardBelief } from "../vision/types";
import type { ClockEstimate } from "../clock/types";
import type { ExperienceEvent } from "./events";
import type { PieceOverlay as PieceView } from "../world/pieceOverlay";
import type { FxCall } from "../fx/types";
import type { CalibrationView } from "../vision/autoCalibrate";

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
  /** Squares the commentary is explaining right now ("this is known as a fork …"), lit on the board until `until` (ms). */
  insight: null as { squares: string[]; label: string; until: number } | null,
  /** Which colour the bot plays while a game against it runs (drives where its body sits); null otherwise. */
  botColor: null as "w" | "b" | null,
  /** The human put a piece where the online bot did not play it: the bot's move and the wrong square, until it is put right. */
  reconcile: null as { from: string; to: string; wrong: string } | null,
  /** Draw a light outline around the board (the human-versus-online-bot demo). */
  outline: false,
  clock: null as ClockEstimate | null,
  /** What the projector should show of the clock; set by the Clock Overlay node. */
  clockView: null as ClockView | null,
  /** What the projector should show as pieces; set by the Pieces Projection node (null = physical pieces). */
  pieceView: null as PieceView | null,
  cameras: [] as { id: string; online: boolean; quality: number; reliability: number }[],
  /** Board effects started since the last post to the projector windows (drained by the app loop). */
  fxSpawns: [] as FxCall[],
  /** Set from the top-bar Pause button: holds the scenario player between moves without resetting it. */
  scenarioPaused: false,
  /** A deduplicated calibration suggestion or explicitly approved search in the top menu. */
  calibration: null as CalibrationView | null,
  /** Dismiss stops the search and suppresses suggestions until sustained recovery. */
  calibrationDismiss: false,
  /** Explicit approval from the top-menu suggestion. */
  calibrationAccept: false,
  /** The Board Reader's "Split" button: the app loop replaces every Board Reader with the detector nodes. */
  splitReaders: false,
};

export function pushLog<T>(arr: T[], items: T[], max = 60) {
  arr.push(...items);
  if (arr.length > max) arr.splice(0, arr.length - max);
}
