import { bus, type PoseData } from "../core/bus";
import type { NodeSpec, Plugin } from "../core/types";
import type { PointerSample, Seat } from "../experience/director";
import { virtualTable } from "../sim/virtualTable";
import { cameraMatrix, rayToPlane, triangulate, type ProjMat } from "../vision/triangulate";
import type { GrayFrame, Pt } from "../vision/types";
import { SQUARE, TABLE_Y, worldToBoard } from "../world/coords";

// MediaPipe BlazePose (33 landmarks) -> COCO-17 order used by BONES / JOINT_NAMES
const COCO_FROM_BLAZE = [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const MODEL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";
const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm";

interface PoseState { lm: any; loading: boolean; canvas: HTMLCanvasElement | null; last: number; rr: number; joints: (Pt | null)[][]; poses: PoseData[]; seats: Seat[]; pointers: PointerSample[]; err: string; failedAt: number }

function parseCam(s: string): [[number, number, number], [number, number, number], number] | null {
  const p = s.split(";").map((x) => x.split(",").map(Number));
  return p.length === 3 && p[0].length === 3 && p[1].length === 3 && p[2].length === 1 && p.flat().every(Number.isFinite) ? [p[0] as [number, number, number], p[1] as [number, number, number], p[2][0]] : null;
}

const pose: NodeSpec<PoseState> = {
  type: "tracking.pose", title: "People (Pose → 3D)", category: "Tracking",
  inputs: [{ id: "f1", type: "frame" }, { id: "f2", type: "frame" }, { id: "f3", type: "frame" }],
  outputs: [{ id: "poses", type: "pose" }, { id: "seats", type: "seat" }, { id: "pointers", type: "pointer" }],
  params: [
    { id: "enabled", kind: "bool", label: "Run pose model", value: false },
    { id: "cam1", kind: "text", label: "Camera 1 placement", value: "-1.6,2.2,1.6;0,0.75,0;60" },
    { id: "cam2", kind: "text", label: "Camera 2 placement", value: "1.6,2.2,1.6;0,0.75,0;60" },
    { id: "cam3", kind: "text", label: "Camera 3 placement", value: "0,2.3,-1.8;0,0.75,0;60" },
    { id: "seat", kind: "text", label: "Seat zone", value: "0,0.8,0" },
    { id: "fps", kind: "number", label: "Pose FPS", min: 1, max: 15, step: 1, value: 6 },
  ],
  init: () => ({ lm: null, loading: false, canvas: null, last: 0, rr: 0, joints: [[], [], []], poses: [], seats: [], pointers: [], err: "", failedAt: -1e9 }),
  process(inputs, { params, state, now, setFidelity }) {
    if (!params.enabled) { setFidelity(null); return { poses: [], seats: [], pointers: [] }; }
    if (!state.lm && !state.loading && now - state.failedAt > 30000) { // a failed load retries every 30 s, not every frame
      state.loading = true;
      void (async () => {
        try {
          const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
          const fs = await FilesetResolver.forVisionTasks(WASM);
          state.lm = await PoseLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: MODEL, delegate: "GPU" }, runningMode: "IMAGE", numPoses: 1 });
        } catch (e) { state.err = String(e); state.loading = false; state.failedAt = now; }
      })();
    }
    const frames = [inputs.f1, inputs.f2, inputs.f3] as (GrayFrame | undefined)[];
    if (state.lm && now - state.last >= 1000 / Number(params.fps) / 3) {
      state.last = now;
      const k = state.rr++ % 3, f = frames[k];
      if (!f) state.joints[k] = [];
      else {
        const c = (state.canvas ??= document.createElement("canvas"));
        c.width = f.width; c.height = f.height;
        const ctx = c.getContext("2d")!, img = ctx.createImageData(f.width, f.height);
        for (let i = 0; i < f.data.length; i++) img.data.fill(f.data[i], i * 4, i * 4 + 3), (img.data[i * 4 + 3] = 255);
        ctx.putImageData(img, 0, 0);
        const r = state.lm.detect(c);
        const lm = r.landmarks?.[0];
        state.joints[k] = lm ? COCO_FROM_BLAZE.map((bi) => (lm[bi].visibility > 0.4 ? { x: lm[bi].x * f.width, y: lm[bi].y * f.height } : null)) : [];
      }
    }
    // triangulate every joint seen by >= 2 calibrated cameras; single-camera feet land on the floor plane
    const mats: (ProjMat | null)[] = ["cam1", "cam2", "cam3"].map((n) => { const c = parseCam(String(params[n])); return c ? cameraMatrix(c[0], c[1], c[2], 480, 360) : null; });
    const joints: ([number, number, number] | null)[] = [];
    for (let j = 0; j < 17; j++) {
      const Ps: ProjMat[] = [], pts: Pt[] = [];
      state.joints.forEach((js, k) => { const p = js[j]; if (p && mats[k] && frames[k]) { Ps.push(mats[k]!); pts.push(p); } });
      let w = Ps.length >= 2 ? triangulate(Ps, pts) : null;
      if (!w && Ps.length === 1 && (j === 15 || j === 16)) w = rayToPlane([0, 0, 0], Ps[0], pts[0], 0);
      joints.push(w);
    }
    const seen = joints.filter(Boolean).length;
    state.poses = seen > 4 ? [{ id: "p1", joints }] : [];
    setFidelity(seen / 17);
    // seat occupancy from the hip midpoint; wrists near the table top become pointers
    const [sx, sz, face] = String(params.seat).split(",").map(Number);
    const hl = joints[11], hr = joints[12];
    const hip = hl && hr ? [(hl[0] + hr[0]) / 2, (hl[2] + hr[2]) / 2] : null;
    state.seats = hip && Math.hypot(hip[0] - sx, hip[1] - sz) < 0.5 ? [{ id: "seat1", ...worldToBoard(sx, sz), angle: face }] : [];
    state.pointers = [];
    for (const wi of [9, 10]) { const w = joints[wi]; if (w && w[1] < TABLE_Y + 0.2 && Math.abs(w[0]) < SQUARE * 6 && Math.abs(w[2]) < SQUARE * 6) state.pointers.push({ id: `w${wi}`, ...worldToBoard(w[0], w[2]) }); }
    bus.poses = state.poses;
    return { poses: state.poses, seats: state.seats, pointers: state.pointers };
  },
  dispose: (s) => s.lm?.close?.(),
};

/** Fake people for the 3D sim when no pose model/cameras are running. */
const simPose: NodeSpec = {
  type: "sim.pose", title: "Virtual Person (3D)", category: "Tracking",
  inputs: [], outputs: [{ id: "poses", type: "pose" }],
  params: [{ id: "show", kind: "bool", label: "Show seated person", value: true }],
  process(_i, { params }) {
    if (!params.show || !virtualTable.seated) { bus.poses = []; return { poses: [] }; }
    const z = 0.82, y = 0.45;
    const j: ([number, number, number] | null)[] = [[0, 1.15, z], [-0.03, 1.18, z - 0.03], [0.03, 1.18, z - 0.03], [-0.08, 1.15, z], [0.08, 1.15, z], [-0.18, 0.95, z], [0.18, 0.95, z], [-0.2, 0.75, z - 0.15], [0.2, 0.75, z - 0.15], virtualTable.hand ? [-0.12, 0.8, z - 0.45] : [-0.1, 0.75, z - 0.3], [0.1, 0.78, z - 0.3], [-0.1, y + 0.08, z], [0.1, y + 0.08, z], [-0.1, y, z - 0.3], [0.1, y, z - 0.3], [-0.1, 0, z - 0.32], [0.1, 0, z - 0.32]];
    for (const arm of virtualTable.arms()) if (arm.side === 1) { const L = arm.hand === "L" ? 0 : 1; j[5 + L] = arm.shoulder; j[7 + L] = arm.elbow; j[9 + L] = arm.wrist; } // the same IK arms the cameras see
    bus.poses = [{ id: "sim", joints: j }];
    return { poses: bus.poses };
  },
};

export const trackingPlugin: Plugin = { id: "tracking", name: "Tracking", register: (r) => { r.register(pose); r.register(simPose); } };
