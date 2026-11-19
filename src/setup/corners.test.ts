import { inflateSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { renderLuminance } from "../sim/render3d";
import { FRAME_H, FRAME_W, RIGS, rigCorners } from "../sim/rigs";
import type { Pt } from "../vision/types";
import { LABEL_GLYPH, applyBorderLabels, detectBoardCorners, detectCornersByShape, pngBase64 } from "./corners";

function image(paint: (data: Uint8ClampedArray) => void, w = FRAME_W, h = FRAME_H): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  paint(data);
  return { width: w, height: h, data } as ImageData;
}

/** Axis-aligned board, a8 at the top-left. Squares alternate; a8 is light. */
function boardImage(corners: Pt[], color: (dark: boolean) => [number, number, number], bg: [number, number, number] = [0, 0, 0]): ImageData {
  const xs = corners.map((p) => p.x), ys = corners.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return image((data) => {
    for (let y = 0; y < FRAME_H; y++) for (let x = 0; x < FRAME_W; x++) {
      const i = (y * FRAME_W + x) * 4;
      let rgb = bg;
      if (x >= x0 && x < x1 && y >= y0 && y < y1) {
        const file = Math.min(7, Math.floor(((x - x0) / (x1 - x0)) * 8));
        const rank = 8 - Math.min(7, Math.floor(((y - y0) / (y1 - y0)) * 8));
        rgb = color((file + rank) % 2 === 1);
      }
      data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255;
    }
  });
}

function paintGlyph(data: Uint8ClampedArray, ch: string, cx: number, cy: number, px: number) {
  const g = LABEL_GLYPH[ch], x0 = Math.round(cx - (5 * px) / 2), y0 = Math.round(cy - (7 * px) / 2);
  for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) if (g[r][c] === "1") {
    for (let dy = 0; dy < px; dy++) for (let dx = 0; dx < px; dx++) {
      const x = x0 + c * px + dx, y = y0 + r * px + dy;
      if (x < 0 || y < 0 || x >= FRAME_W || y >= FRAME_H) continue;
      const i = (y * FRAME_W + x) * 4; data[i] = data[i + 1] = data[i + 2] = 16;
    }
  }
}

/** Light border around the board with a–h along the top and bottom and 8–1 down the sides. */
function paintLabels(img: ImageData, corners: Pt[]) {
  const [x0, x1, y0, y1] = [corners[0].x, corners[1].x, corners[0].y, corners[2].y];
  const sx = (x1 - x0) / 8, sy = (y1 - y0) / 8, d = img.data;
  for (let y = Math.max(0, y0 - sy); y < Math.min(FRAME_H, y1 + sy); y++) for (let x = Math.max(0, x0 - sx); x < Math.min(FRAME_W, x1 + sx); x++) {
    const onBoard = x >= x0 && x < x1 && y >= y0 && y < y1;
    if (onBoard) continue;
    const i = (y * FRAME_W + x) * 4; d[i] = d[i + 1] = d[i + 2] = 230; d[i + 3] = 255;
  }
  for (let f = 0; f < 8; f++) {
    const x = x0 + (f + 0.5) * sx;
    paintGlyph(d, "abcdefgh"[f], x, y0 - sy * 0.55, 3);
    paintGlyph(d, "hgfedcba"[f], x0 + (7.5 - f) * sx, y1 + sy * 0.55, 3);
  }
  for (let r = 0; r < 8; r++) {
    const y = y0 + (r + 0.5) * sy;
    paintGlyph(d, "87654321"[r], x1 + sx * 0.55, y, 3);
    paintGlyph(d, "12345678"[r], x0 - sx * 0.55, y1 - (r + 0.5) * sy, 3);
  }
}

const rect: Pt[] = [{ x: 80, y: 40 }, { x: 400, y: 40 }, { x: 400, y: 320 }, { x: 80, y: 320 }];
const near = (got: Pt[], want: Pt[], tol: number) => {
  got.forEach((p, i) => { expect(Math.hypot(p.x - want[i].x, p.y - want[i].y), `corner ${i}`).toBeLessThan(tol); });
};

function grayImage(lum: Float32Array): ImageData {
  return image((data) => {
    for (let i = 0; i < lum.length; i++) { data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = lum[i]; data[i * 4 + 3] = 255; }
  });
}

describe("checkerboard shape", () => {
  it("finds an upright board's corners, including a coloured one", () => {
    const img = boardImage(rect, (dark) => (dark ? [50, 50, 50] : [210, 210, 210]));
    const found = detectCornersByShape(img)!;
    expect(found.separation).toBeGreaterThan(1);
    near(found.corners, rect, 8);
    const teal = boardImage(rect, (dark) => (dark ? [20, 110, 110] : [240, 230, 200]));
    near(detectCornersByShape(teal)!.corners, rect, 8);
  });
  it("finds the board in a rig's view of the empty table", () => {
    for (const id of ["A", "B"] as const) {
      const lum = renderLuminance({ pieces: [], blobs: [] }, { width: FRAME_W, height: FRAME_H, rig: RIGS[id] });
      const found = detectCornersByShape(grayImage(lum));
      console.log(id, rigCorners(RIGS[id], 0).map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(" | "));
      expect(found, id).toBeTruthy();
      near(found!.corners, rigCorners(RIGS[id], 0), 14);
    }
  });
  it("returns nothing for a blank picture", () => {
    expect(detectCornersByShape(image(() => {}))).toBeNull();
  });
});

describe("printed coordinates", () => {
  it("reads a–h and 1–8 and turns a quad that was named backwards", () => {
    const img = boardImage(rect, (dark) => (dark ? [40, 40, 40] : [220, 220, 220]), [30, 30, 30]);
    paintLabels(img, rect);
    const backwards = [rect[2], rect[3], rect[0], rect[1]];
    const named = applyBorderLabels(img, backwards);
    expect(named.labels, named.notes).toBe(true);
    near(named.corners, rect, 1);
    const upright = applyBorderLabels(img, rect);
    expect(upright.labels, upright.notes).toBe(true);
    near(upright.corners, rect, 1);
  });
});

describe("AI and the combined detector", () => {
  const reply = (corners: Pt[]) => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({ corners: corners.map((p, i) => ({ name: ["a8", "h8", "h1", "a1"][i], x: p.x / 2, y: p.y / 2 })) }) } }] }),
  });

  it("encodes a real PNG", () => {
    const img = boardImage(rect, (dark) => (dark ? [0, 0, 0] : [255, 255, 255]));
    const bytes = Uint8Array.from(atob(pngBase64(img)), (c) => c.charCodeAt(0));
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    let o = 8, idat = new Uint8Array();
    while (o < bytes.length) {
      const n = new DataView(bytes.buffer).getUint32(o), type = String.fromCharCode(...bytes.subarray(o + 4, o + 8));
      if (type === "IDAT") idat = bytes.subarray(o + 8, o + 8 + n);
      o += 12 + n;
    }
    const raw = inflateSync(idat);
    expect(raw.length).toBe(FRAME_H * (1 + FRAME_W * 3));
    expect(raw[0]).toBe(0);
  });

  it("uses the shape when there is no key, and does not call AI", async () => {
    const img = boardImage(rect, (dark) => (dark ? [40, 40, 40] : [200, 200, 200]));
    const fetch = vi.fn();
    const r = await detectBoardCorners(img, { doFetch: fetch });
    expect(fetch).not.toHaveBeenCalled();
    near(r.corners!, rect, 8);
    expect(r.detail).toContain("checkerboard");
    expect(r.detail).toContain("bottom of the picture");
  });

  it("names the corners from printed labels", async () => {
    const img = boardImage(rect, (dark) => (dark ? [40, 40, 40] : [210, 210, 210]));
    paintLabels(img, rect);
    const r = await detectBoardCorners(img);
    near(r.corners!, rect, 8);
    expect(r.detail).toContain("printed coordinates");
  });

  it("averages AI with the measured board when they agree, and scales the model's pixels back up", async () => {
    const img = boardImage(rect, (dark) => (dark ? [40, 40, 40] : [210, 210, 210]));
    // the picture is wider than 240, so it is halved; the model replies in that smaller image
    const fetch = vi.fn(async () => reply(rect));
    const r = await detectBoardCorners(img, { apiKey: "sk-test", doFetch: fetch as unknown as typeof fetch });
    expect(fetch).toHaveBeenCalledOnce();
    const body = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, { body: string }])[1].body));
    expect(body.model).toBe("gpt-4.1-mini");
    expect(body.messages[1].content[1].image_url.url).toMatch(/^data:image\/png;base64,/);
    near(r.corners!, rect, 8);
    expect(r.detail).toContain("AI agreed");
  });

  it("keeps the measured board when AI points somewhere else", async () => {
    const img = boardImage(rect, (dark) => (dark ? [40, 40, 40] : [210, 210, 210]));
    const elsewhere = [{ x: 10, y: 10 }, { x: 200, y: 12 }, { x: 190, y: 160 }, { x: 20, y: 150 }];
    const fetch = vi.fn(async () => reply(elsewhere));
    const r = await detectBoardCorners(img, { apiKey: "sk-test", doFetch: fetch as unknown as typeof fetch });
    near(r.corners!, rect, 8);
    expect(r.detail).toContain("measured corners were kept");
  });

  it("uses AI alone when the picture has no checkerboard, and reports a failure without throwing away a measured board", async () => {
    const blank = image((data) => { for (let i = 0; i < data.length; i += 4) { data[i] = data[i + 1] = data[i + 2] = 20; data[i + 3] = 255; } });
    const guess = [{ x: 30, y: 30 }, { x: 200, y: 28 }, { x: 210, y: 180 }, { x: 24, y: 176 }];
    const fetch = vi.fn(async () => reply(guess));
    const only = await detectBoardCorners(blank, { apiKey: "sk-test", doFetch: fetch as unknown as typeof fetch });
    near(only.corners!, guess, 2);
    expect(only.detail).toContain("AI");
    const img = boardImage(rect, (dark) => (dark ? [40, 40, 40] : [210, 210, 210]));
    const down = vi.fn(async () => ({ ok: false, json: async () => ({}) }));
    const kept = await detectBoardCorners(img, { apiKey: "sk-test", doFetch: down as unknown as typeof fetch });
    near(kept.corners!, rect, 8);
    expect(kept.detail).toContain("could not be reached");
  });

  it("says so when nothing can see a board", async () => {
    const blank = image(() => {});
    const r = await detectBoardCorners(blank);
    expect(r.corners).toBeNull();
    expect(r.detail).toContain("not found");
  });
});
