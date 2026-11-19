import { MAX_CAMERAS, nextCameraId, virtualCamera, webcamSetup, withDefaults, type CameraSetup, type Rig, type SetupConfig } from "../setup/config";
import { parseCorners } from "../plugins/shared";
import { SCENES } from "../scene/types";
import { SCENARIOS } from "../sim/scenarios";

/** Settings the assistant may change, with their limits. Secrets (API keys) are deliberately absent: the person types those in Setup. */
type Rule = { kind: "num"; min: number; max: number; int?: boolean } | { kind: "bool" } | { kind: "enum"; of: readonly (string | number)[] } | { kind: "text"; max: number; pattern?: RegExp };
const SCENE_IDS = ["auto", ...Object.keys(SCENES)];
export const RULES: Record<string, Rule> = {
  scene: { kind: "enum", of: SCENE_IDS },
  rain: { kind: "num", min: -1, max: 1 }, snow: { kind: "num", min: -1, max: 1 }, hour: { kind: "num", min: -1, max: 24 },
  "narrator.voices": { kind: "enum", of: [1, 2] }, "narrator.nameA": { kind: "text", max: 40 }, "narrator.nameB": { kind: "text", max: 40 },
  "narrator.speak": { kind: "bool" }, "narrator.volume": { kind: "num", min: 0, max: 1 },
  "ai.engine": { kind: "enum", of: ["builtin", "openai"] }, "ai.model": { kind: "text", max: 80 },
  "voice.engine": { kind: "enum", of: ["browser", "elevenlabs"] }, "voice.voiceIdA": { kind: "text", max: 80 }, "voice.voiceIdB": { kind: "text", max: 80 },
  "opponent.mode": { kind: "enum", of: ["menu", "engine", "human"] }, "opponent.elo": { kind: "num", min: 100, max: 3200, int: true },
  "projectors.count": { kind: "num", min: 0, max: 4, int: true }, "projectors.dmx": { kind: "bool" }, "projectors.dmxUrl": { kind: "text", max: 200, pattern: /^wss?:\/\//i },
  "tracking.pose": { kind: "bool" },
  "demo.autoplay": { kind: "bool" }, "demo.scenario": { kind: "enum", of: SCENARIOS.map((s) => s.id) },
};
const CAM_RULES: Record<string, Rule> = { online: { kind: "bool" }, channel: { kind: "enum", of: ["luma", "red", "green", "blue"] }, trust: { kind: "num", min: 0, max: 2 }, fov: { kind: "num", min: 10, max: 120 }, label: { kind: "text", max: 60 } };
const SECRET = /key|token|secret|password/i;

/** Checks one value against its rule. Returns the cleaned value, or an error string. */
export function check(rule: Rule, v: unknown): { v: string | number | boolean } | { err: string } {
  if (rule.kind === "bool") return typeof v === "boolean" ? { v } : v === "true" || v === "false" ? { v: v === "true" } : { err: "must be true or false" };
  if (rule.kind === "num") {
    const n = typeof v === "string" && v.trim() ? Number(v) : v;
    if (typeof n !== "number" || !Number.isFinite(n)) return { err: "must be a number" };
    if (n < rule.min || n > rule.max) return { err: `must be between ${rule.min} and ${rule.max}` };
    return { v: rule.int ? Math.round(n) : n };
  }
  if (rule.kind === "enum") { const hit = rule.of.find((o) => o === v || String(o) === String(v)); return hit === undefined ? { err: `must be one of ${rule.of.join(", ")}` } : { v: hit }; }
  if (typeof v !== "string" || !v.trim()) return { err: "must be non-empty text" };
  const s = String(v).trim().slice(0, rule.max);
  return rule.pattern && !rule.pattern.test(s) ? { err: `must match ${rule.pattern}` } : { v: s };
}

export interface PatchResult { setup: SetupConfig; applied: string[]; rejected: { path: string; reason: string }[] }

/** Applies a nested patch like {scene:"cavern", narrator:{voices:1}} (or dotted keys) to a copy of the setup. Unknown or unsafe paths are rejected, never guessed. */
export function patchSetup(base: SetupConfig, patch: Record<string, unknown>): PatchResult {
  const setup = withDefaults(structuredClone(base)), applied: string[] = [], rejected: { path: string; reason: string }[] = [];
  const walk = (obj: Record<string, unknown>, prefix: string) => {
    for (const [k, v] of Object.entries(obj ?? {})) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (SECRET.test(k)) { rejected.push({ path, reason: "secrets are never set through chat; the person enters them in Setup" }); continue; }
      if (path === "cameras") { rejected.push({ path, reason: "use add_camera, update_camera or remove_camera" }); continue; }
      const rule = RULES[path];
      if (!rule) {
        if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(RULES).some((r) => r.startsWith(`${path}.`))) { walk(v as Record<string, unknown>, path); continue; }
        rejected.push({ path, reason: "not a setting the assistant can change" }); continue;
      }
      const r = check(rule, v);
      if ("err" in r) { rejected.push({ path, reason: r.err }); continue; }
      const parts = path.split("."); let o: any = setup;
      for (const p of parts.slice(0, -1)) o = o[p];
      o[parts[parts.length - 1]] = r.v; applied.push(path);
    }
  };
  walk(patch, "");
  return { setup, applied, rejected };
}

/** Add, change or remove cameras. Same contract as patchSetup. */
export function editCameras(base: SetupConfig, op: { action: "add"; kind: "virtual" | "webcam"; rig?: string; label?: string } | { action: "update"; id: string; set: Record<string, unknown> } | { action: "remove"; id: string }): PatchResult {
  const setup = withDefaults(structuredClone(base)), applied: string[] = [], rejected: { path: string; reason: string }[] = [];
  const find = (id: string) => setup.cameras.find((c) => c.id.toLowerCase() === String(id).toLowerCase());
  if (op.action === "add") {
    if (setup.cameras.length >= MAX_CAMERAS) rejected.push({ path: "cameras", reason: `at most ${MAX_CAMERAS} cameras` });
    else {
      const id = nextCameraId(setup);
      const rig = (["A", "B", "C"].includes(String(op.rig).toUpperCase()) ? String(op.rig).toUpperCase() : (["A", "B", "C"] as Rig[]).find((r) => !setup.cameras.some((c) => c.kind === "virtual" && c.rig === r)) ?? "A") as Rig;
      const cam: CameraSetup = op.kind === "webcam" ? webcamSetup("", op.label?.slice(0, 60) || `Webcam ${id}`, id) : virtualCamera(rig, id);
      if (op.kind === "webcam") cam.online = false; // no device chosen yet: the person picks it in Setup > Cameras
      setup.cameras.push(cam); applied.push(`cameras.${id}`);
    }
  } else if (op.action === "remove") {
    const cam = find(op.id);
    if (!cam) rejected.push({ path: `cameras.${op.id}`, reason: "no such camera" });
    else { setup.cameras = setup.cameras.filter((c) => c !== cam); applied.push(`cameras.${cam.id} removed`); }
  } else {
    const cam = find(op.id);
    if (!cam) rejected.push({ path: `cameras.${op.id}`, reason: "no such camera" });
    else for (const [k, v] of Object.entries(op.set ?? {})) {
      const path = `cameras.${cam.id}.${k}`;
      if (k === "corners") {
        if (typeof v === "string" && parseCorners(v)) { cam.corners = v; applied.push(path); } else rejected.push({ path, reason: 'must be "x,y;x,y;x,y;x,y" for a8;h8;h1;a1 in 480x360 camera pixels' });
        continue;
      }
      const rule = CAM_RULES[k];
      if (!rule) { rejected.push({ path, reason: "not a camera setting the assistant can change (online, channel, trust, fov, label, corners)" }); continue; }
      const r = check(rule, v);
      if ("err" in r) rejected.push({ path, reason: r.err }); else { (cam as any)[k] = r.v; applied.push(path); }
    }
  }
  return { setup, applied, rejected };
}
