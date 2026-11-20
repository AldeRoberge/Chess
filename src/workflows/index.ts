import type { GraphJSON } from "../core/types";
import { buildCameraBot } from "./cameraBot";
import type { SetupConfig } from "../setup/config";
import basic from "./basic.workflow.json";
import botplay from "./botplay.workflow.json";
import chesscom from "./chesscom.workflow.json";
import humanvsbot from "./humanvsbot.workflow.json";
import complete from "./complete.workflow.json";
import real from "./real.workflow.json";
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
  { id: "real", ...(real as unknown as WorkflowFile) },
  { id: "chesscom", ...(chesscom as unknown as WorkflowFile) },
  { id: "pieceless", ...(pieceless as unknown as WorkflowFile) },
  { id: "botplay", ...(botplay as unknown as WorkflowFile) },
  { id: "humanvsbot", ...(humanvsbot as unknown as WorkflowFile) },
  { id: "camera-bot", app: "chess-experience", kind: "workflow", name: "Simple cameras → bot", description: "Every camera from Settings feeds one on-screen board processor. Play against Stockfish and move its indicated piece on your physical board. Uses saved board corners; no projector or people tracking.", ...buildCameraBot(null) },
];

/**
 * A live workflow ships wired to one webcam. When the saved setup has two or more enabled webcams, give it a second one:
 * the first keeps its source and board reader, the second is a copy of them (own device and corners) feeding the fuser and people tracker.
 */
export function withLiveCameras(w: WorkflowFile, saved: SetupConfig | null): { graph: GraphJSON; setup: SetupConfig | null } {
  if (w.graph.nodes.some(n => n.type === "game.cameraBot")) return buildCameraBot(saved);
  const cams = (saved?.cameras ?? []).filter((c) => c.kind === "webcam" && c.online).slice(0, 2);
  const src = w.graph.nodes.find((n) => n.type === "source.webcam"), rd = src && w.graph.nodes.find((n) => n.type === "vision.boardReader" && w.graph.edges.some((e) => e.from.node === src.id && e.to.node === n.id));
  if (cams.length < 2 || !src || !rd || w.graph.nodes.filter((n) => n.type === "source.webcam").length !== 1) return { graph: w.graph, setup: w.setup };
  const g: GraphJSON = JSON.parse(JSON.stringify(w.graph));
  const s0 = g.nodes.find((n) => n.id === src.id)!, r0 = g.nodes.find((n) => n.id === rd.id)!;
  const fuse = g.nodes.find((n) => n.type === "vision.fuse"), pose = g.nodes.find((n) => n.type === "tracking.pose");
  const id = (p: string) => { let i = 1; while (g.nodes.some((n) => n.id === p + i) || g.edges.some((e) => e.id === p + i)) i++; return p + i; };
  const s1 = { ...s0, id: id("cam"), y: s0.y + 360, params: { ...s0.params } }, r1 = { ...r0, id: id("cam"), y: r0.y + 360, params: { ...r0.params } };
  s1.id = id("camsrc"); g.nodes.push(s1); r1.id = id("camrd"); g.nodes.push(r1);
  [s0, s1].forEach((n, i) => { n.params = { ...n.params, device: cams[i].deviceId || cams[i].label, channel: cams[i].channel, online: true }; });
  [r0, r1].forEach((n, i) => { n.params = { ...n.params, cam: cams[i].id, corners: cams[i].corners, weight: cams[i].trust }; });
  g.edges.push({ id: id("ecam"), from: { node: s1.id, port: "frame" }, to: { node: r1.id, port: "frame" } });
  if (fuse) g.edges.push({ id: id("ecam"), from: { node: r1.id, port: "obs" }, to: { node: fuse.id, port: "o2" } });
  if (pose) g.edges.push({ id: id("ecam"), from: { node: s1.id, port: "frame" }, to: { node: pose.id, port: "f2" } });
  return { graph: g, setup: w.setup ? { ...w.setup, cameras: cams } : w.setup };
}
