import { Chess } from "chess.js";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { bus } from "../core/bus";
import type { MappingConfig } from "../mapping/store";
import { SceneRenderer } from "../scene/renderer";
import { virtualTable } from "../sim/virtualTable";
import { TONE_SKIN } from "../sim/arm";
import { HandRig, loadHandAssets } from "../hand/rig";
import { LIGHT } from "../sim/shadow";
import { BONES } from "../vision/triangulate";
import { boardTheme, onBoardTheme, type BoardTheme } from "../ui/boardThemes";
import { SHADOW_MAP, dueFrame, onViewSettings, pixelRatio, viewSettings } from "../ui/viewSettings";
import { SQUARE, TABLE_Y, boardToWorld } from "./coords";
import { projectorCamera } from "./blend";
import { drawTableOverlay } from "./overlay";
import { pieceGeometry } from "./pieces";
import { projectableSurfaces, surfaceMesh } from "./surfaces";
import { fxEngine } from "../fx/engine";

/** Releases the GPU buffers and material of a scene object that is being removed (its textures are kept: they are shared). */
function freeObject(o: THREE.Object3D) {
  const m = o as THREE.Mesh;
  m.geometry?.dispose();
  for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat?.dispose();
}

const CAM_KEY = "chess.worldCamera";
const DEFAULT_CAM = { pos: [0.4, 1.6, 0.75] as [number, number, number], target: [0, TABLE_Y, 0] as [number, number, number] };

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
  /** Light cones from each projector down to the table, pulsing with the board effects. */
  private beams = new THREE.Group();
  private beamMats: THREE.Material[] = [];
  private fxCanvas = document.createElement("canvas");
  private fctx = this.fxCanvas.getContext("2d")!;
  private fxTex: THREE.CanvasTexture;
  private fxPlane!: THREE.Mesh;
  private fxWasOn = false;
  private pieces = new THREE.Group();
  private people = new THREE.Group();
  private arms = new THREE.Group();
  private armGeo = new Map<string, THREE.CapsuleGeometry>();
  private armKey = "";
  private peopleKey = "";
  private peopleLine = new THREE.LineBasicMaterial({ color: 0x4dffb8 });
  private peopleDot = new THREE.MeshBasicMaterial({ color: 0xffffff });
  private peopleSphere = new THREE.SphereGeometry(0.02, 6, 6);
  /** skinned Oculus hands (same meshes as Hexalt) that replace the palm and finger capsules once the GLBs load */
  private hands = new THREE.Group();
  private handRigs: HandRig[] = [];
  private handAssets: Awaited<ReturnType<typeof loadHandAssets>> = null;
  private skin = new THREE.MeshStandardMaterial({ color: 0xd9a98a, roughness: 0.6 });
  private sleeve = new THREE.MeshStandardMaterial({ color: 0x3a4a63, roughness: 0.85 });
  private overlayCanvas = document.createElement("canvas");
  private octx = this.overlayCanvas.getContext("2d")!;
  private overlayTex: THREE.CanvasTexture;
  private scr = new SceneRenderer();
  /** The table overlay as the table projector really throws it: drawn into the projector's own image, then projected back onto the table through its lens. */
  private ov!: THREE.Mesh;
  private projRT: THREE.WebGLRenderTarget | null = null;
  private projScene = new THREE.Scene();
  private projCam: THREE.PerspectiveCamera | null = null;
  private flatMat!: THREE.Material;
  private projMat: THREE.ShaderMaterial | null = null;
  private projDirty = false;
  private pieceKey = "";
  private lastDraw = 0;
  private lastOverlay = 0;
  // lacquered pieces: a clear-coat layer gives the polished highlight real chess sets have
  private matW = new THREE.MeshPhysicalMaterial({ color: 0xf6f3e8, roughness: 0.4, metalness: 0.02, clearcoat: 0.6, clearcoatRoughness: 0.2 });
  private matB = new THREE.MeshPhysicalMaterial({ color: 0x3b3a3f, roughness: 0.38, metalness: 0.05, clearcoat: 0.6, clearcoatRoughness: 0.2 });
  private lamp!: THREE.SpotLight;
  private lastFrame = 0;
  showFrusta = false;
  showProjection = true;

  constructor(private canvas: HTMLCanvasElement, private cfg: MappingConfig) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: viewSettings().render.aa, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(pixelRatio(viewSettings().render.scale));
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false; this.renderer.shadowMap.needsUpdate = true; // re-rendered only when pieces or arms move
    this.scene.background = new THREE.Color(0x05070c);
    this.controls = new OrbitControls(this.cam, canvas);
    this.controls.enableDamping = true;
    if (!this.restoreCamera()) this.defaultCamera();
    this.controls.addEventListener("change", () => this.saveCameraSoon());
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
    this.fxCanvas.width = this.fxCanvas.height = 14 * 48;
    this.fxTex = new THREE.CanvasTexture(this.fxCanvas); this.fxTex.colorSpace = THREE.SRGBColorSpace;
    this.scene.add(this.room, this.frusta, this.beams, this.pieces, this.people, this.arms, this.hands);
    this.buildTable();
    this.setMapping(cfg);
    void loadHandAssets().then((a) => { this.handAssets = a; this.armKey = ""; }); // until (or unless) the GLBs load, the capsule hands stay
  }

  setMapping(cfg: MappingConfig) {
    this.cfg = cfg;
    for (const g of [this.room, this.frusta]) { for (const o of g.children) freeObject(o); g.clear(); }
    const mat = new THREE.MeshBasicMaterial({ map: this.contentTex, side: THREE.DoubleSide, transparent: true, opacity: this.showProjection ? 0.95 : 0 });
    for (const s of projectableSurfaces(cfg.surfaces)) { const m = surfaceMesh(s, mat); this.room.add(m); }
    const colors = [0xff6b6b, 0x6bd0ff, 0xb8ff6b, 0xffd36b];
    cfg.projectors.forEach((p, i) => {
      const cam = projectorCamera(p); cam.far = 4;
      const h = new THREE.CameraHelper(cam); h.setColors(new THREE.Color(colors[i % 4]), new THREE.Color(colors[i % 4]), new THREE.Color(0x445), new THREE.Color(0x445), new THREE.Color(0x445));
      this.frusta.add(h);
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.22), new THREE.MeshStandardMaterial({ color: colors[i % 4] }));
      body.position.set(...p.pos); this.frusta.add(body);
    });
    this.buildBeams();
    if (this.ov) this.setTableProjection();
  }

  /**
   * Routes the table overlay through the table projector's real pose (the same pose the output window uses): a second scene holds the flat
   * overlay, is rendered from the projector, and that image is thrown back onto the table. Keystone, cut-off at the lens edge and a mis-aimed
   * projector therefore show up here exactly as they will on the real table. Without a projector the overlay is just laid flat.
   */
  private setTableProjection() {
    const p = this.cfg.projectors.find((q) => q.id === "table") ?? this.cfg.projectors[0];
    this.projScene.clear();
    if (!p) { this.projCam = null; this.ov.material = this.flatMat; return; }
    this.projCam = projectorCamera(p);
    const size = SQUARE * 14, flat = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: this.overlayTex, transparent: true, depthWrite: false }));
    flat.rotation.x = -Math.PI / 2; flat.position.y = TABLE_Y + 0.003; this.projScene.add(flat);
    this.projRT ??= new THREE.WebGLRenderTarget(1024, 1024 / Math.max(0.5, p.aspect));
    this.projRT.setSize(1024, Math.round(1024 / Math.max(0.5, p.aspect)));
    const vp = new THREE.Matrix4().multiplyMatrices(this.projCam.projectionMatrix, this.projCam.matrixWorldInverse);
    this.projMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: { map: { value: this.projRT.texture }, vp: { value: vp } },
      vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform sampler2D map; uniform mat4 vp; varying vec3 vW;
        void main(){ vec4 c = vp * vec4(vW,1.0); if (c.w <= 0.0) discard; vec2 n = c.xy / c.w; if (abs(n.x) > 1.0 || abs(n.y) > 1.0) discard;
          gl_FragColor = texture2D(map, n * 0.5 + 0.5);
          #include <colorspace_fragment>
        }`,
    });
    this.ov.material = this.projMat; this.projDirty = true;
  }

  /**
   * What a projector aimed at the table really does: a cone of light from the lens down to the table, and the outline of the
   * lit patch where it lands. Corner rays are intersected with the table top, so an angled projector shows its keystone shape.
   */
  private buildBeams() {
    for (const c of [...this.beams.children]) { this.beams.remove(c); freeObject(c); }
    this.beamMats = [];
    const colors = [0xff6b6b, 0x6bd0ff, 0xb8ff6b, 0xffd36b];
    this.cfg.projectors.forEach((p, i) => {
      const cam = projectorCamera(p), apex = cam.position.clone(), pts: THREE.Vector3[] = [];
      for (const [nx, ny] of [[-1, 1], [1, 1], [1, -1], [-1, -1]]) {
        const dir = new THREE.Vector3(nx, ny, 0.5).unproject(cam).sub(apex).normalize();
        const t = dir.y < -0.02 ? (TABLE_Y - apex.y) / dir.y : 2.5; // a ray that never reaches the table just fades out in the room
        pts.push(apex.clone().addScaledVector(dir, Math.min(Math.max(t, 0.1), 6)));
      }
      const pos: number[] = [], shade: number[] = [];
      const push = (v: THREE.Vector3, k: number) => { pos.push(v.x, v.y, v.z); shade.push(k, k, k); };
      for (let k = 0; k < 4; k++) { push(apex, 1); push(pts[k], 0.25); push(pts[(k + 1) % 4], 0.25); }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute("color", new THREE.Float32BufferAttribute(shade, 3));
      const mat = new THREE.MeshBasicMaterial({ color: colors[i % 4], vertexColors: true, transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
      this.beams.add(new THREE.Mesh(geo, mat));
      const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts.map((v) => v.clone().setY(Math.max(v.y, TABLE_Y + 0.004)))), new THREE.LineBasicMaterial({ color: colors[i % 4], transparent: true, opacity: 0.55 }));
      this.beams.add(edge);
      this.beamMats.push(mat);
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
    this.flatMat = new THREE.MeshBasicMaterial({ map: this.overlayTex, transparent: true, depthWrite: false });
    const ov = new THREE.Mesh(new THREE.PlaneGeometry(SQUARE * 14, SQUARE * 14), this.flatMat);
    ov.rotation.x = -Math.PI / 2; ov.position.y = TABLE_Y + 0.003; this.scene.add(ov); this.ov = ov;
    // projected effects add light like a real projector: bright on the dark wood and squares, never darker than what is there
    this.fxPlane = new THREE.Mesh(new THREE.PlaneGeometry(SQUARE * 14, SQUARE * 14), new THREE.MeshBasicMaterial({ map: this.fxTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.fxPlane.rotation.x = -Math.PI / 2; this.fxPlane.position.y = TABLE_Y + 0.004; this.scene.add(this.fxPlane);
    const chairMat = new THREE.MeshStandardMaterial({ color: 0x38404f });
    for (const s of [1, -1]) {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.05, 0.45), chairMat); seat.position.set(0, 0.45, s * 0.85);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.5, 0.05), chairMat); back.position.set(0, 0.72, s * 1.07);
      this.scene.add(seat, back);
    }
  }

  private syncPieces() {
    const g = bus.game;
    const key = bus.pieceView ? "projected" : `${g?.fen ?? "start"}|${virtualTable.carried}`; // projected pieces are painted on the table, not modelled
    if (key === this.pieceKey) return;
    this.pieceKey = key;
    this.pieces.clear();
    const board = bus.pieceView ? [] : new Chess(g?.fen).board();
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
    const poses = virtualTable.arms(), meshHands = this.handAssets !== null;
    // with the skinned hands loaded only the sleeve and forearm capsules are drawn; the palm and fingers are the GLB
    const caps = poses.flatMap((a) => a.capsules).filter((c) => !meshHands || c.tone !== TONE_SKIN);
    const key = (meshHands ? "m" : "c") + caps.map((c) => `${c.b[0].toFixed(3)},${c.b[1].toFixed(3)},${c.b[2].toFixed(3)}`).join("|") + poses.map((a) => `${a.wrist.map((v) => v.toFixed(3))};${a.grasp.toFixed(2)}`).join("|");
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
    this.syncHands(poses);
    this.renderer.shadowMap.needsUpdate = true;
  }

  /** One skinned hand per arm pose, recreated only when an arm swaps sides (left/right meshes differ). */
  private syncHands(poses: ReturnType<typeof virtualTable.arms>) {
    const assets = this.handAssets;
    if (!assets) return;
    while (this.handRigs.length > poses.length) { const r = this.handRigs.pop()!; this.hands.remove(r.root); r.dispose(); }
    poses.forEach((a, i) => {
      const side = a.hand === "R" ? "right" : "left";
      let rig = this.handRigs[i];
      if (rig && rig.handedness !== side) { this.hands.remove(rig.root); rig.dispose(); rig = undefined as unknown as HandRig; }
      if (!rig) { rig = new HandRig(assets[side], side, this.skin); this.handRigs[i] = rig; this.hands.add(rig.root); }
      rig.place(a);
    });
  }

  /** Skeletons are rebuilt only when a joint moves; the joint sphere, bone and dot materials are shared and never recreated. */
  private syncPeople() {
    const key = bus.poses.map((p) => p.joints.map((j) => (j ? j.join(",") : "-")).join(";")).join("|");
    if (key === this.peopleKey) return;
    this.peopleKey = key;
    for (const o of this.people.children) if (o instanceof THREE.LineSegments) o.geometry.dispose(); // bone geometry is per frame; joint spheres share one
    this.people.clear();
    for (const p of bus.poses) {
      const pts: THREE.Vector3[] = [];
      for (const [a, b] of BONES) { const ja = p.joints[a], jb = p.joints[b]; if (ja && jb) pts.push(new THREE.Vector3(...ja), new THREE.Vector3(...jb)); }
      this.people.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), this.peopleLine));
      for (const j of p.joints) if (j) { const s = new THREE.Mesh(this.peopleSphere, this.peopleDot); s.position.set(...j); this.people.add(s); }
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

  /** High and close over the table, looking down at the board so the squares read clearly. */
  private defaultCamera() { this.cam.position.set(...DEFAULT_CAM.pos); this.controls.target.set(...DEFAULT_CAM.target); this.controls.update(); }

  resetCamera() { try { localStorage.removeItem(CAM_KEY); } catch { /* storage unavailable */ } this.defaultCamera(); }

  /** The orbit view survives a reload: where the camera sits and what it looks at. */
  private restoreCamera(): boolean {
    try {
      const v = JSON.parse(localStorage.getItem(CAM_KEY) ?? "null") as { pos?: number[]; target?: number[] } | null;
      const ok = (a?: number[]): a is [number, number, number] => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite);
      if (!v || !ok(v.pos) || !ok(v.target)) return false;
      this.cam.position.set(...v.pos); this.controls.target.set(...v.target); this.controls.update();
      return true;
    } catch { return false; }
  }

  private camSave: ReturnType<typeof setTimeout> | null = null;
  private saveCameraSoon() {
    if (this.camSave) return;
    this.camSave = setTimeout(() => {
      this.camSave = null;
      const r = (n: number) => Math.round(n * 1000) / 1000;
      try { localStorage.setItem(CAM_KEY, JSON.stringify({ pos: this.cam.position.toArray().map(r), target: this.controls.target.toArray().map(r) })); } catch { /* storage unavailable */ }
    }, 300);
  }

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
    if (now - this.lastOverlay > 66) { this.lastOverlay = now; drawTableOverlay(this.octx, 48, 3, { game: bus.game, director: bus.director, hint: bus.engineHint, insight: bus.insight, clock: bus.clockView, pieces: bus.pieceView, outline: bus.outline, reconcile: bus.reconcile }, now / 1000); this.overlayTex.needsUpdate = true; this.projDirty = true; }
    this.frusta.visible = this.showFrusta;
    // the table projection: only when a projector is installed to throw it
    const lit = this.cfg.projectors.length > 0 && this.showProjection;
    this.beams.visible = lit; this.fxPlane.visible = lit;
    if (lit) {
      const busy = fxEngine.active(now);
      if (busy || this.fxWasOn) {
        this.fctx.clearRect(0, 0, this.fxCanvas.width, this.fxCanvas.height);
        this.fctx.save(); this.fctx.translate(3 * 48, 3 * 48); fxEngine.draw(this.fctx, 48, now); this.fctx.restore();
        this.fxTex.needsUpdate = true; this.fxWasOn = busy;
      }
      const pulse = fxEngine.level(now);
      for (const m of this.beamMats) (m as THREE.MeshBasicMaterial).opacity = 0.05 + 0.2 * pulse;
    }
    this.syncPieces(); this.syncArms(); this.syncPeople();
    if (this.projCam && this.projRT && this.projDirty) { // the projector's own picture, redrawn whenever the overlay changed
      this.projDirty = false;
      this.renderer.setRenderTarget(this.projRT); this.renderer.setClearColor(0x000000, 0); this.renderer.clear();
      this.renderer.render(this.projScene, this.projCam);
      this.renderer.setRenderTarget(null); this.renderer.setClearColor(0x05070c, 1);
    }
    this.controls.update();
    this.renderer.render(this.scene, this.cam);
  }

  dispose() { this.renderer.dispose(); }
}
