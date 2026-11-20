import type { Graph } from "../core/graph";
import type { GraphJSON, Registry } from "../core/types";
import type { SetupConfig } from "../setup/config";
import type { Route } from "../ui/route";
import type { AssistantHost } from "./host";
import { readUI } from "./uiContext";

/** The pieces of the running app the assistant is allowed to reach. app.ts supplies them; a test can supply fakes. */
export interface AppHostDeps {
  registry: Registry;
  graph: Graph;
  loadSetup(): SetupConfig | null;
  /** Back up, save the setup, rebuild the workflow from it, and record an undo step. */
  applySetup(cfg: SetupConfig, why: string): void;
  /** Replace the workflow (backed up and undoable). */
  applyGraph(g: GraphJSON, why: string): void;
  refreshGraph?(): void;
  revealNode?(id: string): void;
  appAction?(action: string): void;
  /** Include detached panel roots so controls are searchable while a different tab is active. */
  uiRoots?(): ParentNode[];
  /** Called after a parameter changed so it is saved and undoable. */
  persist(): void;
  toggleBypass(id: string): void;
  selection(): string[];
  route(): Route;
  go(r: Route): void;
  history: { canUndo: boolean; canRedo: boolean };
  undo(): void;
  redo(): void;
  table: AssistantHost["table"];
  sound(): AssistantHost["sound"] extends () => infer R ? R : never;
  now(): number;
}

/** Adapts the app to what the assistant needs. All the logic worth testing (which node, what counts as an error, what undo reports) lives here. */
export function createAppHost(d: AppHostDeps): AssistantHost {
  return {
    registry: d.registry,
    graph: () => d.graph.toJSON(),
    setup: d.loadSetup,
    applySetup: d.applySetup,
    applyGraph: d.applyGraph,
    editGraph: (g) => { d.graph.restore(g); d.refreshGraph?.(); d.persist(); },
    ui: () => readUI(document, d.uiRoots?.()),
    revealNode: d.revealNode,
    appAction: d.appAction,
    setParam: (id, key, value) => { const n = d.graph.nodes.get(id); if (!n) return false; n.params[key] = value; d.persist(); return true; },
    setBypass: (id, on) => { const n = d.graph.nodes.get(id); if (!n) return false; if (!!n.bypass !== on) d.toggleBypass(id); return true; },
    selection: d.selection,
    nodeErrors: () => [...d.graph.stats].filter(([, s]) => s.error).map(([id, s]) => ({ node: id, type: d.graph.nodes.get(id)?.type ?? "?", message: s.error!, hint: s.errorHint })),
    route: d.route, go: d.go,
    undo: () => { const ok = d.history.canUndo; d.undo(); return ok; },
    redo: () => { const ok = d.history.canRedo; d.redo(); return ok; },
    canUndo: () => d.history.canUndo, canRedo: () => d.history.canRedo,
    table: d.table, sound: d.sound, now: d.now,
  };
}
