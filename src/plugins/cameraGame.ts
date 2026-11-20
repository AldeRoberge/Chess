import { Registry, type NodeRuntime, type NodeSpec, type ParamValues, type Plugin } from "../core/types";
import { visionPlugin } from "./vision";
import { gamePlugin } from "./game";
import { bus } from "../core/bus";
import { drawBoard } from "./shared";
import type { CameraSetup } from "../setup/config";

// Reuse the production readers and tracker, with independent state for every camera.
interface Stage { spec: NodeSpec; state: any; params: ParamValues }
interface State { readers: Stage[]; fuse: Stage; stabilize: Stage; tracker: Stage; engine: Stage; config: string; board: any; game: any }
const registry = new Registry().use(visionPlugin).use(gamePlugin);
function stage(type: string): Stage {
  const spec = registry.get(type)!;
  return { spec, state: spec.init?.(), params: Object.fromEntries((spec.params ?? []).map(p => [p.id, p.value])) };
}
function run(s: Stage, inputs: Record<string, any>, rt: NodeRuntime): Record<string, any> {
  return s.spec.process(inputs, { ...rt, params: s.params, state: s.state }) ?? {};
}
function dispose(s: Stage) { s.spec.dispose?.(s.state); }
export const cameraGame: NodeSpec<State> = {
  type: "game.cameraBot", title: "Camera Board → Bot", category: "Game",
  desc: "Reads all configured cameras, combines reliable views and validates physical moves. Move the bot's announced piece on your board.",
  inputs: [1, 2, 3, 4].map(i => ({ id: `f${i}`, type: "frame", label: `Camera ${i}` })),
  outputs: [{ id: "board", type: "board" }, { id: "game", type: "game" }, { id: "events", type: "event" }],
  params: [
    { id: "cameras", kind: "text", label: "Camera settings", value: "[]" },
    { id: "elo", kind: "number", label: "Bot strength", min: 200, max: 3200, step: 100, value: 1200 },
    { id: "color", kind: "select", label: "Bot plays", options: ["b", "w"], value: "b" },
    { id: "resync", kind: "bool", label: "New game", value: false, action: true },
  ],
  previewSize: [320, 370],
  init: () => ({ readers: [], fuse: stage("vision.fuse"), stabilize: stage("vision.stabilize"), tracker: stage("game.tracker"), engine: stage("game.engine"), config: "", board: null, game: null }),
  process(inputs, rt) {
    const s = rt.state;
    const config = String(rt.params.cameras);
    if (s.config !== config) {
      const cams = JSON.parse(config) as CameraSetup[];
      s.readers.forEach(dispose);
      s.readers = cams.slice(0, 4).map(c => {
        const r = stage("vision.boardReader");
        Object.assign(r.params, { cam: c.id, corners: c.corners, weight: c.trust, collect: false });
        return r;
      });
      s.config = config;
    }
    const observations: Record<string, any> = {};
    s.readers.forEach((r, i) => { observations[`o${i + 1}`] = run(r, { frame: inputs[`f${i + 1}`] }, rt).obs; });
    const fused = run(s.fuse, observations, rt).board;
    s.board = run(s.stabilize, { board: fused }, rt).board;
    const director = { phase: "game", mode: "engine", elo: Number(rt.params.elo), menu: [], progress: {}, events: [], seat: null };
    s.tracker.params.resync = rt.params.resync;
    rt.params.resync = false;
    const tracked = run(s.tracker, { board: s.board, director }, rt);
    s.game = tracked.game;
    Object.assign(s.engine.params, { color: rt.params.color, virtualHand: false });
    const engine = run(s.engine, { game: s.game, director }, rt);
    rt.setFidelity(s.game?.fidelity ?? null);
    return { board: s.board, game: s.game, events: [...(tracked.events ?? []), ...(engine.events ?? [])] };
  },
  preview(ctx, w, h, s) {
    drawBoard(ctx, w, h - 50, s.board, { fen: s.game?.fen, diff: s.game?.diff });
    ctx.fillStyle = "#b9c6e4"; ctx.font = "14px sans-serif"; ctx.textAlign = "left";
    const hint = bus.engineHint;
    ctx.fillText(hint ? `Move bot: ${hint.from} → ${hint.to}` : s.game ? `${s.game.status} · ${s.game.turn === "w" ? "White" : "Black"} to move` : "Waiting for camera board readings", 8, h - 28);
    ctx.fillText(`${s.board?.cams ?? 0} cameras · ${s.board?.handOver ? "Hand over board — holding" : s.board?.settled ? "Board settled" : "Waiting for a still board"}`, 8, h - 8);
  },
  dispose(s) { [...s.readers, s.fuse, s.stabilize, s.tracker, s.engine].forEach(dispose); },
};
export const cameraGamePlugin: Plugin = { id: "cameraGame", name: "Camera Bot", register(r) { r.register(cameraGame); } };
