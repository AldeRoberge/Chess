import * as THREE from "three";
import type { MappingConfig } from "../mapping/store";
import { SceneRenderer } from "../scene/renderer";
import type { SceneState } from "../scene/types";
import { drawTableOverlay, type OverlayInput } from "./overlay";
import { makeBlendMaterial, projectorCamera } from "./blend";
import { SQUARE, TABLE_Y } from "./coords";
import { projectableSurfaces, surfaceMesh } from "./surfaces";

/**
 * One projector's output: renders the room's surfaces (scanned or default) from the projector's
 * own pose, textured with the live scene, edge-blended against the other projectors, plus the
 * table overlay (move hints, hover menu). Black everywhere else, so it only lights real surfaces.
 */
export class ProjectorOutput {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam: THREE.PerspectiveCamera;
  private content = document.createElement("canvas");
  private cctx = this.content.getContext("2d")!;
  private overlay = document.createElement("canvas");
  private octx = this.overlay.getContext("2d")!;
  private contentTex = new THREE.CanvasTexture(this.content);
  private overlayTex = new THREE.CanvasTexture(this.overlay);
  private scr = new SceneRenderer();
  private last = 0;
  private margin = 3;

  constructor(public canvas: HTMLCanvasElement, private cfg: MappingConfig, private index: number, quality = 0.5) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(quality);
    this.content.width = 768; this.content.height = 432;
    this.overlay.width = this.overlay.height = (8 + this.margin * 2) * 48;
    this.contentTex.colorSpace = THREE.SRGBColorSpace; this.overlayTex.colorSpace = THREE.SRGBColorSpace;
    this.rebuild(cfg, index);
    this.cam = projectorCamera(cfg.projectors[index]);
  }

  rebuild(cfg: MappingConfig, index: number) {
    this.cfg = cfg; this.index = index;
    this.scene.clear();
    const mat = makeBlendMaterial(this.contentTex, cfg.projectors, index, cfg.feather, cfg.gamma);
    for (const s of projectableSurfaces(cfg.surfaces)) this.scene.add(surfaceMesh(s, mat));
    const size = (8 + this.margin * 2) * SQUARE;
    const ov = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: this.overlayTex, transparent: true, depthWrite: false }));
    ov.rotation.x = -Math.PI / 2; ov.position.y = TABLE_Y + 0.002;
    this.scene.add(ov);
    this.cam = projectorCamera(cfg.projectors[index]);
  }

  resize(w: number, h: number) { this.renderer.setSize(w, h, false); }

  render(state: SceneState, overlay: OverlayInput, now: number) {
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0.016; this.last = now;
    this.scr.draw(this.cctx, this.content.width, this.content.height, state, now, dt);
    this.contentTex.needsUpdate = true;
    drawTableOverlay(this.octx, 48, this.margin, overlay, now / 1000);
    this.overlayTex.needsUpdate = true;
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.render(this.scene, this.cam);
  }

  dispose() { this.renderer.dispose(); }
}
