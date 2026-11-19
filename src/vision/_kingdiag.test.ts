import { Chess } from "chess.js";
import { describe, it } from "vitest";
import { render3D } from "../sim/render3d";
import { FRAME_H, FRAME_W, RIGS, rigCorners } from "../sim/rigs";
import { VirtualTable } from "../sim/virtualTable";
import { SQUARE, TABLE_Y, boardToWorld } from "../world/coords";
import { profileHeight } from "../world/profiles";
import { cameraBasis } from "../sim/camera";
import { cameraPoseFromBoard } from "./boardPose";
import { applyH, boardToImage, invertH } from "./homography";
import { BoardSampler, defaultSamplerConfig } from "./sampler";
import { sqName } from "./types";

const shoot = (table: VirtualTable, rig: typeof RIGS.A) =>
  render3D(table.scene3d(), { width: FRAME_W, height: FRAME_H, rig, noise: 0, gradient: 0.12, shadows: true, seed: 1, t: 1 });

function report(label: string, rig: typeof RIGS.A, fen: string) {
  const start = new VirtualTable();
  const moved = new VirtualTable();
  moved.game.load(fen);
  const corners = rigCorners(rig);
  const s = new BoardSampler("A", { ...defaultSamplerConfig(), corners, threshold: 0.1 });
  s.calibrateFromStart(shoot(start, rig));
  const frame = shoot(moved, rig);
  const o = s.read(frame);
  (s as unknown as { tone: null }).tone = null;
  const bare = s.read(frame);
  const truth = new Chess(fen);
  const bad: string[] = [];
  truth.board().flat().forEach((p, i) => {
    const seen = o.occ[i] > 0.5;
    if (seen !== !!p) bad.push(`${sqName(i)} ${p ? p.color + p.type : "empty"} occ=${o.occ[i].toFixed(2)}`);
  });
  const basis = cameraBasis(rig, FRAME_W, FRAME_H);
  const [x, y, z] = boardToWorld(4.5, 7.5);
  const base = basis.project([x, y, z]);
  const top = basis.project([x, y + profileHeight("k") * SQUARE * 0.8, z]);
  const sqPx = base ? Math.hypot(basis.project(boardToWorld(5.5, 7.5))!.x - base.x, basis.project(boardToWorld(5.5, 7.5))!.y - base.y) : 1;
  const shiftSq = base && top ? Math.hypot(top.x - base.x, top.y - base.y) / sqPx : NaN;
  if (base && top) {
    const back = applyH(invertH(boardToImage(corners)), top.x, top.y);
    console.log("  crown of e1 lands on board", back.x.toFixed(2), back.y.toFixed(2), "delta", (back.x - 4.5).toFixed(2), (back.y - 7.5).toFixed(2));
  }
  const focus = ["e1", "e2", "d4", "e4", "d5", "e5", "e8", "f1", "d1"].map((n) => {
    const d = s.diagnose(frame, "abcdefgh".indexOf(n[0]) + (8 - Number(n[1])) * 8);
    return `${n} drive=${d.drive.toFixed(0)} gate=${d.gate.toFixed(0)} spr=${d.spread.toFixed(1)}/${d.spreadGate.toFixed(1)}`;
  });
    const e2 = "abcdefgh".indexOf("e") + (8 - 2) * 8;
    console.log(label, "lean", JSON.stringify(s.lean()), "kingShiftSq", shiftSq.toFixed(2), "e2", o.occ[e2].toFixed(2), "e2bare", bare.occ[e2].toFixed(2), "bad", bad.join(" | ") || "none");
  console.log("  ", focus.join("  "));
}

describe("king diag", () => {
  it("prints misses", () => {
    const kingOut = "rnbq1bnr/pppppppp/8/4k3/4K3/8/PPPPPPPP/RNBQ1BNR w - - 0 1";
    const ke2 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPPKPPP/RNBQ1BNR w kq - 0 2";
    const side: typeof RIGS.A = { id: "side", pos: [0.55, TABLE_Y + 0.32, 0.05], target: [0, TABLE_Y, 0], fovY: 50 };
    report("side-center", side, kingOut);
    report("side-ke2", side, ke2);
    report("C-ke2", RIGS.C, ke2);
    const user = [{ x: 302, y: 46 }, { x: 415, y: 198 }, { x: 177, y: 298 }, { x: 114, y: 99 }];
    for (const fov of [42, 55, 70]) {
      const pose = cameraPoseFromBoard(user, 480, 360, fov);
      const rig = { id: "user", pos: pose.pos, target: pose.target, fovY: fov };
      const b = cameraBasis(rig, 480, 360);
      const [x, y, z] = boardToWorld(3.5, 3.5);
      const base = b.project([x, y, z])!, top = b.project([x, y + profileHeight("k") * SQUARE * 0.8, z])!;
      const back = applyH(invertH(boardToImage(user)), top.x, top.y);
      console.log("user fov", fov, "pos", pose.pos.map((v) => v.toFixed(2)).join(","), "crownDelta", (back.x - 3.5).toFixed(2), (back.y - 3.5).toFixed(2));
    }
  });
});
