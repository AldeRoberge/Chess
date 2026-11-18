import { profiler } from "./profiler";
import { Registry, portsCompatible, type Edge, type GraphJSON, type GroupDef, type NodeInstance, type NodeRuntime, type ParamValues } from "./types";

export interface NodeStats {
  ms: number;
  fidelity: number | null;
  error?: string;
}

/**
 * Pull-free, push-ordered evaluation: every tick, nodes run in topological order and
 * outputs are cached so back-edges (feedback) read the previous tick's value.
 */
export class Graph {
  /** Visual sections (see GroupDef); they do not affect evaluation. */
  groups: GroupDef[] = [];
  nodes = new Map<string, NodeInstance>();
  edges: Edge[] = [];
  outputs = new Map<string, Record<string, any>>();
  states = new Map<string, any>();
  stats = new Map<string, NodeStats>();
  private order: string[] = [];
  private incoming = new Map<string, Edge[]>();
  private dirty = true;
  private last: number | null = null;
  private seq = 1;
  listeners = new Set<(node: string, event: string, payload: unknown) => void>();

  constructor(public registry: Registry) {}

  /** Next free id. Skips ids already in use, so nodes loaded from a save can never be overwritten by new ones. */
  uid(prefix = "n") {
    let id: string;
    do id = `${prefix}${this.seq++}`; while (this.nodes.has(id) || this.edges.some((e) => e.id === id));
    return id;
  }

  addNode(type: string, x = 0, y = 0, params: ParamValues = {}, id = this.uid()): NodeInstance {
    const spec = this.registry.get(type);
    if (!spec) throw new Error(`unknown node type ${type}`);
    const defaults: ParamValues = {};
    for (const p of spec.params ?? []) defaults[p.id] = p.value;
    const node: NodeInstance = { id, type, x, y, params: { ...defaults, ...params } };
    this.nodes.set(id, node);
    this.states.set(id, spec.init?.());
    this.dirty = true;
    return node;
  }

  removeNode(id: string) {
    const n = this.nodes.get(id);
    if (!n) return;
    this.registry.get(n.type)?.dispose?.(this.states.get(id));
    this.nodes.delete(id);
    this.states.delete(id);
    this.outputs.delete(id);
    this.stats.delete(id);
    profiler.forgetNode(id);
    this.edges = this.edges.filter((e) => e.from.node !== id && e.to.node !== id);
    this.dirty = true;
  }

  canConnect(from: { node: string; port: string }, to: { node: string; port: string }) {
    if (from.node === to.node) return false;
    const a = this.nodes.get(from.node);
    const b = this.nodes.get(to.node);
    if (!a || !b) return false;
    const out = this.registry.get(a.type)?.outputs.find((p) => p.id === from.port);
    const inp = this.registry.get(b.type)?.inputs.find((p) => p.id === to.port);
    return !!out && !!inp && portsCompatible(out.type, inp.type);
  }

  connect(from: { node: string; port: string }, to: { node: string; port: string }) {
    if (!this.canConnect(from, to)) return null;
    // one wire per input port
    this.edges = this.edges.filter((e) => !(e.to.node === to.node && e.to.port === to.port));
    const edge: Edge = { id: this.uid("e"), from, to };
    this.edges.push(edge);
    this.dirty = true;
    return edge;
  }

  disconnect(edgeId: string) {
    this.edges = this.edges.filter((e) => e.id !== edgeId);
    this.dirty = true;
  }

  private computeOrder() {
    const indeg = new Map<string, number>();
    for (const id of this.nodes.keys()) indeg.set(id, 0);
    for (const e of this.edges) indeg.set(e.to.node, indeg.get(e.to.node)! + 1);
    const queue = [...indeg].filter(([, d]) => d === 0).map(([id]) => id);
    const outEdges = new Map<string, Edge[]>();
    for (const e of this.edges) { const l = outEdges.get(e.from.node); if (l) l.push(e); else outEdges.set(e.from.node, [e]); }
    const out: string[] = [];
    const left = new Map(indeg);
    for (let qi = 0; qi < queue.length; qi++) {
      const id = queue[qi];
      out.push(id);
      for (const e of outEdges.get(id) ?? []) {
        const d = left.get(e.to.node)! - 1;
        left.set(e.to.node, d);
        if (d === 0) queue.push(e.to.node);
      }
    }
    // nodes left over sit on a cycle: run them last, reading cached outputs
    const seen = new Set(out);
    for (const id of this.nodes.keys()) if (!seen.has(id)) out.push(id);
    this.order = out;
    this.incoming.clear();
    for (const e of this.edges) { const l = this.incoming.get(e.to.node); if (l) l.push(e); else this.incoming.set(e.to.node, [e]); }
    this.dirty = false;
  }

  tick(now: number) {
    if (this.dirty) this.computeOrder();
    const dt = this.last === null ? 0 : Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    for (const id of this.order) {
      const node = this.nodes.get(id)!;
      const spec = this.registry.get(node.type)!;
      const inputs: Record<string, any> = {};
      for (const e of this.incoming.get(id) ?? []) inputs[e.to.port] = this.outputs.get(e.from.node)?.[e.from.port];
      let fidelity: number | null = null;
      const rt: NodeRuntime = {
        dt,
        now,
        params: node.params,
        state: this.states.get(id),
        setFidelity: (v) => (fidelity = v),
        emit: (event, payload) => this.listeners.forEach((l) => l(id, event, payload)),
        span: (name, fn) => profiler.span(name, fn, id),
      };
      profiler.begin(spec.title, id);
      const t0 = performance.now();
      try {
        if (node.bypass) {
          this.outputs.set(id, {});
        } else {
          const res = spec.process(inputs, rt);
          if (res) this.outputs.set(id, res);
        }
        this.stats.set(id, { ms: performance.now() - t0, fidelity });
      } catch (err) {
        this.stats.set(id, { ms: performance.now() - t0, fidelity: null, error: String(err) });
      }
      profiler.end();
      profiler.recordNode(id, this.stats.get(id)!.ms);
    }
  }

  /** Latest values arriving on a node's input ports (what a bypassed node is being fed). */
  inputValues(id: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const e of this.edges) if (e.to.node === id) out[e.to.port] = this.outputs.get(e.from.node)?.[e.from.port];
    return out;
  }

  toJSON(): GraphJSON {
    return { nodes: [...this.nodes.values()].map((n) => ({ ...n })), edges: this.edges.map((e) => ({ ...e })), groups: this.groups.map((g) => ({ ...g })) };
  }

  /**
   * Move the graph to `json` in place (undo / redo). Nodes that exist in both keep their runtime state: a webcam
   * stays open and the game tracker keeps its position, so stepping back through a node move or a wire change
   * never restarts anything. Only nodes that truly appear or disappear are created or disposed.
   */
  restore(json: GraphJSON) {
    const want = new Map(json.nodes.map((n) => [n.id, n]));
    for (const id of [...this.nodes.keys()]) { const w = want.get(id); if (!w || w.type !== this.nodes.get(id)!.type) this.removeNode(id); }
    for (const n of json.nodes) {
      const have = this.nodes.get(n.id);
      if (!have) { const m = this.addNode(n.type, n.x, n.y, n.params, n.id); if (n.bypass) m.bypass = true; if (n.w) m.w = n.w; if (n.h) m.h = n.h; continue; }
      have.x = n.x; have.y = n.y;
      for (const k of Object.keys(have.params)) if (!(k in n.params)) delete have.params[k];
      Object.assign(have.params, n.params);
      if (n.bypass) have.bypass = true; else delete have.bypass;
      if (n.w) have.w = n.w; else delete have.w;
      if (n.h) have.h = n.h; else delete have.h;
    }
    this.edges = json.edges.filter((e) => this.canConnect(e.from, e.to)).map((e) => ({ id: e.id, from: { ...e.from }, to: { ...e.to } }));
    this.groups = (json.groups ?? []).map((g) => ({ ...g }));
    this.dirty = true;
  }

  load(json: GraphJSON) {
    for (const id of [...this.nodes.keys()]) this.removeNode(id);
    for (const n of json.nodes) { const m = this.addNode(n.type, n.x, n.y, n.params, n.id); if (n.bypass) m.bypass = true; if (n.w) m.w = n.w; if (n.h) m.h = n.h; }
    for (const e of json.edges) this.connect(e.from, e.to);
    this.groups = (json.groups ?? []).map((g) => ({ ...g }));
  }
}
