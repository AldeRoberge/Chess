import { obj, str, type ToolGroup } from "./shared";

/** The virtual table (simulated hand and cameras). Never touches a real board. */
export const tableTools: ToolGroup = (h) => [
  { name: "table_play", risk: "write", label: { doing: "Playing a move", done: "Played a move" }, description: "Play a move on the VIRTUAL table (simulated hand, seen by the simulated cameras). SAN (Nf3) or UCI (g1f3). Only for the virtual table, never a real board.",
    parameters: obj({ move: str("SAN or UCI move") }, ["move"]),
    run: (a) => { const before = h.table.fen(); if (!h.table.play(a.move)) throw new Error(`"${a.move}" is not legal here. Legal moves: ${h.table.legal().join(" ")}`); return { played: a.move, fen_before: before }; } },
  { name: "table_seat", risk: "write", label: { doing: "Moving the player", done: "Moved the player" }, description: "Seat or stand up the simulated player (the cameras and tracking then see a person at the table).",
    parameters: obj({ seated: { type: "boolean" } }, ["seated"]), run: (a) => { h.table.seat(!!a.seated); return { seated: !!a.seated }; } },
  { name: "table_reset", risk: "danger", label: { doing: "Resetting the table", done: "Reset the table" }, description: "Put every piece of the virtual table back on its starting square (ends the current simulated game).",
    parameters: obj({}), describe: () => "Reset the virtual table to the starting position. The current simulated game is lost.", run: () => { h.table.reset(); return { reset: true }; } },
];
