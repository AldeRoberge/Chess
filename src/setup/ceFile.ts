import type { GraphJSON } from "../core/types";
import type { SetupConfig } from "./config";
import { parseImport } from "./backups";

/**
 * The Chess Experience file format (`.ce.json`): one JSON document holding the workflow graph and the setup.
 * Shape: { "format": "chess-experience", "version": 1, "savedAt": <ms>, "graph": {nodes, edges}, "setup": <SetupConfig | null> }.
 * Files saved before this format (a bare graph or a backup-style export) still open.
 */
export const CE_FORMAT = "chess-experience";
export const CE_VERSION = 1;
export const CE_EXTENSION = ".ce.json";

export interface CeFile { format: typeof CE_FORMAT; version: number; savedAt: number; graph: GraphJSON; setup: SetupConfig | null }

export function serializeCe(graph: GraphJSON, setup: SetupConfig | null, savedAt = Date.now()): string {
  const file: CeFile = { format: CE_FORMAT, version: CE_VERSION, savedAt, graph, setup };
  return JSON.stringify(file, null, 2);
}

/** Save name for a file: the given base name with the `.ce.json` extension. */
export function ceFileName(base = "chess-experience-workflow"): string {
  return base.replace(/\.ce\.json$|\.json$/i, "") + CE_EXTENSION;
}

export type CeParse = { ok: true; graph: GraphJSON; setup: SetupConfig | null } | { ok: false; error: string };

/** Reads a `.ce.json` document, or a legacy export. Anything else is rejected with a reason the user can see. */
export function parseCe(text: string): CeParse {
  let j: any;
  try { j = JSON.parse(text); } catch { return { ok: false, error: "That file is not a Chess Experience file." }; }
  if (j && typeof j === "object" && "format" in j) {
    if (j.format !== CE_FORMAT) return { ok: false, error: "That file is not a Chess Experience file." };
    if (typeof j.version !== "number" || j.version > CE_VERSION) return { ok: false, error: `This file needs a newer version of Chess Experience (format ${j.version}).` };
    if (!Array.isArray(j.graph?.nodes) || !Array.isArray(j.graph?.edges)) return { ok: false, error: "This Chess Experience file has no workflow in it." };
    return { ok: true, graph: j.graph as GraphJSON, setup: (j.setup ?? null) as SetupConfig | null };
  }
  const legacy = parseImport(text);
  if (legacy) return { ok: true, graph: legacy.graph, setup: legacy.setup };
  return { ok: false, error: "That file is not a Chess Experience file." };
}
