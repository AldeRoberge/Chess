import * as THREE from "three";
import type { Surface } from "../mapping/planes";

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
