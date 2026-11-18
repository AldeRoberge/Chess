import type { Route } from "./route";

export interface NextCtx {
  route: Route;
  setupDone: boolean;
  soundOn: boolean;
  /** 0..1 */
  boardFidelity: number;
  cameras: number;
}

export interface Suggestion {
  id: string;
  icon: string;
  title: string;
  hint: string;
  to?: Route;
  action?: "sound" | "export";
}

const S = (id: string, icon: string, title: string, hint: string, extra: Pick<Suggestion, "to" | "action">): Suggestion => ({ id, icon, title, hint, ...extra });

/** What to do next, most useful first, at most `max`. Pure so it can be tested without a DOM. */
export function suggestNext(c: NextCtx, max = 3): Suggestion[] {
  const out: Suggestion[] = [];
  const page = c.route.page;
  if (!c.setupDone) out.push(S("finish-setup", "launch", "Finish setup", "Two minutes: cameras, board, scenes", { to: { page: "setup", step: "briefing" } }));
  else if (c.cameras === 0) out.push(S("add-camera", "camera", "Add a camera", "Nothing is watching the table yet", { to: { page: "setup", step: "cameras" } }));
  else if (c.boardFidelity < 0.8) out.push(S("calibrate", "board", "Calibrate the board", "Drag the four corners onto the board", { to: { page: "setup", step: "board" } }));

  if (page === "table") out.push(S("see-3d", "world", "See it in 3D", "The room, cameras and projection", { to: { page: "world" } }), S("read-log", "log", "Read the commentary", "What the narrators said", { to: { page: "log" } }));
  else if (page === "world") out.push(S("aim", "room", "Set up projectors", "Aim each projector at the table", { to: { page: "setup", step: "room" } }), S("scene", "scene", "Tune the atmosphere", "Rain, snow, time of day", { to: { page: "setup", step: "scenes" } }), S("to-table", "table", "Back to the table", "Live board and moves", { to: { page: "table" } }));
  else if (page === "log") out.push(S("voices", "voice", "Tune the narrators", "Voices, volume, language", { to: { page: "setup", step: "narration" } }), S("to-table", "table", "Watch the table", "Live board and moves", { to: { page: "table" } }));
  else out.push(S("to-table", "table", "Go to the table", "Live board and moves", { to: { page: "table" } }));

  if (!c.soundOn) out.push(S("sound", "sound", "Turn the sound on", "Thunder, rain and narration", { action: "sound" }));
  out.push(S("export", "export", "Export the workflow", "Save your node graph as JSON", { action: "export" }));
  const seen = new Set<string>();
  return out.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true))).slice(0, max);
}
