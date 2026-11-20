import { beforeEach, expect, it, vi } from "vitest";
import { buildCameraBot, migrateCameraBot } from "./cameraBot";
import { defaultSetup, webcamSetup } from "../setup/config";
import { WORKFLOWS, withLiveCameras } from "./index";
import { node, shoot, tick } from "../test/helpers";
import { VirtualTable } from "../sim/virtualTable";
import { createEngine } from "../chess/engine";
import { bus } from "../core/bus";
vi.mock("../chess/engine", () => ({ createEngine: vi.fn() }));
beforeEach(() => { localStorage.clear(); });

it("uses all four saved cameras including their individual settings without mutating setup", () => {
  const setup = defaultSetup();
  setup.cameras = ["A", "B", "C", "D"].map((id, i) => ({ ...webcamSetup(`device${i}`, id, id), trust: 0.5 + i / 2, online: i !== 2 }));
  const before = JSON.stringify(setup);
  const loaded = withLiveCameras(WORKFLOWS.find(w => w.id === "camera-bot")!, setup);
  const byId = (id: string) => loaded.graph.nodes.find(n => n.id === id)!;
  expect(loaded.graph.nodes).toHaveLength(4 * 2 + 5);
  expect(loaded.graph.edges.filter(e => e.to.node === "fuse").map(e => e.to.port)).toEqual(["o1", "o2", "o3", "o4"]);
  expect(byId("camera3").params).toMatchObject({ device: "device2", online: false });
  expect(byId("reader3").params).toMatchObject({ cam: "C", weight: 1.5 });
  expect(loaded.graph.groups?.map(g => g.title)).toEqual(["Cameras", "Board analysis", "Game"]);
  expect(loaded.setup?.tracking.pose).toBe(false);
  expect(loaded.setup?.projectors.count).toBe(0);
  expect(JSON.stringify(setup)).toBe(before);
});

it("uses a default webcam when no setup exists", () => {
  expect(buildCameraBot(null).graph.nodes.map(n => n.type)).toEqual(["source.webcam", "vision.boardReader", "vision.fuse", "vision.stabilize", "game.session", "game.tracker", "game.engine"]);
});

it("replaces the old single Camera Board → Bot node with the chain, keeping its settings", () => {
  const cams = [webcamSetup("devX", "A", "A")];
  const old = { nodes: [{ id: "camera1", type: "source.webcam", x: 0, y: 0, params: { device: "devX", fps: 7 } }, { id: "processor", type: "game.cameraBot", x: 1, y: 1, params: { cameras: JSON.stringify(cams), elo: 1800, color: "w" } }], edges: [] };
  const g = migrateCameraBot(old as any);
  expect(g.nodes.some(n => n.type === "game.cameraBot")).toBe(false);
  expect(g.nodes.find(n => n.id === "camera1")!.params).toMatchObject({ device: "devX", fps: 7 });
  expect(g.nodes.find(n => n.id === "session")!.params.elo).toBe(1800);
  expect(g.nodes.find(n => n.id === "engine")!.params.color).toBe("w");
  expect(migrateCameraBot(g)).toBe(g);
});

it("tracks a physical move, announces a bot reply, and waits for its physical execution", async () => {
  const engine = { setElo: vi.fn(), bestMove: vi.fn(async () => "e7e5"), dispose: vi.fn() };
  vi.mocked(createEngine).mockResolvedValue(engine as any);
  const setup = defaultSetup();
  const readers = setup.cameras.map(c => node("vision.boardReader", { cam: c.id, corners: c.corners, weight: c.trust, collect: false }));
  const fuse = node("vision.fuse"), stabilize = node("vision.stabilize"), session = node("game.session", { elo: 1200 }), tracker = node("game.tracker"), engineNode = node("game.engine", { color: "b", virtualHand: false });
  const n = {
    run(f: Record<string, any>, now: number) {
      const obs = Object.fromEntries(readers.map((r, i) => [`o${i + 1}`, r.run({ frame: f[`f${i + 1}`] }, now)!.obs]));
      const board = stabilize.run({ board: fuse.run(obs, now)!.board }, now)!.board;
      const director = session.run({}, now)!.director;
      const t = tracker.run({ board, director }, now)!;
      engineNode.run({ game: t.game, director }, now);
      return { game: t.game };
    },
    dispose() { [...readers, fuse, stabilize, session, tracker, engineNode].forEach(x => x.dispose()); },
  };
  const table = new VirtualTable();
  let time = 1000;
  const observe = async (frames: number) => {
    let result: any;
    for (let i = 0; i < frames; i++) {
      time += 150;
      result = n.run({ f1: shoot(table, "A", time), f2: shoot(table, "B", time) }, time);
      await tick();
    }
    return result;
  };
  await observe(30);
  table.game.move("e4");
  const out = await observe(40);
  expect(out.game.history).toEqual(["e4"]);
  expect(engine.bestMove).toHaveBeenCalledTimes(1);
  expect(bus.engineHint).toEqual({ from: "e7", to: "e5" });
  table.game.move("e5");
  const reply = await observe(40);
  expect(reply.game.history).toEqual(["e4", "e5"]);
  expect(bus.engineHint).toBeNull();
  n.dispose();
  expect(engine.dispose).toHaveBeenCalled();
});
