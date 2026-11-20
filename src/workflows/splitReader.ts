import type { Edge, GraphJSON, NodeInstance } from "../core/types";

const STEP = 322, W = 300;

/**
 * Older graphs hold the single "Board Reader" node, with its neural readers as checkboxes. Replace each one with the
 * detector chain (Clean Picture, Flatten Board, Brightness Reader, Neural Board Reader, Neural Square Reader, Blend Readings,
 * Camera Reading), so every detector is a node of its own that shows what it sees and how sure it is. The camera feeding
 * the old node and whatever its reading went to stay wired; the corners, camera id and trust carry over.
 * Returns the same object when there is nothing to split.
 */
export function splitBoardReaders(g: GraphJSON): GraphJSON {
  const readers = g.nodes.filter((n) => n.type === "vision.boardReader");
  if (!readers.length) return g;
  let nodes: NodeInstance[] = g.nodes.map((n) => ({ ...n })), edges: Edge[] = g.edges.map((e) => ({ ...e, from: { ...e.from }, to: { ...e.to } }));
  const used = new Set([...nodes.map((n) => n.id), ...edges.map((e) => e.id)]);
  const uid = (base: string) => { let id = base, i = 1; while (used.has(id)) id = `${base}_${i++}`; used.add(id); return id; };
  for (const r of readers) {
    const mk = (suffix: string, type: string, col: number, row: number, params: NodeInstance["params"] = {}): NodeInstance =>
      ({ id: uid(`${r.id}_${suffix}`), type, x: r.x + col * STEP, y: r.y + row * 120, w: W, params });
    // make room: everything to the right of the old reader moves over by the length of the chain
    const shift = 6 * STEP;
    nodes = nodes.map((n) => (n.id !== r.id && n.x > r.x ? { ...n, x: n.x + shift } : n));
    const p = r.params, clean = mk("clean", "vision.clean", 0, 0), flat = mk("flat", "vision.flatten", 1, 0, { cam: p.cam, corners: p.corners, autoFind: p.autoFind ?? true, collect: !!p.collect });
    const bright = mk("bright", "vision.brightness", 2, 0), board = mk("neuralBoard", "vision.neuralBoard", 3, 0), squares = mk("neuralSquares", "vision.neuralSquares", 4, 0);
    const blend = mk("blend", "vision.blend", 5, 0), obs = mk("reading", "vision.observe", 6, 0, { weight: p.weight ?? 1 });
    const wire = (a: NodeInstance, ap: string, b: NodeInstance, bp: string) => edges.push({ id: uid(`${r.id}_w`), from: { node: a.id, port: ap }, to: { node: b.id, port: bp } });
    const feed = edges.filter((e) => e.to.node === r.id && e.to.port === "frame"), out = edges.filter((e) => e.from.node === r.id);
    edges = edges.filter((e) => e.to.node !== r.id && e.from.node !== r.id);
    for (const e of feed) edges.push({ id: uid(`${r.id}_in`), from: e.from, to: { node: clean.id, port: "frame" } });
    wire(clean, "frame", flat, "frame"); wire(flat, "flat", bright, "flat"); wire(flat, "flat", board, "flat"); wire(flat, "flat", squares, "flat");
    wire(bright, "reading", blend, "r1"); wire(board, "reading", blend, "r2"); wire(squares, "reading", blend, "r3"); wire(blend, "reading", obs, "reading");
    for (const e of out) edges.push({ id: uid(`${r.id}_out`), from: { node: obs.id, port: e.from.port }, to: e.to });
    nodes = nodes.filter((n) => n.id !== r.id).concat([clean, flat, bright, board, squares, blend, obs]);
  }
  return { ...g, nodes, edges };
}
