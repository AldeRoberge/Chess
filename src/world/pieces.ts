import * as THREE from "three";
import { PROFILES } from "./profiles";

const cache = new Map<string, THREE.BufferGeometry>();
/** Smooth-shaded lathe silhouettes: 32 pieces at 28 segments is still cheap on integrated-class GPUs. */
export function pieceGeometry(type: string): THREE.BufferGeometry {
  let g = cache.get(type);
  if (g) return g;
  g = new THREE.LatheGeometry(PROFILES[type].map(([x, y]) => new THREE.Vector2(x, y)), 28);
  cache.set(type, g);
  return g;
}
