import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { PROFILES } from "./profiles";

const cache = new Map<string, THREE.BufferGeometry>();
const SEGMENTS = 48; // smooth silhouettes; 32 pieces x 48 segments is still cheap on integrated-class GPUs

/** Plinth-only lathe for the knight: its head is an extruded horse silhouette instead of a turned shape. */
const KNIGHT_BASE: [number, number][] = [[0, 0], [0.5, 0], [0.5, 0.05], [0.44, 0.1], [0.36, 0.15], [0.3, 0.22], [0.28, 0.3], [0, 0.3]];

function turned(profile: [number, number][]): THREE.BufferGeometry {
  return new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), SEGMENTS).toNonIndexed();
}
function block(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g.toNonIndexed();
}

/** Side silhouette of a horse head facing +x, in piece units (base sits at y≈0.2). */
function knightHead(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-0.2, 0.2);
  s.lineTo(-0.27, 0.5);
  s.quadraticCurveTo(-0.31, 0.75, -0.18, 0.95);   // back of the neck up to the ears
  s.lineTo(-0.12, 1.12);                          // ear tip
  s.lineTo(-0.02, 1.0);
  s.quadraticCurveTo(0.1, 0.95, 0.2, 0.85);       // forehead to muzzle
  s.quadraticCurveTo(0.34, 0.8, 0.36, 0.66);      // nose
  s.quadraticCurveTo(0.37, 0.56, 0.28, 0.52);     // mouth
  s.quadraticCurveTo(0.2, 0.5, 0.16, 0.42);       // chin
  s.quadraticCurveTo(0.2, 0.3, 0.22, 0.2);        // throat and chest
  s.lineTo(-0.2, 0.2);
  const depth = 0.2, bevel = 0.035;
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 14 });
  g.translate(0, 0, -depth / 2);
  return g.toNonIndexed();
}

/** Mesh geometry for a piece type: the shared silhouette plus the detail a lathe cannot make. */
function build(type: string): THREE.BufferGeometry {
  switch (type) {
    case "n": return mergeGeometries([turned(KNIGHT_BASE), knightHead()])!;
    case "r": { // four merlons on the parapet ring
      const m = 0.16, y = 0.95, d = 0.32;
      return mergeGeometries([turned(PROFILES.r),
        block(m, 0.1, m, d, y, 0), block(m, 0.1, m, -d, y, 0), block(m, 0.1, m, 0, y, d), block(m, 0.1, m, 0, y, -d)])!;
    }
    case "k": { // cross on the crown
      return mergeGeometries([turned(PROFILES.k),
        block(0.07, 0.2, 0.07, 0, 1.52, 0), block(0.2, 0.06, 0.06, 0, 1.54, 0)])!;
    }
    default: return turned(PROFILES[type]);
  }
}

/** Shared geometry per piece type (cached; the view reuses it for every piece of that type). */
export function pieceGeometry(type: string): THREE.BufferGeometry {
  let g = cache.get(type);
  if (g) return g;
  g = build(type);
  cache.set(type, g);
  return g;
}
