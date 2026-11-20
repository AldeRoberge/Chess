import type { GraphJSON, GroupDef } from "./types";

/** Eight calm section colours; the first four are what Auto-organize uses. */
export const GROUP_COLORS = ["#f2b84b", "#3fb59a", "#9a78e0", "#62c27a", "#4a8fd9", "#c76fb0", "#d98c4a", "#7c8aa0"];

export const NODE_W = 280;
export const NODE_H = 300;
/** Narrowest a node may be once organised; anything narrower is widened so its controls and labels breathe. */
export const AMPLE_W = 360;
/** Card height assumed when the real one is not known (a layout built without a screen). Cards are taller than NODE_H, and a short guess paints them on top of each other. */
const EST_H = 520;
const COL_GAP = 32, ROW_GAP = 32, PAD = 24, HEAD = 40, GAP = 40, WRAP = 3;

/** What a node is for. Sections follow this when the patch is organised. */
const ROLES: { title: string; color: string; match: RegExp }[] = [
  { title: "Demo & input", color: GROUP_COLORS[0], match: /^(sim|source|world)\./ },
  { title: "Analysis", color: GROUP_COLORS[1], match: /^(vision|clock\.reader)/ },
  { title: "Game & experience", color: GROUP_COLORS[2], match: /^(game|experience|tracking)\./ },
  { title: "Output: sound & narration", color: GROUP_COLORS[3], match: /^(narration|scene|clock\.overlay|projection)/ },
];
const OTHER = { title: "Other", color: GROUP_COLORS[7], match: /./ };

const roleOf = (type: string) => ROLES.find((r) => r.match.test(type)) ?? OTHER;

/** Longest-path column of every node; feedback wires stop mattering after one pass per node. */
export function depths(g: GraphJSON): Map<string, number> {
  const d = new Map(g.nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < g.nodes.length; pass++) {
    let moved = false;
    for (const e of g.edges) { const v = (d.get(e.from.node) ?? 0) + 1; if (v > (d.get(e.to.node) ?? 0) && v <= g.nodes.length) { d.set(e.to.node, v); moved = true; } }
    if (!moved) break;
  }
  return d;
}

/**
 * Lays the patch out left to right: each camera feed is its own row, stacked, merging into the game state on the right;
 * everything else sits in horizontal bands by role (input, analysis, game, output), each wrapped in a titled,
 * coloured section. Moves nodes and replaces `g.groups`; wires and params are untouched.
 */
export function organize(g: GraphJSON, size?: (id: string) => { w: number; h: number } | null): void {
  const depth = depths(g), groups: GroupDef[] = [];
  const dims = (x: GraphJSON["nodes"][number]) => { const m = size?.(x.id); return { w: Math.max(x.w ?? 0, m?.w ?? 0, AMPLE_W), h: Math.max(x.h ?? 0, m?.h ?? 0) || EST_H }; };
  const byDepth = (nodes: GraphJSON["nodes"]) => nodes.map((x, i) => ({ x, i })).sort((a, b) => (depth.get(a.x.id) ?? 0) - (depth.get(b.x.id) ?? 0) || a.i - b.i).map((o) => o.x);
  let n = 0;
  /** Places the nodes in a titled section with its top-left corner at (x0, y0), `wrap` nodes per row; returns the section. */
  const place = (nodes: GraphJSON["nodes"], title: string, color: string, x0: number, y0: number, wrap: number): GroupDef => {
    const ordered = byDepth(nodes);
    const cols = Math.min(wrap, ordered.length), rows = Math.ceil(ordered.length / wrap);
    // column widths and row heights follow the largest node in them, so tall or resized nodes never spill out
    const cw = Array<number>(cols).fill(0), rh = Array<number>(rows).fill(0);
    // nodes narrower than AMPLE_W are widened here, so the new width is kept with the patch
    ordered.forEach((node, i) => { const d = dims(node); node.w = d.w; cw[i % wrap] = Math.max(cw[i % wrap], d.w); rh[Math.floor(i / wrap)] = Math.max(rh[Math.floor(i / wrap)], d.h); });
    const colX = cw.map((_, c) => x0 + PAD + cw.slice(0, c).reduce((t, v) => t + v + COL_GAP, 0));
    const rowY = rh.map((_, r) => y0 + HEAD + PAD + rh.slice(0, r).reduce((t, v) => t + v + ROW_GAP, 0));
    ordered.forEach((node, i) => { node.x = colX[i % wrap]; node.y = rowY[Math.floor(i / wrap)]; });
    const grp = { id: `g${++n}`, title, color, x: x0, y: y0, w: colX[cols - 1] + cw[cols - 1] + PAD - x0, h: rowY[rows - 1] + rh[rows - 1] + PAD - y0 };
    groups.push(grp);
    return grp;
  };

  // Cameras: each feed into a fusion node (source, reader, ...) is a row of its own, read left to right, rows stacked.
  const claimed = new Set<string>();
  const byId = new Map(g.nodes.map((x) => [x.id, x]));
  const feeds: GraphJSON["nodes"][] = [];
  for (const f of g.nodes.filter((x) => x.type === "vision.fuse")) {
    for (const e of g.edges.filter((e) => e.to.node === f.id).sort((a, b) => a.to.port.localeCompare(b.to.port))) {
      const chain: GraphJSON["nodes"] = [], todo = [e.from.node];
      while (todo.length) {
        const id = todo.pop()!, node = byId.get(id);
        if (!node || claimed.has(id) || node.type === "vision.fuse") continue;
        claimed.add(id); chain.push(node);
        for (const up of g.edges) if (up.to.node === id) todo.push(up.from.node);
      }
      if (chain.length) feeds.push(chain);
    }
  }
  let y = 30;
  if (feeds.length) {
    let right = 0, top = y;
    feeds.forEach((chain, i) => {
      const s = place(chain, feeds.length > 1 ? `Camera ${i + 1}` : "Camera", GROUP_COLORS[1], 20, y, chain.length);
      right = Math.max(right, s.x + s.w); y += s.h + GAP / 2;
    });
    // ...then they merge into the game state, to the right of the cameras
    const merge = g.nodes.filter((x) => !claimed.has(x.id) && /^(vision\.(fuse|stabilize)|game\.tracker)$/.test(x.type));
    if (merge.length) {
      merge.forEach((x) => claimed.add(x.id));
      const probe = place(merge, "Merge into game state", GROUP_COLORS[2], right + GAP, top, merge.length);
      const dy = Math.max(0, Math.round((y - GAP / 2 - top - probe.h) / 2));
      if (dy) { probe.y += dy; merge.forEach((x) => { x.y += dy; }); }
    }
    y += GAP / 2;
  }

  for (const role of [...ROLES, OTHER]) {
    const nodes = g.nodes.filter((x) => !claimed.has(x.id) && roleOf(x.type) === role);
    if (!nodes.length) continue;
    // left to right in pipeline order, wrapping into a new row after WRAP nodes
    y += place(nodes, role.title, role.color, 20, y, WRAP).h + GAP;
  }
  g.groups = groups;
}

/** Ids of the nodes whose centre lies inside the section. Used to carry nodes along when a section moves. */
export function nodesInside(g: { nodes: { id: string; x: number; y: number; w?: number; h?: number }[] }, s: GroupDef): string[] {
  return g.nodes.filter((n) => {
    const cx = n.x + (n.w ?? NODE_W) / 2, cy = n.y + (n.h ?? NODE_H) / 2;
    return cx >= s.x && cx <= s.x + s.w && cy >= s.y && cy <= s.y + s.h;
  }).map((n) => n.id);
}

/** A section that fits around these boxes, with room for its title. */
export function fitAround(boxes: { x: number; y: number; w: number; h: number }[]) {
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w)), y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0 - PAD, y: y0 - PAD - HEAD, w: x1 - x0 + PAD * 2, h: y1 - y0 + PAD * 2 + HEAD };
}

/** Next unused section id ("g1", "g2", ...). */
export const nextGroupId = (groups: GroupDef[]) => { let i = groups.length + 1; while (groups.some((g) => g.id === `g${i}`)) i++; return `g${i}`; };
