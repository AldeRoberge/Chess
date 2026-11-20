import type { GraphJSON, GroupDef, NodeInstance } from "../core/types";
import { defaultSetup, webcamSetup, MAX_CAMERAS, type CameraSetup, type SetupConfig } from "../setup/config";

const sourceParams = (c: CameraSetup) => ({ device: c.deviceId || (c.kind === "webcam" ? c.label : ""), channel: c.channel, online: c.online, fps: 12 });

/**
 * The camera → bot pipeline as ordinary nodes, in three groups: each camera feeds its own Board Reader; the readers go through
 * Multi-Camera Fusion and the Temporal Stabilizer; the Move Tracker and Stockfish Opponent play from that board.
 */
export function cameraBotGraph(cameras: CameraSetup[], elo: number, color = "b"): GraphJSON {
  const n = cameras.length, rowH = 350, W = 360, colX = (x0: number, i: number) => x0 + 24 + i * 410;
  const node = (id: string, type: string, x: number, y: number, params: NodeInstance["params"]): NodeInstance => ({ id, type, x, y, w: W, params });
  const nodes: NodeInstance[] = [], edges: GraphJSON["edges"] = [];
  const wire = (id: string, from: string, fp: string, to: string, tp: string) => edges.push({ id, from: { node: from, port: fp }, to: { node: to, port: tp } });
  cameras.forEach((c, i) => {
    nodes.push(node(`camera${i + 1}`, "source.webcam", colX(20, 0), 94 + i * rowH, sourceParams(c)));
    nodes.push(node(`reader${i + 1}`, "vision.boardReader", colX(20, 1), 94 + i * rowH, { cam: c.id, corners: c.corners, weight: c.trust, collect: false }));
    wire(`feed${i + 1}`, `camera${i + 1}`, "frame", `reader${i + 1}`, "frame");
    wire(`obs${i + 1}`, `reader${i + 1}`, "obs", "fuse", `o${i + 1}`);
  });
  nodes.push(node("fuse", "vision.fuse", colX(868, 0), 94, {}));
  nodes.push(node("stabilize", "vision.stabilize", colX(868, 1), 94, {}));
  nodes.push(node("session", "game.session", colX(868, 0), 522, { elo }));
  nodes.push(node("tracker", "game.tracker", colX(868, 1), 522, {}));
  nodes.push(node("engine", "game.engine", colX(868, 2), 522, { color, virtualHand: false }));
  wire("e1", "fuse", "board", "stabilize", "board");
  wire("e2", "stabilize", "board", "tracker", "board");
  wire("e3", "session", "director", "tracker", "director");
  wire("e4", "tracker", "game", "engine", "game");
  wire("e5", "session", "director", "engine", "director");
  const groups: GroupDef[] = [
    { id: "g1", title: "Cameras", color: "#f2b84b", x: 20, y: 30, w: 828, h: 388 + Math.max(0, n - 1) * rowH },
    { id: "g2", title: "Board analysis", color: "#3fb59a", x: 868, y: 30, w: 828, h: 388 },
    { id: "g3", title: "Game", color: "#9a78e0", x: 868, y: 458, w: 1238, h: 388 },
  ];
  return { nodes, edges, groups };
}

/** A physical camera per settings entry, each with its own reader; everything after that is shared. */
export function buildCameraBot(saved: SetupConfig | null): { graph: GraphJSON; setup: SetupConfig } {
  const base = saved ?? defaultSetup();
  const cameras = (saved ? saved.cameras : [webcamSetup("", "Default webcam", "A")]).slice(0, MAX_CAMERAS);
  const setup: SetupConfig = { ...base, completed: true, cameras, tracking: { pose: false }, projectors: { ...base.projectors, count: 0, dmx: false }, opponent: { mode: "engine", elo: base.opponent.elo }, demo: { ...base.demo, autoplay: false } };
  return { setup, graph: cameraBotGraph(cameras, setup.opponent.elo) };
}

/** Older saves hold the retired single "Camera Board → Bot" node. Replace it with the node chain, keeping its cameras, strength and colour. */
export function migrateCameraBot(g: GraphJSON): GraphJSON {
  const old = g.nodes.find((n) => n.type === "game.cameraBot");
  if (!old) return g;
  let cams: CameraSetup[] = [];
  try { cams = (JSON.parse(String(old.params.cameras)) as CameraSetup[]).slice(0, MAX_CAMERAS); } catch { /* fall through to a default camera */ }
  if (!cams.length) cams = [webcamSetup("", "Default webcam", "A")];
  const fresh = cameraBotGraph(cams, Number(old.params.elo) || 1200, String(old.params.color ?? "b"));
  // keep each camera's own source settings (device, channel, fps) from the old graph
  for (const n of fresh.nodes) { const was = g.nodes.find((o) => o.id === n.id && o.type === n.type); if (was && n.type === "source.webcam") n.params = { ...n.params, ...was.params }; }
  return fresh;
}
