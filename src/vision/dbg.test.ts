import { readFileSync } from "node:fs";
import { it } from "vitest";
import { applyH, boardToImage } from "./homography";
import { parseCorners } from "../plugins/shared";
it.skipIf(!process.env.DBG)("dbg", () => {
  const w = 480, h = 360, d = new Uint8ClampedArray(readFileSync("src/vision/fixtures/real-start-B.gray"));
  const H = boardToImage(parseCorners("304,55;397,216;147,292;112,93")!);
  const px = (x: number, y: number) => { const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0; return d[y0 * w + x0] * (1 - tx) * (1 - ty) + d[y0 * w + x0 + 1] * tx * (1 - ty) + d[(y0 + 1) * w + x0] * (1 - tx) * ty + d[(y0 + 1) * w + x0 + 1] * tx * ty; };
  let out = "";
  for (let r = 0; r < 8; r++) {
    let line = "";
    for (let c = 0; c < 8; c++) {
      const vals: number[] = [];
      for (let j = 0; j < 9; j++) for (let i = 0; i < 9; i++) { const q = applyH(H, c + 0.2 + (i / 8) * 0.6, r + 0.2 + (j / 8) * 0.6); vals.push(px(q.x, q.y)); }
      const m = vals.reduce((a, b) => a + b) / vals.length, sd = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length);
      const t = r < 2 ? "b" : r > 5 ? "w" : ".";
      line += `${t}${(r + c) % 2 ? "d" : "l"} ${String(Math.round(m)).padStart(3)} sd${String(Math.round(sd)).padStart(3)} | `;
    }
    out += line + "\n";
  }
  console.log(out);
});
