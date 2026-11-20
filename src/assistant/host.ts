import type { GraphJSON, Registry } from "../core/types";
import type { SetupConfig } from "../setup/config";
import type { Route } from "../ui/route";

/** What the assistant may read and change in the running app. app.ts implements it; tests fake it. */
export interface AssistantHost {
  registry: Registry;
  graph(): GraphJSON;
  /** The saved setup, or null before the first one. */
  setup(): SetupConfig | null;
  /** Save a new setup and rebuild the workflow from it. Undoable. */
  applySetup(cfg: SetupConfig, why: string): void;
  /** Replace the whole workflow. The app backs up what there was and makes it undoable. */
  applyGraph(g: GraphJSON, why: string): void;
  /** Incremental, undoable edit. Existing nodes keep camera/game runtime state. */
  editGraph?(g: GraphJSON): void;
  /** Rendered UI semantics, never password values or assistant conversation text. */
  ui?(): import("./uiContext").UIContext;
  /** Focus an existing node in the editor. */
  revealNode?(id: string): void;
  /** Explicitly supported application commands, not arbitrary DOM clicks. */
  appAction?(action: string): void;
  /** Set one node parameter (already validated). Returns false when the node does not exist. */
  setParam(nodeId: string, key: string, value: string | number | boolean): boolean;
  setBypass(nodeId: string, on: boolean): boolean;
  selection(): string[];
  /** Errors the nodes reported on their last tick. */
  nodeErrors(): { node: string; type: string; message: string; hint?: string }[];
  route(): Route;
  go(r: Route): void;
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  /** The virtual table: used when playing without cameras. */
  table: { fen(): string; legal(): string[]; reset(): void; seat(on: boolean): void; seated(): boolean; play(move: string): boolean };
  sound(): { on: boolean; muted: boolean };
  /** The app clock in ms (the same one event times use). */
  now(): number;
}

/** Setting names that hold secrets. Never shown to the model, never set by it. */
export const SECRET = /key|token|secret|password/i;
/** The setup with every secret blanked, as the model is allowed to see it. */
export function redact<T>(v: T): T {
  if (Array.isArray(v)) return v.map(redact) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET.test(k) ? (x ? "(set)" : "(empty)") : redact(x)])) as T;
  return v;
}
