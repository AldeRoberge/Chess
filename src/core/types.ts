import type { TipPreview, TipRow } from "../ui/tooltip";
/** Port data types. Ports only connect when types match (or either side is "any"). */
export type PortType =
  | "frame" // GrayFrame
  | "flat" // FlatBoard (the board cut out of the camera picture and straightened)
  | "reading" // Reading (one detector's piece / no piece / colour opinion of the 64 squares)
  | "obs" // SquareObs (one camera's reading of the board)
  | "board" // BoardBelief (fused / stabilised 64 squares)
  | "game" // GameState (validated position + last move + fidelity)
  | "pointer" // PointerSample[] (hands on the table, table coords)
  | "pose" // PoseData[]
  | "seat" // Seat[]
  | "event" // ExperienceEvent[]
  | "text" // NarrationLine[]
  | "scene" // SceneState
  | "clock" // ClockEstimate (time left per side, with certainty)
  | "world" // the virtual table the cameras look at (VirtualTable)
  | "player" // an AI player seated at the world
  | "action" // TableAction[]: what the scenario asks the players to do
  | "fx" // board effect cues and calls (FxCue[] / FxCall[])
  | "any";

export interface PortDef {
  id: string;
  type: PortType;
  label?: string;
}

/** A model a select can offer, with its price per 1M tokens in USD when known. */
export interface ModelInfo { id: string; input?: number; output?: number }

export type ParamDef =
  /** `group` is the id of an `optional` bool this number belongs to: it only shows inside that item's card while the item is added. */
  | { id: string; kind: "number"; label: string; min: number; max: number; step?: number; value: number; group?: string }
  /** `action` marks a one-shot trigger: it shows as a button, and the node resets the param to false after running. */
  /** `optional` makes the bool a list item: hidden until picked from the "Add…" dropdown (which sets it true), removable with ✕ (sets it false). */
  | { id: string; kind: "bool"; label: string; value: boolean; action?: true; optional?: true }
  /** `labels`, when given, is the display text for each option (same order); the stored value stays `options[i]`. */
  /** `icons`, when given, is a piece code per option (e.g. "bq") drawn beside the select. */
  /** `pick`, when given, adds a "Compare" button that opens a cost chart of `models()`; choosing a bar sets this param. */
  | { id: string; kind: "select"; label: string; options: string[]; labels?: string[]; icons?: string[]; value: string; pick?: { title: string; models: () => ModelInfo[] } }
  /** `quad` marks a "x,y;x,y;x,y;x,y" camera-pixel value that gets a drag-the-corners editor (needs the node's `frameOf`). */
  /** `secret` draws a password field (API keys): masked, and left out of autocomplete. */
  | { id: string; kind: "text"; label: string; value: string; secret?: boolean; quad?: { names: string[]; grid: number } }
  /** A non-editable heading row that groups the params below it. `value` is unused (kept so defaults stay uniform). */
  | { id: string; kind: "separator"; label: string; value: string };

export type ParamValues = Record<string, number | boolean | string>;

export interface NodeRuntime<S = any> {
  /** Seconds since last tick. */
  dt: number;
  /** Monotonic ms. */
  now: number;
  params: ParamValues;
  state: S;
  /** Report a 0..1 quality figure shown on the node header. */
  setFidelity(v: number | null): void;
  /** Post-processing hook for the UI preview canvas. */
  emit(event: string, payload?: unknown): void;
  /** Time a block as a named sub-span in the Performance flamegraph. Just runs `fn` when not profiling. */
  span<T>(name: string, fn: () => T): T;
}

/** What is under the pointer on a node preview: shown in the hover card, and `mark` paints the highlight onto the preview itself. */
export interface HoverInfo {
  title: string; tag?: string; color?: string; body?: string;
  rows?: TipRow[]; preview?: TipPreview | null;
  /** Draws in the preview's own logical coordinates (same as `preview`), after the normal painting. */
  mark?(ctx: CanvasRenderingContext2D): void;
}

export interface NodeSpec<S = any> {
  type: string;
  title: string;
  /** One or two plain sentences shown in the node tooltip. */
  desc?: string;
  category: "Source" | "Vision" | "Game" | "Narration" | "Scene" | "Output" | "Tracking" | "Experience" | "Effects";
  inputs: PortDef[];
  outputs: PortDef[];
  params?: ParamDef[];
  init?(): S;
  process(inputs: Record<string, any>, rt: NodeRuntime<S>): Record<string, any> | void;
  dispose?(state: S): void;
  /** Optional live preview painter (UI only). */
  preview?(ctx: CanvasRenderingContext2D, w: number, h: number, state: S, outputs: Record<string, any>): void;
  previewSize?: [number, number];
  /** Describes whatever is at `p` (preview logical coordinates, `w`×`h` canvas); null = nothing there. */
  hover?(p: { x: number; y: number }, w: number, h: number, state: S, outputs: Record<string, any>): HoverInfo | null;
  /** The camera picture the corner editor draws on. */
  frameOf?(state: S): { width: number; height: number; data: Uint8ClampedArray; t: number } | null;
}

export interface Plugin {
  id: string;
  name: string;
  register(reg: Registry): void;
}

export class Registry {
  private specs = new Map<string, NodeSpec>();
  private plugins: Plugin[] = [];
  register(spec: NodeSpec) {
    this.specs.set(spec.type, spec);
  }
  use(plugin: Plugin) {
    this.plugins.push(plugin);
    plugin.register(this);
    return this;
  }
  get(type: string) {
    return this.specs.get(type);
  }
  all() {
    return [...this.specs.values()];
  }
  pluginList() {
    return this.plugins.map((p) => ({ id: p.id, name: p.name }));
  }
}

export interface NodeInstance {
  id: string;
  type: string;
  x: number;
  y: number;
  params: ParamValues;
  bypass?: boolean;
  /** User-chosen size in graph px; absent = default width, height follows content. */
  w?: number;
  h?: number;
}
export interface Edge {
  id: string;
  from: { node: string; port: string };
  to: { node: string; port: string };
}
/** A titled, coloured frame drawn behind nodes to group them (demo, analysis, output...). Purely visual. */
export interface GroupDef { id: string; title: string; color: string; x: number; y: number; w: number; h: number }
export interface GraphJSON {
  nodes: NodeInstance[];
  edges: Edge[];
  groups?: GroupDef[];
}

export function portsCompatible(a: PortType, b: PortType) {
  return a === b || a === "any" || b === "any";
}
