import { it } from "vitest";
import { VirtualTable } from "../sim/virtualTable";
import { shoot } from "../test/helpers";
import { Fusion } from "./fusion";
import { BoardSampler, defaultSamplerConfig } from "./sampler";

it("scratch: empty-square occ/conf", () => {
  for (const cam of ["A", "B"] as const) {
    const t = new VirtualTable(), s = new BoardSampler(cam, defaultSamplerConfig());
    s.calibrateFromStart(shoot(t, cam, 0, 4, 2));
    const o = s.read(shoot(t, cam, 100, 6, 3));
    const f = new Fusion().fuse([o], o.t);
    const rows: string[] = [];
    for (let r = 2; r < 6; r++) rows.push(Array.from({ length: 8 }, (_, c) => `${o.occ[r * 8 + c].toFixed(2)}/${f.conf[r * 8 + c].toFixed(2)}`).join(" "));
    console.log(cam, "quality", o.quality, "\n" + rows.join("\n"));
  }
});
