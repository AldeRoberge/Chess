import { PAGES } from "../../ui/route";
import { obj, str, type ToolGroup } from "./shared";

/** Moving around the app and the undo stack. */
export const appTools: ToolGroup = (h) => [
  { name: "navigate", risk: "write", label: { doing: "Opening a page", done: "Opened a page" }, description: "Show a page of the app: table, world (3D / mapping), log, perf, assistant, or the setup wizard (optionally at a step id such as cameras, board, scenes, narration, opponent, room, launch).",
    parameters: obj({ page: str("where to go", { enum: [...PAGES, "setup"] }), step: str("setup step id") }, ["page"]),
    run: (a) => { h.go(a.page === "setup" ? { page: "setup", step: a.step ?? null } : { page: a.page }); return { now_on: h.route() }; } },
  { name: "undo", risk: "write", label: { doing: "Undoing", done: "Undid the last change" }, description: "Undo the last change to the workflow (the same as Ctrl+Z).", parameters: obj({}), run: () => ({ undone: h.undo(), can_undo_more: h.canUndo() }) },
  { name: "redo", risk: "write", label: { doing: "Redoing", done: "Redid it" }, description: "Redo what was undone.", parameters: obj({}), run: () => ({ redone: h.redo() }) },
];
