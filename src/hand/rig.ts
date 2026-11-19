import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { ArmPose } from "../sim/arm";
import { HAND_JOINT_NAMES, type Handedness, type JointPose } from "./joints";
import { applyJointPose, applyRecipe, captureJointPose, closePinchToObject, quaternionFromFingerAndPalm } from "./kinematics";
import { HAND_POSE_RECIPES, lerpRecipe } from "./poses";

/** Gap between thumb and index bone tips (metres) when pinching a chess piece's neck. */
export const PINCH_GAP = 0.016;
/** How curled an idle hand rests (0 open .. 1 fist). */
export const IDLE_CURL = 0.2;
const JOINTS = new Set<string>(HAND_JOINT_NAMES);
const DOWN = new THREE.Vector3(0, -1, 0);

/** The two Oculus generic-hand scenes, loaded once. Resolves null when the files are missing or WebGL-less environments cannot parse them. */
let assets: Promise<Record<Handedness, THREE.Object3D> | null> | null = null;
export function loadHandAssets(base = import.meta.env.BASE_URL): Promise<Record<Handedness, THREE.Object3D> | null> {
  assets ??= (async () => {
    try {
      const loader = new GLTFLoader();
      const [left, right] = await Promise.all([`${base}models/hands/left.glb`, `${base}models/hands/right.glb`].map((u) => loader.loadAsync(u)));
      return { left: left.scene, right: right.scene };
    } catch { return null; }
  })();
  return assets;
}

/** One skinned hand: clones the GLB, remembers its bind pose and follows an ArmPose (wrist position, finger direction, grasp). */
export class HandRig {
  readonly root: THREE.Object3D;
  private bones = new Map<string, THREE.Object3D>();
  private bind: JointPose;
  private pinched: JointPose | null = null;
  private q = new THREE.Quaternion();

  constructor(template: THREE.Object3D, readonly handedness: Handedness, material: THREE.Material) {
    this.root = cloneSkinned(template);
    this.root.traverse((o) => {
      if (o.name.startsWith("xr_")) { o.visible = false; return; }
      if (JOINTS.has(o.name)) this.bones.set(o.name, o);
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.material = material; m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true; }
    });
    this.bind = captureJointPose(this.bones.values());
  }

  /** Finger bones for a grasp amount; a fully closed pinch is searched once so the thumb and index pads meet on the piece. */
  fingerPose(arm: Pick<ArmPose, "grasp" | "grip" | "active">): JointPose {
    const R = HAND_POSE_RECIPES;
    if (!arm.active && arm.grasp === 0) return applyRecipe(this.bind, lerpRecipe(R.open, R.grip, IDLE_CURL), this.handedness);
    if (arm.grip === "fist") return applyRecipe(this.bind, lerpRecipe(R.open, R.grip, arm.grasp), this.handedness);
    if (arm.grasp >= 0.99) return (this.pinched ??= closePinchToObject(this.bind, R.pinch, this.handedness, PINCH_GAP));
    return applyRecipe(this.bind, lerpRecipe(R.open, R.pinch, arm.grasp), this.handedness);
  }

  /** Put the wrist where the arm ends, fingers along `fingerDir`, palm toward the table, and curl the fingers. */
  place(arm: ArmPose) {
    const f = new THREE.Vector3(...arm.fingerDir);
    this.q.copy(quaternionFromFingerAndPalm(f, DOWN, this.handedness));
    this.root.position.set(...arm.wrist);
    this.root.quaternion.copy(this.q);
    applyJointPose(this.bones, this.fingerPose(arm));
  }

  dispose() { this.root.traverse((o) => { const s = o as THREE.SkinnedMesh; if (s.isSkinnedMesh) s.skeleton.dispose(); }); }
}
