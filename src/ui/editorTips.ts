import type { Graph } from "../core/graph";
import type { ParamDef, PortType } from "../core/types";
import { CAT_COLOR, PORT_COLOR } from "./editor";
import { PARAM_DOCS } from "./paramDocs";
import { brief } from "../plugins/shared";
import type { Tip, TipPreview, TipResolver } from "./tooltip";

const PORT_INFO: Record<PortType, string> = {
  frame: "A grayscale camera image.",
  obs: "One camera's reading of the 64 squares.",
  board: "Fused, stabilised belief about every square.",
  game: "The validated position, last move and move confidence.",
  pointer: "Hands and pointers on the table, in table coordinates.",
  pose: "Skeleton poses of people around the table.",
  seat: "Who is sitting where.",
  event: "Moments worth reacting to: captures, checks, mate.",
  text: "Narration lines with their speaker.",
  scene: "Lights, sound and projection state.",
  clock: "Time left on each chess clock, with how certain the estimate is.",
  any: "Accepts or carries any signal type.",
};

const CAT_INFO: Record<string, string> = {
  Source: "Brings images or input into the workflow.",
  Vision: "Turns camera pixels into board readings.",
  Game: "Tracks the real game of chess.",
  Narration: "Decides what the narrator says.",
  Scene: "Lights, sound and projection.",
  Output: "Sends results out of the workflow.",
  Tracking: "Follows hands, people and seats.",
  Experience: "Directs the show around the game.",
};

/** Short, honest description of a live signal value. */
export function describeValue(v: unknown): string {
  if (v === undefined || v === null) return "no signal";
  if (Array.isArray(v)) return v.length === 1 ? "1 item" : `${v.length} items`;
  if (typeof v === "number") return String(Math.round(v * 1000) / 1000);
  if (typeof v === "string") return v.length > 22 ? v.slice(0, 21) + "…" : v || "empty";
  if (typeof v === "boolean") return v ? "true" : "false";
  const o = v as { width?: number; height?: number };
  if (typeof o.width === "number" && typeof o.height === "number") return `${o.width}×${o.height}`;
  return "object";
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const tone = (v: number) => (v > 0.8 ? "ok" : v > 0.5 ? "warn" : "bad") as "ok" | "warn" | "bad";

const ITEMS = 8;
/** A glanceable view of what a signal carries: an image for frames, otherwise its first few fields or items. */
export function previewOf(v: unknown): TipPreview | null {
  if (v === undefined || v === null) return null;
  const o = v as { width?: unknown; height?: unknown; data?: unknown };
  if (typeof o.width === "number" && typeof o.height === "number" && o.data && ArrayBuffer.isView(o.data)) {
    return { frame: { width: o.width, height: o.height, data: o.data as unknown as ArrayLike<number> } };
  }
  let entries: [string, unknown][];
  if (Array.isArray(v)) entries = v.map((x, i) => [String(i), x]);
  else if (typeof v === "object" && !ArrayBuffer.isView(v)) entries = Object.entries(v as object);
  else return { items: [["value", brief(v, 200)]] };
  if (!entries.length) return { items: [["empty", "—"]] };
  // newest items last in arrays, so show the tail
  const shown = Array.isArray(v) ? entries.slice(-ITEMS) : entries.slice(0, ITEMS);
  return { items: shown.map(([k, x]) => [k, brief(x, 90)] as [string, string]), more: entries.length - shown.length || undefined };
}

/** Tooltip content for the node editor: nodes, pins and parameters, all with live values. */
export function editorTips(graph: Graph): TipResolver {
  const titleOf = (id: string) => { const n = graph.nodes.get(id); return n ? (graph.registry.get(n.type)?.title ?? n.type) : id; };

  const pin = (el: HTMLElement): Tip | null => {
    const n = graph.nodes.get(el.dataset.node ?? ""); const spec = n && graph.registry.get(n.type);
    if (!n || !spec) return null;
    const isOut = el.dataset.dir === "out";
    const def = (isOut ? spec.outputs : spec.inputs).find((p) => p.id === el.dataset.port);
    if (!def) return null;
    const wires = graph.edges.filter((e) => (isOut ? e.from : e.to).node === n.id && (isOut ? e.from : e.to).port === def.id);
    const other = (e: (typeof wires)[number]) => { const o = isOut ? e.to : e.from; return `${titleOf(o.node)} · ${o.port}`; };
    const value = isOut ? graph.outputs.get(n.id)?.[def.id] : wires.length ? graph.outputs.get(wires[0].from.node)?.[wires[0].from.port] : undefined;
    return {
      title: def.label ?? def.id, tag: def.type, color: PORT_COLOR[def.type], body: PORT_INFO[def.type],
      rows: [
        { label: "Direction", value: isOut ? "output" : "input" },
        { label: isOut ? "Sends to" : "Fed by", value: wires.length ? (wires.length > 1 ? `${wires.length} wires` : other(wires[0])) : "nothing", tone: wires.length ? undefined : "warn" },
        { label: "Live", value: describeValue(value) },
      ],
      preview: previewOf(value),
      hint: isOut ? "Drag to a matching input" : "Drop a wire here",
    };
  };

  const param = (el: HTMLElement): Tip | null => {
    const n = graph.nodes.get(el.dataset.node ?? ""); const spec = n && graph.registry.get(n.type);
    const def: ParamDef | undefined = spec?.params?.find((p) => p.id === el.dataset.param);
    if (!n || !def) return null;
    const v = n.params[def.id];
    const rows: Tip["rows"] = [{ label: "Value", value: String(v), bar: def.kind === "number" ? (Number(v) - def.min) / (def.max - def.min || 1) : undefined }];
    if (def.kind === "number") rows.push({ label: "Range", value: `${def.min} – ${def.max}` });
    if (def.kind === "select") rows.push({ label: "Options", value: String(def.options.length) });
    rows.push({ label: "Default", value: String(def.value) });
    return { title: def.label, tag: def.kind, color: CAT_COLOR[spec!.category], body: PARAM_DOCS[`${n.type}.${def.id}`], rows, hint: v === def.value ? "At default" : "Changed from default" };
  };

  const node = (el: HTMLElement): Tip | null => {
    const n = graph.nodes.get(el.dataset.id ?? ""); const spec = n && graph.registry.get(n.type);
    if (!n || !spec) return null;
    const st = graph.stats.get(n.id);
    const wired = (side: "from" | "to", ports: number) => `${new Set(graph.edges.filter((e) => e[side].node === n.id).map((e) => e[side].port)).size} / ${ports}`;
    const rows: NonNullable<Tip["rows"]> = [{ label: "Status", value: st?.error ? "error" : n.bypass ? "bypassed" : "running", tone: st?.error ? "bad" : n.bypass ? "warn" : "ok" }];
    if (st?.error) rows.push({ label: "Error", value: st.error.length > 28 ? st.error.slice(0, 27) + "…" : st.error, tone: "bad" });
    if (st?.fidelity != null) rows.push({ label: "Fidelity", value: pct(st.fidelity), bar: st.fidelity, tone: tone(st.fidelity) });
    if (st) rows.push({ label: "Time", value: `${st.ms.toFixed(2)} ms` });
    if (n.bypass) for (const [port, val] of Object.entries(graph.inputValues(n.id))) rows.push({ label: `In · ${port}`, value: describeValue(val) });
    rows.push({ label: "Inputs", value: wired("to", spec.inputs.length) + " wired" }, { label: "Outputs", value: wired("from", spec.outputs.length) + " wired" });
    return { title: spec.title, tag: spec.category, color: CAT_COLOR[spec.category], body: spec.desc ?? CAT_INFO[spec.category], rows, hint: "Drag the header to move" };
  };

  return (el) => {
    if (!(el instanceof HTMLElement)) return null;
    if (el.classList.contains("ne-dot")) return pin(el);
    if (el.classList.contains("ne-param")) return param(el);
    if (el.classList.contains("ne-node")) return node(el);
    return null;
  };
}
