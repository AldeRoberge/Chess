import type { GraphJSON, ParamDef, ParamValues, Registry } from "../core/types";
import { Graph } from "../core/graph";
import { organize } from "../core/groups";
import { WORKFLOWS } from "./index";

/** What the model is asked to return. Wires are "nodeId.portId". */
export interface Draft { name?: string; summary?: string; nodes?: { id?: string; type?: string; x?: number; y?: number; params?: Record<string, unknown> }[]; edges?: { from?: string; to?: string }[] }
export interface Built { name: string; summary: string; graph: GraphJSON; warnings: string[] }
export interface Msg { role: "system" | "user" | "assistant"; content: string }

export const AI_DEFAULT_MODEL = "gpt-4.1-mini";
const SECRET = /key|token|secret|password/i;

const paramText = (p: ParamDef) =>
  p.kind === "number" ? `${p.id}:number ${p.min}..${p.max} (default ${p.value})`
    : p.kind === "select" ? `${p.id}:one of ${p.options.join("|")} (default ${p.value})`
      : p.kind === "bool" ? `${p.id}:boolean (default ${p.value})` : `${p.id}:text`;

/** One line per node type: everything the model may use, and nothing it may not. */
export function catalog(reg: Registry): string {
  return reg.all().map((s) => {
    const ports = (l: { id: string; type: string }[]) => l.map((p) => `${p.id}:${p.type}`).join(", ") || "-";
    const params = (s.params ?? []).filter((p) => p.kind !== "separator" && !SECRET.test(p.id)).map(paramText).join("; ") || "-";
    return `- ${s.type} [${s.category}] "${s.title}"${s.desc ? ` - ${s.desc}` : ""}\n    in: ${ports(s.inputs)}\n    out: ${ports(s.outputs)}\n    params: ${params}`;
  }).join("\n");
}

/** A graph in the compact shape the model reads and writes. Secret-looking params never leave the machine. */
export function toDraft(g: GraphJSON, name = "", summary = ""): Draft {
  return {
    name, summary,
    nodes: g.nodes.map((n) => ({ id: n.id, type: n.type, params: Object.fromEntries(Object.entries(n.params).filter(([k]) => !SECRET.test(k))) })),
    edges: g.edges.map((e) => ({ from: `${e.from.node}.${e.from.port}`, to: `${e.to.node}.${e.to.port}` })),
  };
}

export function systemPrompt(reg: Registry): string {
  const ex = WORKFLOWS[0];
  return [
    "You design node-graph workflows for CE, a real-time chess table: cameras read a physical board, a tracker follows the game, and narration, scenes and projection react to it.",
    "Reply with ONE JSON object and nothing else: {\"name\": string, \"summary\": string (1-2 sentences), \"nodes\": [{\"id\": string, \"type\": string, \"params\": object}], \"edges\": [{\"from\": \"nodeId.outPort\", \"to\": \"nodeId.inPort\"}]}.",
    "Rules: use ONLY node types and port ids from the catalog. A wire joins an output port to an input port of the same type (type 'any' joins anything). Each input port takes at most one wire. Never wire a node to itself. Give short unique ids. Only set params you want to change; keep values inside their stated range or options. Do not invent API keys; leave key params out. Prefer the smallest graph that does what was asked.",
    "Typical chain: source.* -> vision.boardReader -> vision.fuse -> vision.stabilize -> game.tracker; game.tracker.events feed narration.narrator / scene.cues; sim.scenario.events -> game.tracker.control plays a scripted game with no camera. Virtual cameras need a world.virtual.world input; sim.scenario.actions feed two sim.player nodes (white, black), which wire into world.virtual.white / .black.",
    "Catalog:\n" + catalog(reg),
    "Example (a minimal working workflow):\n" + JSON.stringify(toDraft(ex.graph, ex.name, ex.description)),
  ].join("\n\n");
}

export const clamp = (p: ParamDef, v: unknown): ParamValues[string] | undefined => {
  if (p.kind === "number") { const n = Number(v); return Number.isFinite(n) ? Math.min(p.max, Math.max(p.min, n)) : undefined; }
  if (p.kind === "bool") return typeof v === "boolean" ? v : v === "true" ? true : v === "false" ? false : undefined;
  if (p.kind === "select") return p.options.includes(String(v)) ? String(v) : undefined;
  return typeof v === "string" ? v : undefined;
};

/** Turns a model draft into a real workflow by running it through the graph's own rules; anything invalid is dropped and reported. */
export function draftToGraph(reg: Registry, d: Draft): Built {
  const warnings: string[] = [], g = new Graph(reg), ids = new Map<string, string>();
  for (const n of Array.isArray(d.nodes) ? d.nodes : []) {
    const spec = typeof n?.type === "string" ? reg.get(n.type) : undefined;
    if (!spec) { warnings.push(`Skipped unknown node type "${n?.type}".`); continue; }
    const params: ParamValues = {};
    for (const [k, v] of Object.entries(n.params ?? {})) {
      const def = spec.params?.find((p) => p.id === k), val = def && !SECRET.test(k) ? clamp(def, v) : undefined;
      if (val === undefined) warnings.push(`${spec.title}: ignored parameter "${k}".`); else params[k] = val;
    }
    const node = g.addNode(spec.type, 0, 0, params);
    ids.set(String(n.id ?? node.id), node.id);
  }
  const ref = (s: unknown) => { const [a, ...b] = String(s ?? "").split("."); const id = ids.get(a); return id ? { node: id, port: b.join(".") } : null; };
  for (const e of Array.isArray(d.edges) ? d.edges : []) {
    const from = ref(e?.from), to = ref(e?.to);
    if (!from || !to || !g.connect(from, to)) warnings.push(`Skipped wire ${e?.from} -> ${e?.to} (unknown node or port, or the types do not match).`);
  }
  const graph = g.toJSON(); organize(graph);
  return { name: String(d.name || "AI workflow").slice(0, 80), summary: String(d.summary ?? "").slice(0, 400), graph, warnings };
}

export const parseDraft = (raw: string): Draft | null => {
  try { const j = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")); return j && typeof j === "object" ? (j as Draft) : null; } catch { return null; }
};

export interface AiOptions { apiKey: string; model: string; timeoutMs?: number }

/** One chat round-trip. Returns the model's raw reply; throws on HTTP errors, timeouts and empty replies. */
export async function chat(messages: Msg[], o: AiOptions, doFetch: typeof fetch = fetch): Promise<string> {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? 90000);
  try {
    const r = await doFetch("https://api.openai.com/v1/chat/completions", {
      method: "POST", signal: ctl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${o.apiKey.trim()}` },
      body: JSON.stringify({ model: o.model || AI_DEFAULT_MODEL, messages, response_format: { type: "json_object" }, temperature: 0.2 }),
    });
    if (!r.ok) throw new Error(r.status === 401 ? "OpenAI rejected the API key (401)." : `OpenAI error ${r.status}.`);
    const text = (await r.json())?.choices?.[0]?.message?.content;
    if (!text) throw new Error("The model returned an empty reply.");
    return String(text);
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw new Error("The request timed out.");
    throw e;
  } finally { clearTimeout(timer); }
}

/** The conversation behind the wizard: first request, then optional revisions of the model's own last answer. */
export class AiSession {
  private msgs: Msg[];
  constructor(private reg: Registry, private opts: AiOptions, private base?: GraphJSON, private doFetch: typeof fetch = fetch) {
    this.msgs = [{ role: "system", content: systemPrompt(reg) }];
  }

  async ask(request: string): Promise<Built> {
    const first = this.msgs.length === 1;
    const content = first && this.base ? `Start from this existing workflow and modify it as requested.\nCurrent workflow: ${JSON.stringify(toDraft(this.base))}\nRequest: ${request}` : first ? `Request: ${request}` : `Revise your last workflow: ${request}`;
    const next = [...this.msgs, { role: "user" as const, content }];
    const raw = await chat(next, this.opts, this.doFetch);
    const draft = parseDraft(raw);
    if (!draft) throw new Error("The model did not return valid JSON. Try again.");
    const built = draftToGraph(this.reg, draft);
    if (!built.graph.nodes.length) throw new Error("The model produced no usable nodes. Describe what you want in more detail.");
    this.msgs = [...next, { role: "assistant", content: raw }];
    return built;
  }
}

const KEY = "cx.ai.v1";
export interface AiSettings { apiKey: string; model: string; remember: boolean }
export function loadAiSettings(): AiSettings {
  try { const j = JSON.parse(localStorage.getItem(KEY) ?? "null"); return { apiKey: String(j?.apiKey ?? ""), model: String(j?.model || AI_DEFAULT_MODEL), remember: !!j?.remember }; } catch { return { apiKey: "", model: AI_DEFAULT_MODEL, remember: false }; }
}
/** The key is stored only when "remember" is on; the model choice is always kept. */
export function saveAiSettings(s: AiSettings) {
  try { localStorage.setItem(KEY, JSON.stringify({ model: s.model, remember: s.remember, apiKey: s.remember ? s.apiKey : "" })); } catch { /* storage unavailable */ }
}
