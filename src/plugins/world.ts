import type { NodeSpec, Plugin } from "../core/types";
import { performAction, virtualTable, type TableAction } from "../sim/virtualTable";

/** What an AI player hands to the world: which colour it plays. */
export interface PlayerInfo { color: "w" | "b" }

interface WorldState { players: number }
/**
 * The virtual table as a node: it owns the pieces, hands and arms that the virtual cameras look at.
 * Its two player inputs are the AI players seated at it.
 */
const world: NodeSpec<WorldState> = {
  type: "world.virtual", title: "Virtual World", category: "Experience",
  desc: "The virtual table: the pieces, the hands and the two AI players seated at it. Virtual cameras look at this world.",
  inputs: [{ id: "white", type: "player", label: "White player" }, { id: "black", type: "player", label: "Black player" }],
  outputs: [{ id: "world", type: "world" }],
  init: () => ({ players: 0 }),
  process({ white, black }, { now, state, span }) {
    span("table physics tick", () => virtualTable.tick(now));
    state.players = [white, black].filter(Boolean).length;
    return { world: virtualTable };
  },
};

interface PlayerState { lastId: number }
/**
 * An AI player: takes the actions the scenario asks for and carries out the ones for its own colour.
 * Both players take part in the handshakes; only the losing player bangs the table.
 */
const player: NodeSpec<PlayerState> = {
  type: "sim.player", title: "AI Player", category: "Experience",
  desc: "An AI player at the virtual table. Plays its colour's moves from the Scenario Player, shakes hands at the start and end, and bangs the table when it loses.",
  inputs: [{ id: "actions", type: "action", label: "Actions" }],
  outputs: [{ id: "player", type: "player" }],
  params: [{ id: "color", kind: "select", label: "Plays", options: ["w", "b"], labels: ["♔ White", "♚ Black"], value: "w" }],
  init: () => ({ lastId: 0 }),
  process({ actions }, { params, state, now, span }) {
    const color = String(params.color) as "w" | "b";
    for (const a of ((actions as TableAction[] | undefined) ?? [])) {
      if (a.id <= state.lastId) continue; // each action is carried out once
      state.lastId = a.id;
      span("perform action", () => performAction(virtualTable, a, color, now));
    }
    const info: PlayerInfo = { color };
    return { player: info };
  },
};

/**
 * A human at the keyboard and mouse in place of an AI player: it takes no scripted actions, the Table panel's mouse plays this colour.
 * Wires into the world exactly like an AI Player, so the two are interchangeable.
 */
const desktop: NodeSpec = {
  type: "sim.desktop", title: "Desktop Controller", category: "Experience",
  desc: "A person at this computer plays this colour with the mouse on the Table panel, instead of an AI player. Ignores the Scenario Player's actions.",
  inputs: [],
  outputs: [{ id: "player", type: "player" }],
  params: [{ id: "color", kind: "select", label: "Plays", options: ["w", "b"], labels: ["♔ White", "♚ Black"], value: "w" }],
  process(_i, { params }) {
    const info: PlayerInfo = { color: String(params.color) as "w" | "b" };
    return { player: info };
  },
};

export const worldPlugin: Plugin = { id: "world", name: "Virtual World", register: (r) => { r.register(world); r.register(player); r.register(desktop); } };
