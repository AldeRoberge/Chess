import { EventEmitter } from "node:events";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectPlugin } from "./collectPlugin";
import { agrees, collectFrame, placementOf } from "./collect";
import type { BoardBelief } from "./types";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
const belief = (truth: number[], over: Partial<BoardBelief> = {}): BoardBelief => ({
  t: 0, occ: Float32Array.from(truth, (v) => (v ? 0.95 : 0.05)), white: Float32Array.from(truth, (v) => (v === 1 ? 0.95 : 0.05)), conf: new Float32Array(64).fill(0.95),
  fidelity: 0.97, handOver: false, settled: true, cams: 2, ...over,
});

describe("training frame collection", () => {
  it("turns a FEN into squares in a8..h1 order", () => {
    const t = placementOf(`${START} w KQkq - 0 1`)!;
    expect(t.slice(0, 8)).toEqual([2, 2, 2, 2, 2, 2, 2, 2]);
    expect(t.slice(24, 32)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(t.slice(56)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    expect(placementOf("not a fen")).toBeNull();
  });

  it("keeps a frame only when the settled belief agrees with the position on every square", () => {
    const truth = placementOf(START)!;
    expect(agrees(belief(truth), truth)).toBe(true);
    const wrong = truth.slice(); wrong[27] = 1; // a piece the tracker does not see on d5
    expect(agrees(belief(truth), wrong)).toBe(false);
    expect(agrees(belief(truth, { settled: false }), truth)).toBe(false);
    expect(agrees(belief(truth, { handOver: true }), truth)).toBe(false);
    const swapped = truth.slice(); swapped[0] = 1; // right square, wrong colour
    expect(agrees(belief(truth), swapped)).toBe(false);
    const unsure = belief(truth); unsure.conf[10] = 0.3;
    expect(agrees(unsure, truth)).toBe(false);
  });

  it("sends nothing without a trustworthy position", () => {
    const frame = { width: 4, height: 4, data: new Uint8ClampedArray(16), t: 0 };
    const corners = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 3 }, { x: 0, y: 3 }];
    expect(collectFrame({ cam: "A", frame, corners, fen: undefined, board: null })).toBe(false);
    expect(collectFrame({ cam: "A", frame, corners, fen: START, board: belief(placementOf(START)!, { settled: false }) })).toBe(false);
  });

  it("the dev endpoint stores a valid frame, refuses other computers and bad bodies", async () => {
    const dir = mkdtempSync(join(tmpdir(), "collect-"));
    let handler!: (req: any, res: any) => void;
    (collectPlugin(dir).configureServer as any)({ middlewares: { use: (_p: string, h: typeof handler) => { handler = h; } } });
    const post = (body: unknown, addr = "127.0.0.1", method = "POST") => new Promise<number>((resolve) => {
      const req: any = new EventEmitter(); req.method = method; req.socket = { remoteAddress: addr }; req.destroy = () => {};
      const res: any = { statusCode: 0, end: () => resolve(res.statusCode) };
      handler(req, res);
      req.emit("data", Buffer.from(JSON.stringify(body))); req.emit("end");
    });
    const good = { cam: "A/../x", fen: START, width: 4, height: 2, corners: [], data: Buffer.alloc(8, 7).toString("base64") };
    expect(await post(good)).toBe(204);
    const [name] = readdirSync(dir).filter((n) => n.endsWith(".gray"));
    expect(name).toMatch(/-Ax\.gray$/); // the camera id is sanitised
    expect(readFileSync(join(dir, name)).length).toBe(8);
    expect(JSON.parse(readFileSync(join(dir, name.replace(".gray", ".json")), "utf8")).fen).toBe(START);
    expect(await post(good, "192.168.1.20")).toBe(403);
    expect(await post({ ...good, data: "AAAA" })).toBe(400);
    expect(await post({ ...good, fen: "../../etc" })).toBe(400);
    expect(await post(good, "127.0.0.1", "GET")).toBe(405);
    rmSync(dir, { recursive: true, force: true });
  });
});
