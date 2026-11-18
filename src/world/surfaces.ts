import * as THREE from "three";
import type { Surface } from "../mapping/planes";

/** Surfaces to project onto: walls (and other planes) only. Floor/ceiling are skipped unless the room has nothing else. */
export function projectableSurfaces(all: Surface[]): Surface[] {
  const keep = all.filter((s) => s.kind !== "floor" && s.kind !== "ceiling");
  return keep.length ? keep : all;
}

export function surfaceMesh(s: Surface, material: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(s.halfW * 2, s.halfH * 2), material);
  const u = new THREE.Vector3(...s.u), v = new THREE.Vector3(...s.v);
  const n = new THREE.Vector3().crossVectors(u, v);
  m.matrixAutoUpdate = false;
  m.matrix.makeBasis(u, v, n).setPosition(...s.center);
  m.matrixWorldNeedsUpdate = true;
  m.userData.surface = s;
  return m;
}
