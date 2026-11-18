import { describe, expect, it } from "vitest";
import { RIGS, FRAME_H, FRAME_W, rigCorners } from "../sim/rigs";
import { applySensor, renderLuminance } from "../sim/render3d";
import { virtualTable } from "../sim/virtualTable";
import type { Pt } from "../vision/types";
import { CHANNEL_NAME, boardSeparation, detectChannel, estimateFov, trustFor } from "./autodetect";
import { camHealth, defaultSetup, virtualCamera, webcamSetup, type CameraSetup } from "./config";

/** A synthetic board picture: the squares of the board between a8..a1 corners, coloured by `color(dark)`. */
function boardImage(corners: Pt[], color: (dark: boolean) => [number, number, number], bg: [number, number, number] = [0, 0, 0]): ImageData {
  // axis-aligned corners only (a rectangle), so a pixel's square follows from its position
  const xs = corners.map((p) => p.x), ys = corners.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const data = new Uint8ClampedArray(FRAME_W * FRAME_H * 4);
  for (let y = 0; y < FRAME_H; y++) for (let x = 0; x < FRAME_W; x++) {
    const i = (y * FRAME_W + x) * 4;
    let rgb = bg;
    if (x >= x0 && x < x1 && y >= y0 && y < y1) {
      const file = Math.floor(((x - x0) / (x1 - x0)) * 8), rank = 8 - Math.floor(((y - y0) / (y1 - y0)) * 8);
      rgb = color((file + rank) % 2 === 1);
    }
    data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255;
  }
  return { width: FRAME_W, height: FRAME_H, data } as unknown as ImageData;
}
const rect: Pt[] = [{ x: 100, y: 40 }, { x: 380, y: 40 }, { x: 380, y: 320 }, { x: 100, y: 320 }]; // a8, h8, h1, a1

describe("field of view from the board corners", () => {
  it.each(["A", "B", "C"] as const)("reads back rig %s's own lens angle from its board", (r) => {
    expect(estimateFov(rigCorners(RIGS[r]), FRAME_W, FRAME_H)).toBeCloseTo(RIGS[r].fovY, 0);
  });
  it("gives nothing for corners that do not fit a lens (a point, or a collapsed board)", () => {
    expect(estimateFov([{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }], FRAME_W, FRAME_H)).toBeNull();
    expect(estimateFov([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }], FRAME_W, FRAME_H)).toBeNull();
  });
  it("keeps the result inside the slider's 30..110 range", () => {
    const wide = [{ x: -4000, y: 60 }, { x: 4500, y: 60 }, { x: 240, y: 300 }, { x: 240, y: 300 }];
    const fov = estimateFov(wide, FRAME_W, FRAME_H);
    expect(fov === null || (fov >= 30 && fov <= 110)).toBe(true);
  });
});

describe("channel, separation and trust", () => {
  it("keeps grey for a plain camera, where the colour planes show the board no better", () => {
    const img = boardImage(rect, (dark) => (dark ? [60, 60, 60] : [200, 200, 200]));
    expect(detectChannel(img, rect).channel).toBe("luma");
    expect(boardSeparation(img, rect, "luma")).toBeGreaterThan(2);
  });
  it("moves to the red plane for an infrared-style picture that only shows the board in red", () => {
    const img = boardImage(rect, (dark) => [dark ? 50 : 210, 120, 120]);
    const found = detectChannel(img, rect);
    expect(found.channel).toBe("red"); expect(found.separation).toBeGreaterThan(2);
    expect(CHANNEL_NAME[found.channel]).toBe("Red");
  });
  it("gives no separation for a flat picture, so the board does not stand out", () => {
    expect(boardSeparation(boardImage(rect, () => [128, 128, 128]), rect, "luma")).toBeLessThan(0.01);
  });
  it("maps d' to trust: 1.5 is the default 1, clamped to 0..2", () => {
    expect(trustFor(0)).toBe(0); expect(trustFor(1.5)).toBe(1); expect(trustFor(0.3)).toBe(0.2); expect(trustFor(9)).toBe(2);
  });
  it("measures the rig views: each has a clean enough board to read", () => {
    virtualTable.reset();
    for (const r of ["A", "B", "C"] as const) {
      const lum = renderLuminance(virtualTable.scene3d(), { width: FRAME_W, height: FRAME_H, rig: RIGS[r] });
      const f = applySensor(lum, { width: FRAME_W, height: FRAME_H, rig: RIGS[r], noise: 3 });
      const data = new Uint8ClampedArray(FRAME_W * FRAME_H * 4);
      for (let i = 0; i < FRAME_W * FRAME_H; i++) { data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = f.data[i]; data[i * 4 + 3] = 255; }
      const img = { width: FRAME_W, height: FRAME_H, data } as unknown as ImageData;
      expect(detectChannel(img, rigCorners(RIGS[r])).channel).toBe("luma");
      expect(boardSeparation(img, rigCorners(RIGS[r]), "luma")).toBeGreaterThan(0.5);
    }
  });
});

describe("camera health (the status on each board tab)", () => {
  const cam = (over: Partial<CameraSetup> = {}): CameraSetup => ({ ...virtualCamera("A"), ...over });
  it("a virtual camera with corners marked is configured and ready", () => {
    expect(camHealth(cam())).toMatchObject({ configured: true, auto: false, ready: true, bad: false, tone: "ok", text: "Ready" });
  });
  it("a webcam is not configured until a device is chosen; offline cameras are not ready", () => {
    expect(camHealth(webcamSetup("", "Mystery", "W1"), { signal: true }).configured).toBe(false);
    expect(camHealth(webcamSetup("dev", "Cam", "W1"), { signal: true })).toMatchObject({ configured: true, ready: true });
    expect(camHealth(cam({ online: false }))).toMatchObject({ ready: false, tone: "warn", text: "Offline" });
    expect(camHealth(cam({ corners: "bad" }))).toMatchObject({ configured: false, text: "Not configured" });
  });
  it("an auto-detected placement shows as such", () => {
    expect(camHealth(cam({ autoFields: ["fov"] }))).toMatchObject({ auto: true, text: "Ready · placement auto" });
    expect(camHealth(cam({ autoFields: ["trust"] })).auto).toBe(false);
  });
  it("performing badly: no signal on a webcam, or squares that barely stand out", () => {
    expect(camHealth(webcamSetup("dev", "Cam", "W1"), { signal: false })).toMatchObject({ bad: true, ready: false, tone: "fail", text: "No signal" });
    expect(camHealth(cam(), { signal: true, separation: 0.1 })).toMatchObject({ bad: true, tone: "fail", text: "Performing badly" });
    expect(camHealth(cam(), { signal: true, separation: 1.2 })).toMatchObject({ bad: false, tone: "ok" });
  });
  it("the shipped demo cameras are ready out of the box", () => {
    for (const c of defaultSetup().cameras) expect(camHealth(c).ready).toBe(true);
  });
});
