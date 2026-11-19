import type { AgentTool } from "./agent";
import { bus } from "../core/bus";
import type { Registry } from "../core/types";
import { defaultSetup, hasErrors, validateSetup } from "../setup/config";
import { clamp, catalog, draftToGraph, parseDraft, type Draft } from "../workflows/ai";
import { problems, redact, snapshot, type AssistantHost } from "./context";
import { editCameras, patchSetup, type PatchResult } from "./setupPatch";
import { PAGES } from "../ui/route";
import { SCENARIOS } from "../sim/scenarios";

const SECRET = /key|token|secret|password/i;
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: "string", description, ...extra });

/** One line per node type, narrowed by a search word, so the model can look things up without carrying the whole catalog. */
export function nodeTypes(reg: Registry, query = "", category = ""): string {
  const q = query.toLowerCase().trim(), c = category.toLowerCase().trim();
  const lines = catalog(reg).split(/\n(?=- )/).filter((b) => (!q || b.toLowerCase().includes(q)) && (!c || b.toLowerCase().includes(`[${c}]`)));
  return lines.length ? lines.slice(0, 12).join("\n") + (lines.length > 12 ? `\n(${lines.length - 12} more: narrow the search)` : "") : "No node type matches. Try a shorter word, or list a category (Source, Vision, Game, Narration, Scene, Output, Tracking, Experience, Effects).";
}

/** Everything the assistant can do. Reads are free; writes change the app (all undoable); "danger" tools ask first. */
export function buildTools(h: AssistantHost): AgentTool[] {
  const live = () => problems(h);
  const commit = (res: PatchResult, why: string) => {
    const base = h.setup() ?? defaultSetup();
    if (!res.applied.length) return { applied: [], rejected: res.rejected, note: "Nothing was changed." };
    const before = hasErrors(validateSetup(base)), after = validateSetup(res.setup);
    if (!before && hasErrors(after)) return { applied: [], rejected: res.rejected, blocked_by: after.filter((i) => i.level === "error"), note: "Not applied: it would leave the setup with errors." };
    h.applySetup({ ...res.setup, completed: base.completed || res.setup.completed }, why);
    return { applied: res.applied, rejected: res.rejected, problems_now: live(), note: "Applied and the workflow was rebuilt. Ctrl+Z undoes it." };
  };
  const node = (id: string) => h.graph().nodes.find((n) => n.id === id);
  const paramInfo = (type: string) => (h.registry.get(type)?.params ?? []).filter((p) => p.kind !== "separator" && !SECRET.test(p.id)).map((p) => p.kind === "number" ? { id: p.id, kind: "number", min: p.min, max: p.max, default: p.value } : p.kind === "select" ? { id: p.id, kind: "select", options: p.options, default: p.value } : p.kind === "bool" ? { id: p.id, kind: "bool", default: p.value } : { id: p.id, kind: "text", default: p.value });

  return [
    { name: "think", risk: "read", description: "Write down your plan or reasoning before a multi-step task. Shown to the person as your thinking. Has no effect.",
      parameters: obj({ thought: str("Short plan: what you know, what you will check or change, in what order.") }, ["thought"]), run: () => ({ ok: true }) },

    { name: "get_state", risk: "read", description: "Fresh snapshot of the running app: page, selection, setup, problems, workflow summary, tracked game, table, cameras, director, scene, recent events, commentary. Use `sections` to get only some keys.",
      parameters: obj({ sections: { type: "array", items: str("a top-level key such as game, cameras, problems, setup") } }),
      run: (a) => { const s = snapshot(h) as Record<string, unknown>; return Array.isArray(a.sections) && a.sections.length ? Object.fromEntries(a.sections.filter((k: string) => k in s).map((k: string) => [k, s[k]])) : s; } },

    { name: "get_events", risk: "read", description: "Recent game and experience events (move, capture, check, mate, castle, promotion, lifted, illegal, seat, leave, mode, phase…), newest last, with how many seconds ago each happened.",
      parameters: obj({ limit: { type: "number", description: "How many (default 15, max 40)" }, types: { type: "array", items: str("event type to keep") } }),
      run: (a) => { const now = h.now(), want: string[] = Array.isArray(a.types) ? a.types : []; return bus.events.filter((e) => !want.length || want.includes(e.type)).slice(-Math.min(40, Math.max(1, Number(a.limit) || 15))).map((e) => ({ type: e.type, ago_s: Math.round((now - e.t) / 100) / 10, data: e.data })); } },

    { name: "get_setup", risk: "read", description: "The saved setup (cameras, scene, narrators, opponent, projectors, tracking, demo) with API keys blanked, plus the validator's issues.",
      parameters: obj({}), run: () => { const s = h.setup(); return s ? { setup: redact(s), issues: validateSetup(s) } : { setup: null, note: "No setup completed yet. update_setup will start from the defaults." }; } },

    { name: "diagnose", risk: "read", description: "Everything that is wrong or weak right now: setup errors and warnings, nodes throwing errors, offline or poor cameras, a poorly read board. Returns the list and suggested next actions.",
      parameters: obj({}),
      run: () => {
        const p = live(), hints: string[] = [];
        if (p.some((x) => x.field.startsWith("camera") || x.field === "board")) hints.push("Camera trouble: have the person check lighting and glare, re-drag the four board corners in Setup > Board (Negative grid helps), raise trust only for the sharpest camera, or try the IR channel.");
        if (p.some((x) => x.field.startsWith("node"))) hints.push("Open get_node on the failing node, then fix its params or bypass it.");
        return { count: p.length, problems: p, hints: hints.length ? hints : p.length ? [] : ["No problems detected."] };
      } },

    { name: "list_node_types", risk: "read", description: "Look up workflow node types (ports and parameters). Filter with a search word and/or a category.",
      parameters: obj({ query: str("word to search in names, descriptions, ports"), category: str("Source, Vision, Game, Narration, Scene, Output, Tracking, Experience or Effects") }), run: (a) => nodeTypes(h.registry, a.query, a.category) },

    { name: "get_node", risk: "read", description: "One node of the workflow: its type, params (current values) and the allowed parameter ranges/options, its wires and last error.",
      parameters: obj({ id: str("node id") }, ["id"]),
      run: (a) => { const n = node(a.id); if (!n) throw new Error(`No node "${a.id}". Use get_state to see the workflow.`); const g = h.graph(); return { id: n.id, type: n.type, bypass: !!n.bypass, params: redact(n.params), allowed: paramInfo(n.type), wires_in: g.edges.filter((e) => e.to.node === n.id).map((e) => `${e.from.node}.${e.from.port} -> ${e.to.port}`), wires_out: g.edges.filter((e) => e.from.node === n.id).map((e) => `${e.from.port} -> ${e.to.node}.${e.to.port}`), error: h.nodeErrors().find((e) => e.node === n.id) ?? null }; } },

    { name: "update_setup", risk: "write", description: "Change setup settings with a nested patch. Allowed: scene (auto|cavern|winter-forest|fire-watchtower|christmas-forest), rain/snow (-1..1, -1 = scene default), hour (-1..24), narrator{voices 1|2, nameA, nameB, speak, volume 0..1}, ai{engine builtin|openai, model}, voice{engine browser|elevenlabs, voiceIdA, voiceIdB}, opponent{mode menu|engine|human, elo}, projectors{count 0..4, dmx, dmxUrl}, tracking{pose}, demo{autoplay, scenario}. Never keys. Rebuilds the workflow; undoable.",
      parameters: obj({ changes: { type: "object", description: 'e.g. {"scene":"cavern","narrator":{"voices":1}}' } }, ["changes"]),
      run: (a) => commit(patchSetup(h.setup() ?? defaultSetup(), a.changes ?? {}), "Before assistant change") },

    { name: "camera", risk: "write", description: "Add, update or remove a camera in the setup. update.set keys: online, channel (luma|red|green|blue), trust 0..2, fov 10..120, label, corners (\"x,y;x,y;x,y;x,y\" = a8;h8;h1;a1 in 480x360 px). New webcams start offline until a device is chosen in Setup. Rebuilds the workflow; undoable.",
      parameters: obj({ action: str("what to do", { enum: ["add", "update", "remove"] }), id: str("camera id for update/remove, e.g. A"), kind: str("add: virtual or webcam", { enum: ["virtual", "webcam"] }), rig: str("add virtual: A, B or C"), label: str("add webcam: a name"), set: { type: "object", description: "update: the fields to change" } }, ["action"]),
      run: (a) => commit(a.action === "add" ? editCameras(h.setup() ?? defaultSetup(), { action: "add", kind: a.kind === "webcam" ? "webcam" : "virtual", rig: a.rig, label: a.label }) : a.action === "remove" ? editCameras(h.setup() ?? defaultSetup(), { action: "remove", id: a.id }) : editCameras(h.setup() ?? defaultSetup(), { action: "update", id: a.id, set: a.set ?? {} }), `Before assistant camera ${a.action}`) },

    { name: "set_node_param", risk: "write", description: "Set one parameter of one workflow node, clamped to its allowed range or options. Use get_node first to see what is allowed. Secrets are refused.",
      parameters: obj({ node_id: str("node id"), param: str("parameter id"), value: { description: "number, boolean or string", type: ["number", "boolean", "string"] } }, ["node_id", "param", "value"]),
      run: (a) => {
        const n = node(a.node_id); if (!n) throw new Error(`No node "${a.node_id}".`);
        if (SECRET.test(a.param)) throw new Error("Secrets are never set through chat.");
        const def = h.registry.get(n.type)?.params?.find((p) => p.id === a.param);
        if (!def || def.kind === "separator") throw new Error(`${n.type} has no parameter "${a.param}". Allowed: ${paramInfo(n.type).map((p) => p.id).join(", ")}.`);
        const v = clamp(def, a.value); if (v === undefined) throw new Error(`"${a.value}" is not valid for ${a.param}: ${JSON.stringify(paramInfo(n.type).find((p) => p.id === a.param))}`);
        const was = n.params[a.param]; h.setParam(n.id, a.param, v);
        return { node: n.id, param: a.param, was, now: v, clamped: v !== a.value, problems_now: live() };
      } },

    { name: "set_bypass", risk: "write", description: "Turn a node off (bypass: it is skipped, not deleted) or back on.",
      parameters: obj({ node_id: str("node id"), bypass: { type: "boolean" } }, ["node_id", "bypass"]),
      run: (a) => { if (!h.setBypass(a.node_id, !!a.bypass)) throw new Error(`No node "${a.node_id}".`); return { node: a.node_id, bypass: !!a.bypass }; } },

    { name: "apply_workflow", risk: "danger", description: "Replace the WHOLE workflow with one you design. Pass the draft: {name, summary, nodes:[{id,type,params}], edges:[{from:'node.outPort',to:'node.inPort'}]}. Use list_node_types for valid types and ports; prefer update_setup for ordinary changes. The person is asked to approve; the old one is backed up.",
      parameters: obj({ draft: { type: "object", description: "the workflow draft" } }, ["draft"]),
      describe: (a) => `Replace the whole workflow with "${a?.draft?.name ?? "a new workflow"}" (${a?.draft?.nodes?.length ?? 0} nodes). The current one is backed up and Ctrl+Z restores it.`,
      run: (a) => {
        const d: Draft | null = typeof a.draft === "string" ? parseDraft(a.draft) : a.draft;
        const b = draftToGraph(h.registry, d ?? {});
        if (!b.graph.nodes.length) throw new Error(`No usable nodes in the draft. ${b.warnings.slice(0, 5).join(" ")}`);
        h.applyGraph(b.graph, `Before assistant workflow: ${b.name}`);
        return { applied: b.name, nodes: b.graph.nodes.length, wires: b.graph.edges.length, left_out: b.warnings.slice(0, 8), problems_now: live() };
      } },

    { name: "navigate", risk: "write", description: "Show a page of the app: table, world (3D / mapping), log, perf, assistant, or the setup wizard (optionally at a step id such as cameras, board, scenes, narration, opponent, room, launch).",
      parameters: obj({ page: str("where to go", { enum: [...PAGES, "setup"] }), step: str("setup step id") }, ["page"]),
      run: (a) => { h.go(a.page === "setup" ? { page: "setup", step: a.step ?? null } : { page: a.page }); return { now_on: h.route() }; } },

    { name: "table_play", risk: "write", description: "Play a move on the VIRTUAL table (simulated hand, seen by the simulated cameras). SAN (Nf3) or UCI (g1f3). Only for the virtual table, never a real board.",
      parameters: obj({ move: str("SAN or UCI move") }, ["move"]),
      run: (a) => { if (!h.table.play(a.move)) throw new Error(`"${a.move}" is not legal here. Legal moves: ${h.table.legal().join(" ")}`); return { played: a.move, fen_before: h.table.fen() }; } },

    { name: "table_seat", risk: "write", description: "Seat or stand up the simulated player (the cameras and tracking then see a person at the table).",
      parameters: obj({ seated: { type: "boolean" } }, ["seated"]), run: (a) => { h.table.seat(!!a.seated); return { seated: !!a.seated }; } },

    { name: "table_reset", risk: "danger", description: "Put every piece of the virtual table back on its starting square (ends the current simulated game).",
      parameters: obj({}), describe: () => "Reset the virtual table to the starting position. The current simulated game is lost.", run: () => { h.table.reset(); return { reset: true }; } },

    { name: "undo", risk: "write", description: "Undo the last change to the workflow (the same as Ctrl+Z).", parameters: obj({}), run: () => ({ undone: h.undo(), can_undo_more: h.canUndo() }) },
    { name: "redo", risk: "write", description: "Redo what was undone.", parameters: obj({}), run: () => ({ redone: h.redo() }) },

    { name: "wait_for_event", risk: "read", description: "Wait (async) until the next matching game event happens, e.g. the next move, a capture, or mate, then return it. Gives up after timeout_s (max 45). Use it to follow the game live or to confirm a change worked.",
      parameters: obj({ types: { type: "array", items: str("event type, e.g. move, capture, mate, illegal"), description: "empty = any event" }, timeout_s: { type: "number", description: "default 20" } }),
      run: async (a, ctx) => {
        const want: string[] = Array.isArray(a.types) ? a.types : [], limit = Math.min(45, Math.max(1, Number(a.timeout_s) || 20)) * 1000;
        const from = bus.events.reduce((m, e) => Math.max(m, e.t), -Infinity), t0 = Date.now();
        while (Date.now() - t0 < limit) {
          if (ctx.signal.aborted) throw new DOMException("Stopped", "AbortError");
          const hit = bus.events.find((e) => e.t > from && (!want.length || want.includes(e.type)));
          if (hit) return { event: { type: hit.type, data: hit.data }, waited_s: Math.round((Date.now() - t0) / 100) / 10, game: bus.game ? { fen: bus.game.fen, turn: bus.game.turn, ply: bus.game.ply } : null };
          await new Promise<void>((r) => { const t = setTimeout(r, 150); ctx.signal.addEventListener("abort", () => { clearTimeout(t); r(); }, { once: true }); }); // wakes at once on Stop
        }
        return { timed_out: true, waited_s: limit / 1000, game: bus.game ? { fen: bus.game.fen, ply: bus.game.ply } : null };
      } },

    { name: "ask_user", risk: "read", description: "Ask the person to choose between 2 to 4 short options (they may also type their own answer). Use only for a genuine fork you cannot resolve from the state.",
      parameters: obj({ question: str("one short question"), options: { type: "array", items: str("a short option"), minItems: 2, maxItems: 4 } }, ["question", "options"]),
      run: async (a, ctx) => ({ answer: await ctx.choose(String(a.question), (Array.isArray(a.options) ? a.options : []).slice(0, 4).map(String)) }) },

    { name: "list_scenarios", risk: "read", description: "Scripted demo games that can be played without a camera (use update_setup demo.scenario / demo.autoplay).",
      parameters: obj({}), run: () => SCENARIOS.map((s) => ({ id: s.id, name: s.name, plies: s.moves.length, about: s.description })) },
  ];
}
