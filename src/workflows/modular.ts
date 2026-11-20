import type { GraphJSON, GroupDef, NodeInstance } from "../core/types";
import { defaultSetup, webcamSetup, MAX_CAMERAS, type CameraSetup, type SetupConfig } from "../setup/config";

const sourceParams = (c: CameraSetup) => ({ device: c.deviceId || (c.kind === "webcam" ? c.label : ""), channel: c.channel, online: c.online, fps: 12 });

/**
 * The camera -> bot pipeline with the board reading split into steps, so each can be watched on its own:
 *   camera -> Clean Picture -> Flatten Board -> Brightness Reader (rules) + Neural Board Reader (ML) -> Blend Readings -> Camera Reading
 * then every camera's reading goes through Multi-Camera Fusion and the Temporal Stabilizer to the Move Tracker and the engine.
 * Only piece presence and colour are read; the tracker works out which piece is which from the moves.
 */
export function modularBotGraph(cameras: CameraSetup[], elo: number, color = "b"): GraphJSON {
  const n = cameras.length, rowH = 330, W = 300, STEP = 322, X0 = 44, col = (i: number) => X0 + i * STEP;
  const node = (id: string, type: string, x: number, y: number, params: NodeInstance["params"]): NodeInstance => ({ id, type, x, y, w: W, params });
  const nodes: NodeInstance[] = [], edges: GraphJSON["edges"] = [];
  const wire = (id: string, from: string, fp: string, to: string, tp: string) => edges.push({ id, from: { node: from, port: fp }, to: { node: to, port: tp } });
  const groups: GroupDef[] = [];
  cameras.forEach((c, i) => {
    const y = 94 + i * rowH, k = i + 1, tag = n > 1 ? ` ${c.id}` : "";
    nodes.push(node(`camera${k}`, "source.webcam", col(0), y, sourceParams(c)));
    nodes.push(node(`clean${k}`, "vision.clean", col(1), y, {}));
    nodes.push(node(`flat${k}`, "vision.flatten", col(2), y, { cam: c.id, corners: c.corners, collect: true }));
    nodes.push(node(`bright${k}`, "vision.brightness", col(3), y, {}));
    nodes.push(node(`neural${k}`, "vision.neuralBoard", col(4), y, {}));
    nodes.push(node(`blend${k}`, "vision.blend", col(5), y, {}));
    nodes.push(node(`reading${k}`, "vision.observe", col(6), y, { weight: c.trust }));
    wire(`w1_${k}`, `camera${k}`, "frame", `clean${k}`, "frame");
    wire(`w2_${k}`, `clean${k}`, "frame", `flat${k}`, "frame");
    wire(`w3_${k}`, `flat${k}`, "flat", `bright${k}`, "flat");
    wire(`w4_${k}`, `flat${k}`, "flat", `neural${k}`, "flat");
    wire(`w5_${k}`, `bright${k}`, "reading", `blend${k}`, "r1");
    wire(`w6_${k}`, `neural${k}`, "reading", `blend${k}`, "r2");
    wire(`w7_${k}`, `blend${k}`, "reading", `reading${k}`, "reading");
    wire(`w8_${k}`, `reading${k}`, "obs", "fuse", `o${k}`);
    const top = y - 64, h = 330 - 8;
    groups.push({ id: `gp${k}`, title: `Picture${tag}`, color: "#5aa9ff", x: col(0) - 24, y: top, w: STEP * 3 - 20, h });
    groups.push({ id: `gd${k}`, title: `Detectors${tag}`, color: "#5be08a", x: col(3) - 24, y: top, w: STEP * 2 - 20, h });
    groups.push({ id: `gc${k}`, title: `Combine${tag}`, color: "#3fb59a", x: col(5) - 24, y: top, w: STEP * 2 - 20, h });
  });
  const by = 94 + n * rowH + 40;
  nodes.push(node("fuse", "vision.fuse", col(0), by, {}));
  nodes.push(node("stabilize", "vision.stabilize", col(1), by, {}));
  nodes.push(node("session", "game.session", col(3), by, { elo }));
  nodes.push(node("tracker", "game.tracker", col(4), by, {}));
  nodes.push(node("engine", "game.engine", col(5), by, { color, virtualHand: false }));
  wire("e1", "fuse", "board", "stabilize", "board");
  wire("e2", "stabilize", "board", "tracker", "board");
  wire("e3", "session", "director", "tracker", "director");
  wire("e4", "tracker", "game", "engine", "game");
  wire("e5", "session", "director", "engine", "director");
  groups.push({ id: "gb", title: "Board analysis", color: "#ffd35a", x: col(0) - 24, y: by - 64, w: STEP * 2 - 20, h: 322 });
  groups.push({ id: "gg", title: "Game", color: "#9a78e0", x: col(3) - 24, y: by - 64, w: STEP * 3 - 20, h: 322 });
  return { nodes, edges, groups };
}

/** A physical camera per settings entry, each with its own detection chain; everything after that is shared. */
export function buildModularBot(saved: SetupConfig | null): { graph: GraphJSON; setup: SetupConfig } {
  const base = saved ?? defaultSetup();
  const cameras = (saved ? saved.cameras : [webcamSetup("", "Default webcam", "A")]).slice(0, MAX_CAMERAS);
  const setup: SetupConfig = { ...base, completed: true, cameras, tracking: { pose: false }, projectors: { ...base.projectors, count: 0, dmx: false }, opponent: { mode: "engine", elo: base.opponent.elo }, demo: { ...base.demo, autoplay: false } };
  return { setup, graph: modularBotGraph(cameras, setup.opponent.elo) };
}
