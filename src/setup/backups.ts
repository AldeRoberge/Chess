import type { GraphJSON } from "../core/types";
import type { SetupConfig } from "./config";

/** A restorable snapshot of the patch and the setup it was built from. */
export interface Backup { id: string; t: number; reason: string; graph: GraphJSON; setup: SetupConfig | null }

const KEY = "cx.backups.v1";
export const MAX_BACKUPS = 15;

const valid = (b: any): b is Backup => !!b && typeof b.id === "string" && typeof b.t === "number" && Array.isArray(b.graph?.nodes) && Array.isArray(b.graph?.edges);

export function listBackups(): Backup[] {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(j) ? j.filter(valid).sort((a, b) => b.t - a.t) : [];
  } catch { return []; }
}

function write(list: Backup[]): boolean {
  // Storage is finite: on quota errors drop the oldest and retry until it fits.
  for (let l = list.slice(0, MAX_BACKUPS); ; l = l.slice(0, -1)) {
    try { localStorage.setItem(KEY, JSON.stringify(l)); return true; } catch { if (l.length <= 1) return false; }
  }
}

/** Adds a backup (newest first). Skips it when patch and setup equal the newest one and `dedupe` is set. */
export function addBackup(reason: string, graph: GraphJSON, setup: SetupConfig | null, dedupe = true, t = Date.now()): Backup | null {
  const list = listBackups();
  if (dedupe && list[0] && JSON.stringify(list[0].graph) === JSON.stringify(graph) && JSON.stringify(list[0].setup) === JSON.stringify(setup)) return null;
  const b: Backup = { id: t.toString(36) + Math.random().toString(36).slice(2, 6), t, reason, graph: JSON.parse(JSON.stringify(graph)), setup: setup ? JSON.parse(JSON.stringify(setup)) : null };
  return write([b, ...list]) ? b : null;
}

export function deleteBackup(id: string) { write(listBackups().filter((b) => b.id !== id)); }

/** Accepts a backup file or a bare patch export. Returns null when it is neither. */
export function parseImport(text: string): { graph: GraphJSON; setup: SetupConfig | null } | null {
  try {
    const j = JSON.parse(text);
    const g = Array.isArray(j?.nodes) ? j : j?.graph;
    if (!Array.isArray(g?.nodes) || !Array.isArray(g?.edges)) return null;
    return { graph: g as GraphJSON, setup: j?.setup ?? null };
  } catch { return null; }
}

export const ago = (t: number, now = Date.now()) => {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};

/** Crash detection: a heartbeat that `closeSession` marks as a clean exit. */
const SKEY = "cx.session.v1";
export const STALE_MS = 15000;
interface Session { open: boolean; beat: number }
const readSession = (): Session | null => { try { return JSON.parse(localStorage.getItem(SKEY) ?? "null"); } catch { return null; } };
const putSession = (s: Session) => { try { localStorage.setItem(SKEY, JSON.stringify(s)); } catch { /* storage unavailable */ } };

/** Call once at boot. True when the previous session never said goodbye and its heartbeat has gone quiet. */
export function openSession(now = Date.now()): boolean {
  const prev = readSession();
  const crashed = !!prev && prev.open && now - prev.beat > STALE_MS;
  putSession({ open: true, beat: now });
  return crashed;
}
export const beatSession = (now = Date.now()) => putSession({ open: true, beat: now });
export const closeSession = () => putSession({ open: false, beat: Date.now() });
