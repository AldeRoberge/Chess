import type { GraphJSON } from "../core/types";
import type { SetupConfig } from "../setup/config";
import basic from "./basic.workflow.json";
import chesscom from "./chesscom.workflow.json";
import complete from "./complete.workflow.json";
import pieceless from "./pieceless.workflow.json";

/**
 * A workflow file: a patch (node graph) plus, optionally, the setup it was built from.
 * It is the same shape the Backups panel exports, so any workflow can also be loaded with "Import file".
 */
export interface WorkflowFile { app: string; kind: "workflow"; name: string; description: string; graph: GraphJSON; setup: SetupConfig | null }

/** The demo workflows that ship with the app, easiest first. Each one is a plain JSON file next to this module. */
export const WORKFLOWS: (WorkflowFile & { id: string })[] = [
  { id: "basic", ...(basic as unknown as WorkflowFile) },
  { id: "complete", ...(complete as unknown as WorkflowFile) },
  { id: "chesscom", ...(chesscom as unknown as WorkflowFile) },
  { id: "pieceless", ...(pieceless as unknown as WorkflowFile) },
];
