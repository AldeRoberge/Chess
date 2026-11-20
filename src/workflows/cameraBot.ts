import type { GraphJSON } from "../core/types";
import { defaultSetup, webcamSetup, MAX_CAMERAS, type SetupConfig } from "../setup/config";

/** A physical camera per settings entry; all board processing lives in one visible node. */
export function buildCameraBot(saved: SetupConfig | null): { graph: GraphJSON; setup: SetupConfig } {
  const base = saved ?? defaultSetup();
  const cameras = (saved ? saved.cameras : [webcamSetup("", "Default webcam", "A")]).slice(0, MAX_CAMERAS);
  const setup: SetupConfig = { ...base, completed: true, cameras, tracking: { pose: false }, projectors: { ...base.projectors, count: 0, dmx: false }, opponent: { mode: "engine", elo: base.opponent.elo }, demo: { ...base.demo, autoplay: false } };
  return {
    setup,
    graph: {
      nodes: [
        ...cameras.map((c, i) => ({ id: `camera${i + 1}`, type: "source.webcam", x: 40, y: 40 + i * 350, params: { device: c.deviceId || (c.kind === "webcam" ? c.label : ""), channel: c.channel, online: c.online, fps: 12 } })),
        { id: "processor", type: "game.cameraBot", x: 500, y: 40, w: 420, params: { cameras: JSON.stringify(cameras), elo: setup.opponent.elo, color: "b" } },
      ],
      edges: cameras.map((_, i) => ({ id: `feed${i + 1}`, from: { node: `camera${i + 1}`, port: "frame" }, to: { node: "processor", port: `f${i + 1}` } })),
    },
  };
}
