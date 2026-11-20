import { portsCompatible, type GraphJSON, type NodeInstance } from "../../core/types";
import { clamp } from "../../workflows/ai";
import { publicNodeParams, SECRET, type AssistantHost } from "../host";
import { problems } from "../snapshot";
import { obj, str, type ToolGroup } from "./shared";

const idsSchema = { type: "array", items: str("existing node id"), minItems: 1, maxItems: 50 };
const number = (description: string) => ({ type: "number", description });
const clone = (h: AssistantHost) => structuredClone(h.graph());
const node = (g: GraphJSON, id: string) => { const n = g.nodes.find(n => n.id === id); if (!n) throw new Error(`No node "${id}". Read get_workflow first.`); return n; };
const uid = (g: GraphJSON, prefix: string) => { const used = new Set([...g.nodes, ...g.edges, ...(g.groups ?? [])].map(x => x.id)); let i = 1; while (used.has(`${prefix}${i}`)) i++; return `${prefix}${i}`; };
const finite = (v: unknown, fallback: number) => { if (v === undefined) return fallback; if (typeof v !== "number" || !Number.isFinite(v)) throw new Error("Coordinates must be finite numbers."); return v; };
const ids = (h: AssistantHost, a: any, g: GraphJSON) => {
  const result = a.node_ids === undefined ? h.selection() : a.node_ids;
  if (!Array.isArray(result) || !result.length || result.length > 50 || result.some(id => typeof id !== "string")) throw new Error("Supply 1–50 node_ids or select nodes first.");
  const unique = [...new Set<string>(result)]; unique.forEach(id => node(g, id)); return unique;
};
const commit = (h: AssistantHost, g: GraphJSON) => {
  if (!h.editGraph) throw new Error("Incremental graph editing is unavailable in this session.");
  h.editGraph(g);
  return { problems_now: problems(h), undo: "Ctrl+Z" };
};
const port = (description: string) => str(description);

/** Edits operate on JSON, validate completely before commit, and never instantiate a second camera or tracker. */
export const graphTools: ToolGroup = h => [
  { name: "get_workflow", risk: "read", label: { doing: "Reading the workflow", done: "Read the workflow" },
    description: "The real workflow topology: node ids, titles, locations, typed input/output ports, current non-secret parameters, wires and groups. Search ids/types/titles, or request a page. Use these ids when asked to link or duplicate nodes.",
    parameters: obj({ query: str("id, type, title or category"), offset: number("default 0"), limit: number("default 10, max 20") }),
    run: a => {
      const g = h.graph(), q = String(a.query ?? "").toLowerCase();
      const found = g.nodes.filter(n => `${n.id} ${n.type} ${h.registry.get(n.type)?.title} ${h.registry.get(n.type)?.category}`.toLowerCase().includes(q));
      const offset = Math.max(0, Math.floor(Number(a.offset) || 0)), limit = Math.max(1, Math.min(20, Math.floor(Number(a.limit) || 10)));
      const page = found.slice(offset, offset + limit), set = new Set(page.map(n => n.id));
      return { total: found.length, next_offset: offset + page.length < found.length ? offset + page.length : null,
        nodes: page.map(n => { const spec = h.registry.get(n.type); return { ...n, params: publicNodeParams(h.registry, n), title: spec?.title, inputs: spec?.inputs, outputs: spec?.outputs }; }),
        wires: g.edges.filter(e => set.has(e.from.node) || set.has(e.to.node)), groups: g.groups ?? [], selected: h.selection() };
    } },
  { name: "add_node", risk: "write", undoable: true, description: "Add one node of a registered type. Parameter values are validated. Does not connect it automatically. Undoable; existing cameras and game state are kept.",
    parameters: obj({ type: str("registered node type from list_node_types"), x: number("graph x, default 0"), y: number("graph y, default 0"), params: { type: "object", description: "optional non-secret parameter values" } }, ["type"]),
    run: a => {
      const spec = h.registry.get(a.type); if (!spec) throw new Error(`Unknown node type "${a.type}".`);
      const g = clone(h), params: NodeInstance["params"] = {};
      for (const p of spec.params ?? []) params[p.id] = p.value;
      for (const [key, value] of Object.entries(a.params ?? {})) {
        const p = spec.params?.find(p => p.id === key);
        if (SECRET.test(key) || (p?.kind === "text" && p.secret)) throw new Error("Secrets cannot be set through chat.");
        if (!p || p.kind === "separator") throw new Error(`Unknown parameter "${key}".`);
        const v = clamp(p, value); if (v === undefined) throw new Error(`Invalid value for ${key}.`); params[key] = v;
      }
      const n = { id: uid(g, "n"), type: spec.type, x: finite(a.x, 0), y: finite(a.y, 0), params }; g.nodes.push(n);
      return { created: { ...n, params: publicNodeParams(h.registry, n) }, ...commit(h, g) };
    } },
  { name: "duplicate_nodes", risk: "write", undoable: true, description: "Duplicate the specified or selected nodes with the same settings, offset by 40px. Optionally copy wires BETWEEN the duplicated nodes; never steals existing input wires. Secrets remain internal and are not returned.",
    parameters: obj({ node_ids: idsSchema, include_internal_wires: { type: "boolean" }, dx: number("offset x, default 40"), dy: number("offset y, default 40") }),
    run: a => {
      const g = clone(h), selected = ids(h, a, g), originals = [...g.edges], mapping: Record<string, string> = Object.create(null);
      const dx = finite(a.dx, 40), dy = finite(a.dy, 40);
      for (const id of selected) { const n = node(g, id), copy = { ...n, params: { ...n.params }, id: uid(g, "n"), x: n.x + dx, y: n.y + dy }; mapping[id] = copy.id; g.nodes.push(copy); }
      if (a.include_internal_wires) for (const e of originals) if (mapping[e.from.node] && mapping[e.to.node]) g.edges.push({ id: uid(g, "e"), from: { node: mapping[e.from.node], port: e.from.port }, to: { node: mapping[e.to.node], port: e.to.port } });
      return { duplicated: mapping, ...commit(h, g) };
    } },
  { name: "remove_nodes", risk: "write", undoable: true, description: "Remove the specified or selected nodes and their incident wires. Undoable. Use only when requested.", parameters: obj({ node_ids: idsSchema }),
    run: a => { const g = clone(h), selected = new Set(ids(h, a, g)); g.nodes = g.nodes.filter(n => !selected.has(n.id)); g.edges = g.edges.filter(e => !selected.has(e.from.node) && !selected.has(e.to.node)); return { removed: [...selected], ...commit(h, g) }; } },
  { name: "move_nodes", risk: "write", undoable: true, description: "Move specified or selected nodes by a graph-coordinate offset. Does not reset their runtime state.", parameters: obj({ node_ids: idsSchema, dx: number("horizontal offset"), dy: number("vertical offset") }, ["dx", "dy"]),
    run: a => { const g = clone(h), selected = ids(h, a, g), dx = finite(a.dx, 0), dy = finite(a.dy, 0); for (const id of selected) { const n = node(g, id); n.x += dx; n.y += dy; } return { moved: selected, ...commit(h, g) }; } },
  { name: "connect_nodes", risk: "write", undoable: true, description: "Connect two existing nodes. Supply port ids, or omit them ONLY when one compatible pair exists. Returns candidates for ambiguity without changing anything. Occupied input requires replace=true. Input and output types must match (or any). Feedback is allowed by the app; self-links are not.",
    parameters: obj({ from_node: str("source node id"), to_node: str("destination node id"), from_port: port("output port id"), to_port: port("input port id"), replace: { type: "boolean", description: "explicitly replace an occupied input wire" } }, ["from_node", "to_node"]),
    run: a => {
      const g = clone(h), from = node(g, a.from_node), to = node(g, a.to_node);
      if (from.id === to.id) throw new Error("A node cannot connect to itself.");
      const outputs = h.registry.get(from.type)?.outputs ?? [], inputs = h.registry.get(to.type)?.inputs ?? [];
      const candidates = outputs.flatMap(out => inputs.filter(inp => portsCompatible(out.type, inp.type) && (!a.from_port || out.id === a.from_port) && (!a.to_port || inp.id === a.to_port)).map(inp => ({ from_port: out.id, to_port: inp.id, type: out.type })));
      if (!candidates.length) throw new Error("No compatible output/input ports. Inspect both nodes with get_node.");
      if (candidates.length !== 1) return { changed: false, candidates, note: "Choose exact ports; nothing changed." };
      const pair = candidates[0], occupied = g.edges.find(e => e.to.node === to.id && e.to.port === pair.to_port);
      if (occupied?.from.node === from.id && occupied.from.port === pair.from_port) return { changed: false, already_connected: occupied };
      if (occupied && a.replace !== true) return { changed: false, occupied, note: "This input already has a wire. Use replace=true only if replacing it is intended." };
      g.edges = g.edges.filter(e => e.id !== occupied?.id);
      const edge = { id: uid(g, "e"), from: { node: from.id, port: pair.from_port }, to: { node: to.id, port: pair.to_port } }; g.edges.push(edge);
      return { connected: edge, replaced: occupied ?? null, ...commit(h, g) };
    } },
  { name: "disconnect_nodes", risk: "write", undoable: true, description: "Disconnect exactly one wire by its id from get_workflow/get_node. Keeps both nodes and their runtime state.", parameters: obj({ edge_id: str("wire id") }, ["edge_id"]),
    run: a => { const g = clone(h), e = g.edges.find(e => e.id === a.edge_id); if (!e) throw new Error(`No wire "${a.edge_id}".`); g.edges = g.edges.filter(e => e.id !== a.edge_id); return { disconnected: e, ...commit(h, g) }; } },
  { name: "reveal_node", risk: "write", description: "Show the node editor and focus a node, so the person can find its controls.", parameters: obj({ node_id: str("node id") }, ["node_id"]),
    run: a => { node(h.graph(), a.node_id); if (!h.revealNode) throw new Error("Focusing nodes is unavailable here."); h.revealNode(a.node_id); return { revealed: a.node_id }; } },
];
