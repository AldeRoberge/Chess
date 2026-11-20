import { bus } from "../../core/bus";
import type { Registry } from "../../core/types";
import { validateSetup } from "../../setup/config";
import { SCENARIOS } from "../../sim/scenarios";
import { catalog } from "../../workflows/ai";
import { PARAM_DOCS } from "../../ui/paramDocs";
import { publicNodeParams, redact } from "../host";
import { problems, snapshot } from "../snapshot";
import { SECRET, obj, str, type ToolGroup } from "./shared";

/** One line per node type, narrowed by a search word, so the model can look things up without carrying the whole catalog. */
export function nodeTypes(reg: Registry, query = "", category = ""): string {
  const q = query.toLowerCase().trim(), c = category.toLowerCase().trim();
  const lines = catalog(reg).split(/\n(?=- )/).filter((b) => (!q || b.toLowerCase().includes(q)) && (!c || b.toLowerCase().includes(`[${c}]`)));
  return lines.length ? lines.slice(0, 12).join("\n") + (lines.length > 12 ? `\n(${lines.length - 12} more: narrow the search)` : "") : "No node type matches. Try a shorter word, or list a category (Source, Vision, Game, Narration, Scene, Output, Tracking, Experience, Effects).";
}

/** What a node's parameters accept, without the secret ones. */
export const paramInfo = (reg: Registry, type: string) => (reg.get(type)?.params ?? []).filter((p) => p.kind !== "separator" && !SECRET.test(p.id) && !(p.kind === "text" && p.secret)).map((p) => ({ label: p.label, about: PARAM_DOCS[`${type}.${p.id}`], ...(p.kind === "number" ? { id: p.id, kind: "number", min: p.min, max: p.max, default: p.value } : p.kind === "select" ? { id: p.id, kind: "select", options: p.options, default: p.value } : p.kind === "bool" ? { id: p.id, kind: "bool", default: p.value, action: !!p.action } : { id: p.id, kind: "text", default: p.value }) }));

/** Read-only tools: nothing here changes the app. */
export const inspectTools: ToolGroup = (h) => [
  { name: "think", risk: "read", label: { doing: "Planning", done: "Planned the next actions" }, description: "State a short action plan before a multi-step task: what you will inspect and change. Shown to the person. Do not include private internal reasoning. Has no effect.",
    parameters: obj({ thought: str("Short plan: what you know, what you will check or change, in what order.") }, ["thought"]), run: () => ({ ok: true }) },

  { name: "get_state", risk: "read", label: { doing: "Looking at the app", done: "Looked at the app" }, description: "Fresh snapshot of the running app: page, selection, setup, problems, workflow summary, tracked game, table, cameras, director, scene, recent events, commentary. Use `sections` to get only some keys.",
    parameters: obj({ sections: { type: "array", items: str("a top-level key such as game, cameras, problems, setup") } }),
    run: (a) => { const s = snapshot(h) as Record<string, unknown>; return Array.isArray(a.sections) && a.sections.length ? Object.fromEntries(a.sections.filter((k: string) => k in s).map((k: string) => [k, s[k]])) : s; } },

  { name: "get_events", risk: "read", label: { doing: "Reading recent events", done: "Read recent events" }, description: "Recent game and experience events (move, capture, check, mate, castle, promotion, lifted, illegal, seat, leave, mode, phase…), newest last, with how many seconds ago each happened.",
    parameters: obj({ limit: { type: "number", description: "How many (default 15, max 40)" }, types: { type: "array", items: str("event type to keep") } }),
    run: (a) => { const now = h.now(), want: string[] = Array.isArray(a.types) ? a.types : []; return bus.events.filter((e) => !want.length || want.includes(e.type)).slice(-Math.min(40, Math.max(1, Number(a.limit) || 15))).map((e) => ({ type: e.type, ago_s: Math.round((now - e.t) / 100) / 10, data: e.data })); } },

  { name: "get_setup", risk: "read", label: { doing: "Reading the setup", done: "Read the setup" }, description: "The saved setup (cameras, scene, narrators, opponent, projectors, tracking, demo) with API keys blanked, plus the validator's issues.",
    parameters: obj({}), run: () => { const s = h.setup(); return s ? { setup: redact(s), issues: validateSetup(s) } : { setup: null, note: "No setup completed yet. update_setup will start from the defaults." }; } },

  { name: "diagnose", risk: "read", label: { doing: "Diagnosing", done: "Diagnosed" }, description: "Everything that is wrong or weak right now: setup errors and warnings, nodes throwing errors, offline or poor cameras, a poorly read board. Returns the list and suggested next actions.",
    parameters: obj({}),
    run: () => {
      const p = problems(h), hints: string[] = [];
      if (p.some((x) => x.field.startsWith("camera") || x.field === "board")) hints.push("Camera trouble: have the person check lighting and glare, re-drag the four board corners in Setup > Board (Negative grid helps), raise trust only for the sharpest camera, or try the IR channel.");
      if (p.some((x) => x.field.startsWith("node"))) hints.push("Open get_node on the failing node, then fix its params or bypass it.");
      return { count: p.length, problems: p, hints: hints.length ? hints : p.length ? [] : ["No problems detected."] };
    } },

  { name: "list_node_types", risk: "read", label: { doing: "Looking up node types", done: "Looked up node types" }, description: "Look up workflow node types (ports and parameters). Filter with a search word and/or a category.",
    parameters: obj({ query: str("word to search in names, descriptions, ports"), category: str("Source, Vision, Game, Narration, Scene, Output, Tracking, Experience or Effects") }), run: (a) => nodeTypes(h.registry, a.query, a.category) },

  { name: "get_node", risk: "read", label: { doing: "Inspecting a node", done: "Inspected a node" }, description: "One node of the workflow: its type, params (current values) and the allowed parameter ranges/options, its wires and last error.",
    parameters: obj({ id: str("node id") }, ["id"]),
    run: (a) => {
      const g = h.graph(), n = g.nodes.find((x) => x.id === a.id);
      if (!n) throw new Error(`No node "${a.id}". Use get_state to see the workflow.`);
      const spec = h.registry.get(n.type);
      return { id: n.id, type: n.type, title: spec?.title, description: spec?.desc, inputs: spec?.inputs, outputs: spec?.outputs, bypass: !!n.bypass, params: publicNodeParams(h.registry, n), allowed: paramInfo(h.registry, n.type), wires: g.edges.filter(e => e.from.node === n.id || e.to.node === n.id), wires_in: g.edges.filter((e) => e.to.node === n.id).map((e) => `${e.from.node}.${e.from.port} -> ${e.to.port}`), wires_out: g.edges.filter((e) => e.from.node === n.id).map((e) => `${e.from.port} -> ${e.to.node}.${e.to.port}`), error: h.nodeErrors().find((e) => e.node === n.id) ?? null };
    } },

  { name: "list_scenarios", risk: "read", label: { doing: "Listing demo games", done: "Listed demo games" }, description: "Scripted demo games that can be played without a camera (use update_setup demo.scenario / demo.autoplay).",
    parameters: obj({}), run: () => SCENARIOS.map((s) => ({ id: s.id, name: s.name, plies: s.moves.length, about: s.description })) },
];
