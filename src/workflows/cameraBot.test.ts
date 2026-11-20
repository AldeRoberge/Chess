import { beforeEach, expect, it, vi } from "vitest";
import { buildCameraBot } from "./cameraBot";
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
  expect(loaded.graph.nodes).toHaveLength(5);
  expect(loaded.graph.edges.map(e => e.to.port)).toEqual(["f1", "f2", "f3", "f4"]);
  expect(loaded.graph.nodes[2].params).toMatchObject({ device: "device2", online: false });
  expect(JSON.parse(String(loaded.graph.nodes[4].params.cameras))).toEqual(setup.cameras);
  expect(loaded.setup?.tracking.pose).toBe(false);
  expect(loaded.setup?.projectors.count).toBe(0);
  expect(JSON.stringify(setup)).toBe(before);
});

it("uses a default webcam when no setup exists", () => {
  expect(buildCameraBot(null).graph.nodes.map(n => n.type)).toEqual(["source.webcam", "game.cameraBot"]);
});

it("tracks a physical move, announces a bot reply, and waits for its physical execution", async () => {
  const engine = { setElo: vi.fn(), bestMove: vi.fn(async () => "e7e5"), dispose: vi.fn() };
  vi.mocked(createEngine).mockResolvedValue(engine as any);
  const setup = defaultSetup();
  const n = node("game.cameraBot", { cameras: JSON.stringify(setup.cameras), elo: 1200 });
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
