/** Port data types. Ports only connect when types match (or either side is "any"). */
export type PortType =
  | "frame" // GrayFrame
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
  | "any";

export interface PortDef {
  id: string;
  type: PortType;
  label?: string;
}

export type ParamDef =
  | { id: string; kind: "number"; label: string; min: number; max: number; step?: number; value: number }
  | { id: string; kind: "bool"; label: string; value: boolean }
  | { id: string; kind: "select"; label: string; options: string[]; value: string }
  /** `quad` marks a "x,y;x,y;x,y;x,y" camera-pixel value that gets a drag-the-corners editor (needs the node's `frameOf`). */
  | { id: string; kind: "text"; label: string; value: string; quad?: { names: string[]; grid: number } };

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

export interface NodeSpec<S = any> {
  type: string;
  title: string;
  /** One or two plain sentences shown in the node tooltip. */
  desc?: string;
  category: "Source" | "Vision" | "Game" | "Narration" | "Scene" | "Output" | "Tracking" | "Experience";
  inputs: PortDef[];
  outputs: PortDef[];
  params?: ParamDef[];
  init?(): S;
  process(inputs: Record<string, any>, rt: NodeRuntime<S>): Record<string, any> | void;
  dispose?(state: S): void;
  /** Optional live preview painter (UI only). */
  preview?(ctx: CanvasRenderingContext2D, w: number, h: number, state: S, outputs: Record<string, any>): void;
  previewSize?: [number, number];
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
