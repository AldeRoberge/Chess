import * as THREE from "three";
import type { ProjectorDef } from "../mapping/projector";

export function projectorCamera(p: ProjectorDef): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(p.fovY, p.aspect, 0.05, 40);
  cam.position.set(...p.pos);
  cam.up.set(0, 1, 0);
  cam.lookAt(new THREE.Vector3(...p.target));
  if (p.rollDeg) cam.rotateZ((p.rollDeg * Math.PI) / 180);
  cam.updateMatrixWorld(true);
  return cam;
}

const MAX = 4;
/**
 * Projector-space edge blending, done per fragment: every projector's view-projection is passed
 * in, each fragment measures how deep inside each frustum it sits, and this projector's share is
 * (w_self / sum) ^ (1 / gamma) so overlaps stay constant in brightness.
 */
export function makeBlendMaterial(tex: THREE.Texture, projs: ProjectorDef[], self: number, feather: number, gamma: number) {
  const vps = Array.from({ length: MAX }, () => new THREE.Matrix4());
  projs.slice(0, MAX).forEach((p, i) => { const c = projectorCamera(p); vps[i].multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse); });
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { map: { value: tex }, vps: { value: vps }, count: { value: Math.min(MAX, projs.length) }, self: { value: self }, feather: { value: feather }, gamma: { value: gamma } },
    vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform sampler2D map; uniform mat4 vps[${MAX}]; uniform int count; uniform int self; uniform float feather; uniform float gamma;
      varying vec2 vUv; varying vec3 vW;
      float edge(vec2 n){ vec2 k = clamp((1.0 - abs(n)) / feather, 0.0, 1.0); k = k*k*(3.0-2.0*k); return k.x*k.y; }
      void main(){
        float sum = 0.0, mine = 0.0;
        for (int i = 0; i < ${MAX}; i++) {
          if (i >= count) break;
          vec4 c = vps[i] * vec4(vW, 1.0);
          float w = c.w > 0.0 ? edge(c.xy / c.w) : 0.0;
          sum += w; if (i == self) mine = w;
        }
        float share = sum > 0.0 ? pow(mine / sum, 1.0 / gamma) : 0.0;
        gl_FragColor = vec4(texture2D(map, vUv).rgb * share, 1.0);
      }`,
  });
}
