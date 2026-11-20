import type { NodeSpec, Plugin } from "../core/types";

/**
 * The "game is on" signal for a camera-only setup. The Move Tracker and the Stockfish Opponent both read a director that says
 * which phase the experience is in; with no seats, menu or intro to run, this one simply says: a game against the engine, at this strength.
 */
export const gameSession: NodeSpec = {
  type: "game.session", title: "Game Session", category: "Game",
  desc: "Starts a game against Stockfish right away, with no seating, menu or intro. Wire it to the Move Tracker and the Stockfish Opponent.",
  inputs: [], outputs: [{ id: "director", type: "any" }],
  params: [{ id: "elo", kind: "number", label: "Bot strength", min: 200, max: 3200, step: 100, value: 1200 }],
  process(_i, { params, setFidelity }) {
    setFidelity(null);
    return { director: { phase: "game", mode: "engine", elo: Number(params.elo), menu: [], progress: {}, events: [], seat: null } };
  },
};
export const cameraGamePlugin: Plugin = { id: "cameraGame", name: "Camera Bot", register(r) { r.register(gameSession); } };
