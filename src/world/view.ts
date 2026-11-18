import { Chess } from "chess.js";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { bus } from "../core/bus";
import type { MappingConfig } from "../mapping/store";
import { SceneRenderer } from "../scene/renderer";
import { virtualTable } from "../sim/virtualTable";
import { LIGHT } from "../sim/shadow";
import { BONES } from "../vision/triangulate";
import { boardTheme, onBoardTheme, type BoardTheme } from "../ui/boardThemes";
import { SHADOW_MAP, dueFrame, onViewSettings, pixelRatio, viewSettings } from "../ui/viewSettings";
import { SQUARE, TABLE_Y, boardToWorld } from "./coords";
import { projectorCamera } from "./blend";
import { drawTableOverlay } from "./overlay";
import { pieceGeometry } from "./pieces";
import { surfaceMesh } from "./surfaces";

/** The simulation model: room, table + board, chairs, people, projector frusta, live projected content. */
export class WorldView {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(50, 1, 0.05, 50);
  private controls: OrbitControls;
  private content = document.createElement("canvas");
  private cctx = this.content.getContext("2d")!;
  private contentTex: THREE.CanvasTexture;
  private room = new THREE.Group();
  private frusta = new THREE.Group();
  private pieces = new THREE.Group();
  private people = new THREE.Group();
  private arms = new THREE.Group();
  private armGeo = new Map<string, THREE.CapsuleGeometry>();
  private armKey = "";
  private skin = new THREE.MeshStandardMaterial({ color: 0xd9a98a, roughness: 0.6 });
  private sleeve = new THREE.MeshStandardMaterial({ color: 0x3a4a63, roughness: 0.85 });
  private overlayCanvas = document.createElement("canvas");
  private octx = this.overlayCanvas.getContext("2d")!;
  private overlayTex: THREE.CanvasTexture;
  private scr = new SceneRenderer();
  private pieceKey = "";
  private lastDraw = 0;
  private lastOverlay = 0;
  private matW = new THREE.MeshStandardMaterial({ color: 0xf6f3e8, roughness: 0.32, metalness: 0.05 });
  private matB = new THREE.MeshStandardMaterial({ color: 0x3b3a3f, roughness: 0.3, metalness: 0.1 });
  private lamp!: THREE.SpotLight;
  private lastFrame = 0;
  showFrusta = true;
  showProjection = true;

  constructor(private canvas: HTMLCanvasElement, private cfg: MappingConfig) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: viewSettings().render.aa, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(pixelRatio(viewSettings().render.scale));
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false; this.renderer.shadowMap.needsUpdate = true; // re-rendered only when pieces or arms move
    this.scene.background = new THREE.Color(0x05070c);
    this.cam.position.set(1.3, 1.5, 1.7); // close to the table: the board is what matters
    this.controls = new OrbitControls(this.cam, canvas);
    this.controls.target.set(0, 0.8, 0); this.controls.enableDamping = true;
    this.content.width = 640; this.content.height = 360;
    this.contentTex = new THREE.CanvasTexture(this.content); this.contentTex.colorSpace = THREE.SRGBColorSpace;
    this.overlayCanvas.width = this.overlayCanvas.height = 14 * 48;
    this.overlayTex = new THREE.CanvasTexture(this.overlayCanvas); this.overlayTex.colorSpace = THREE.SRGBColorSpace;

    this.scene.add(new THREE.HemisphereLight(0x8899cc, 0x221a14, 0.8));
    const key = new THREE.PointLight(0xfff0d8, 8, 8); key.position.set(0, 2.3, 0); this.scene.add(key);
    const lamp = new THREE.SpotLight(0xfff0d8, 6, 0, 0.6, 0.8, 2); // the same lamp the virtual cameras' shadows come from
    lamp.position.set(...LIGHT); lamp.target.position.set(0, TABLE_Y, 0); lamp.castShadow = true;
    lamp.shadow.mapSize.set(1024, 1024); lamp.shadow.bias = -0.0004; lamp.shadow.radius = 4;
    this.lamp = lamp; this.scene.add(lamp, lamp.target);
    this.applySettings(); onViewSettings(() => this.applySettings());
    this.scene.add(this.room, this.frusta, this.pieces, this.people, this.arms);
    this.buildTable();
    this.setMapping(cfg);
  }

  setMapping(cfg: MappingConfig) {
    this.cfg = cfg;
    this.room.clear(); this.frusta.clear();
    const mat = new THREE.MeshBasicMaterial({ map: this.contentTex, side: THREE.DoubleSide, transparent: true, opacity: this.showProjection ? 0.95 : 0 });
    for (const s of cfg.surfaces) { const m = surfaceMesh(s, mat); this.room.add(m); }
    const colors = [0xff6b6b, 0x6bd0ff, 0xb8ff6b, 0xffd36b];
    cfg.projectors.forEach((p, i) => {
      const cam = projectorCamera(p); cam.far = 4;
      const h = new THREE.CameraHelper(cam); h.setColors(new THREE.Color(colors[i % 4]), new THREE.Color(colors[i % 4]), new THREE.Color(0x445), new THREE.Color(0x445), new THREE.Color(0x445));
      this.frusta.add(h);
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.22), new THREE.MeshStandardMaterial({ color: colors[i % 4] }));
      body.position.set(...p.pos); this.frusta.add(body);
    });
  }

  private buildTable() {
    const wood = new THREE.MeshStandardMaterial({ color: 0x4b3424, roughness: 0.7 });
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.04, 0.9), wood); top.position.y = TABLE_Y - 0.02; top.receiveShadow = true; this.scene.add(top);
    for (const [x, z] of [[-0.6, -0.4], [0.6, -0.4], [-0.6, 0.4], [0.6, 0.4]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.05, TABLE_Y, 0.05), wood); l.position.set(x, TABLE_Y / 2, z); this.scene.add(l); }
    const bc = document.createElement("canvas"); bc.width = bc.height = 512; const c = bc.getContext("2d")!;
    const bt = new THREE.CanvasTexture(bc); bt.colorSpace = THREE.SRGBColorSpace;
    const paint = (t: BoardTheme) => { for (let i = 0; i < 64; i++) { c.fillStyle = ((i % 8) + Math.floor(i / 8)) % 2 ? t.dark : t.light; c.fillRect((i % 8) * 64, Math.floor(i / 8) * 64, 64, 64); } bt.needsUpdate = true; };
    paint(boardTheme()); onBoardTheme(paint);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(SQUARE * 8, SQUARE * 8), new THREE.MeshStandardMaterial({ map: bt }));
    board.receiveShadow = true; board.rotation.x = -Math.PI / 2; board.position.y = TABLE_Y + 0.001; this.scene.add(board);
    const ov = new THREE.Mesh(new THREE.PlaneGeometry(SQUARE * 14, SQUARE * 14), new THREE.MeshBasicMaterial({ map: this.overlayTex, transparent: true, depthWrite: false }));
    ov.rotation.x = -Math.PI / 2; ov.position.y = TABLE_Y + 0.003; this.scene.add(ov);
    const chairMat = new THREE.MeshStandardMaterial({ color: 0x38404f });
    for (const s of [1, -1]) {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.05, 0.45), chairMat); seat.position.set(0, 0.45, s * 0.85);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.5, 0.05), chairMat); back.position.set(0, 0.72, s * 1.07);
      this.scene.add(seat, back);
    }
  }

  private syncPieces() {
    const g = bus.game;
    const key = `${g?.fen ?? "start"}|${virtualTable.carried}`;
    if (key === this.pieceKey) return;
    this.pieceKey = key;
    this.pieces.clear();
    const board = new Chess(g?.fen).board();
    board.forEach((row, r) => row.forEach((p, c) => {
      if (!p) return;
      const m = new THREE.Mesh(pieceGeometry(p.type), p.color === "w" ? this.matW : this.matB);
      const [x, y, z] = boardToWorld(c + 0.5, r + 0.5);
      m.position.set(x, y + 0.002, z); m.scale.setScalar(SQUARE * 0.8);
      if (p.type === "n") m.rotation.y = p.color === "w" ? Math.PI : 0;
      m.castShadow = true; m.receiveShadow = true;
      this.pieces.add(m);
    }));
    this.renderer.shadowMap.needsUpdate = true;
  }

  /** Arms and hands from the same inverse-kinematics pose the virtual cameras see. */
  private syncArms() {
    const caps = virtualTable.arms().flatMap((a) => a.capsules);
    const key = caps.map((c) => `${c.b[0].toFixed(3)},${c.b[1].toFixed(3)},${c.b[2].toFixed(3)}`).join("|");
    if (key === this.armKey) return;
    this.armKey = key;
    while (this.arms.children.length > caps.length) this.arms.remove(this.arms.children[this.arms.children.length - 1]);
    while (this.arms.children.length < caps.length) { const m = new THREE.Mesh(undefined, this.skin); m.castShadow = true; m.receiveShadow = true; this.arms.add(m); }
    if (this.armGeo.size > 64) { this.armGeo.forEach((g) => g.dispose()); this.armGeo.clear(); }
    const Y = new THREE.Vector3(0, 1, 0), a = new THREE.Vector3(), b = new THREE.Vector3();
    caps.forEach((c, i) => {
      const m = this.arms.children[i] as THREE.Mesh;
      a.set(...c.a); b.set(...c.b);
      const L = a.distanceTo(b), gk = `${c.r}|${L.toFixed(3)}`;
      let g = this.armGeo.get(gk);
      if (!g) { g = new THREE.CapsuleGeometry(c.r, Math.max(1e-3, L), 4, 10); this.armGeo.set(gk, g); }
      m.geometry = g; m.material = c.tone < 150 ? this.sleeve : this.skin;
      m.position.copy(a).add(b).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(Y, b.sub(a).normalize());
    });
    this.renderer.shadowMap.needsUpdate = true;
  }

  private syncPeople() {
    this.people.clear();
    const mat = new THREE.LineBasicMaterial({ color: 0x4dffb8 }), dot = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (const p of bus.poses) {
      const pts: THREE.Vector3[] = [];
      for (const [a, b] of BONES) { const ja = p.joints[a], jb = p.joints[b]; if (ja && jb) pts.push(new THREE.Vector3(...ja), new THREE.Vector3(...jb)); }
      this.people.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), mat));
      for (const j of p.joints) if (j) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 6), dot); s.position.set(...j); this.people.add(s); }
    }
  }

  /** Pixel ratio, shadows and frusta follow the saved view settings (antialiasing can only change when the page reloads). */
  private applySettings() {
    const { render, display } = viewSettings();
    this.renderer.setPixelRatio(pixelRatio(render.scale));
    const size = SHADOW_MAP[render.shadows];
    this.renderer.shadowMap.enabled = size > 0; this.lamp.castShadow = size > 0;
    if (size > 0 && this.lamp.shadow.mapSize.x !== size) { this.lamp.shadow.map?.dispose(); this.lamp.shadow.map = null; this.lamp.shadow.mapSize.set(size, size); }
    this.scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m) m.needsUpdate = true; });
    this.renderer.shadowMap.needsUpdate = true;
    this.showFrusta = display.frusta;
    this.canvas.width = 0; // force the next resize() to rebuild the drawing buffer at the new ratio
  }

  resetCamera() { this.cam.position.set(1.3, 1.5, 1.7); this.controls.target.set(0, 0.8, 0); this.controls.update(); }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    if (this.canvas.width !== Math.floor(w * this.renderer.getPixelRatio())) { this.renderer.setSize(w, h, false); this.cam.aspect = w / h; this.cam.updateProjectionMatrix(); }
  }

  render(now: number) {
    if (!dueFrame(now, this.lastFrame, viewSettings().render.fps)) return;
    this.lastFrame = now;
    this.resize();
    const dt = this.lastDraw ? Math.min(0.1, (now - this.lastDraw) / 1000) : 0.016;
    if (bus.scene && this.showProjection) { this.scr.draw(this.cctx, this.content.width, this.content.height, bus.scene, now, dt); this.contentTex.needsUpdate = true; }
    this.lastDraw = now;
    if (now - this.lastOverlay > 66) { this.lastOverlay = now; drawTableOverlay(this.octx, 48, 3, { game: bus.game, director: bus.director, hint: bus.engineHint, clock: bus.clockView }, now / 1000); this.overlayTex.needsUpdate = true; }
    this.frusta.visible = this.showFrusta;
    this.syncPieces(); this.syncArms(); this.syncPeople();
    this.controls.update();
    this.renderer.render(this.scene, this.cam);
  }

  dispose() { this.renderer.dispose(); }
}
