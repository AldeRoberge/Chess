import type { Surface } from "./planes";
import type { ProjectorDef } from "./projector";

export interface MappingConfig {
  surfaces: Surface[];
  projectors: ProjectorDef[];
  feather: number;
  gamma: number;
  /** camera->projector homographies learned by auto-calibration, keyed by projector id */
  calibration: Record<string, { camToProj: number[]; rms: number }>;
}

export function defaultRoom(): Surface[] {
  const W = 2.2, H = 2.6, D = 2.8;
  const mk = (id: string, kind: Surface["kind"], n: [number, number, number], c: [number, number, number], u: [number, number, number], v: [number, number, number], hw: number, hh: number): Surface => ({ id, kind, normal: n, center: c, u, v, halfW: hw, halfH: hh, inliers: 0 });
  return [
    mk("floor", "floor", [0, 1, 0], [0, 0, 0], [1, 0, 0], [0, 0, 1], W, D),
    mk("ceiling", "ceiling", [0, -1, 0], [0, H, 0], [1, 0, 0], [0, 0, 1], W, D),
    mk("wall-back", "wall", [0, 0, 1], [0, H / 2, -D], [1, 0, 0], [0, 1, 0], W, H / 2),
    mk("wall-front", "wall", [0, 0, -1], [0, H / 2, D], [1, 0, 0], [0, 1, 0], W, H / 2),
    mk("wall-left", "wall", [1, 0, 0], [-W, H / 2, 0], [0, 0, 1], [0, 1, 0], D, H / 2),
    mk("wall-right", "wall", [-1, 0, 0], [W, H / 2, 0], [0, 0, 1], [0, 1, 0], D, H / 2),
  ];
}

export function defaultMapping(): MappingConfig {
  return {
    surfaces: defaultRoom(),
    projectors: [
      { id: "wall-L", pos: [-1, 2.3, 2.4], target: [1.2, 1.2, -2.8], fovY: 45, aspect: 16 / 9 },
      { id: "wall-R", pos: [1, 2.3, 2.4], target: [-1.2, 1.2, -2.8], fovY: 45, aspect: 16 / 9 },
      { id: "table", pos: [0, 2.4, 0.05], target: [0, 0.75, 0], fovY: 40, aspect: 16 / 9 },
    ],
    feather: 0.25, gamma: 2.2, calibration: {},
  };
}

const KEY = "cx.mapping.v1";
export const loadMapping = (): MappingConfig => {
  try { const s = localStorage.getItem(KEY); if (s) return { ...defaultMapping(), ...JSON.parse(s) }; } catch { /* first run / private mode */ }
  return defaultMapping();
};
export const saveMapping = (m: MappingConfig) => { try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* ignore */ } };
