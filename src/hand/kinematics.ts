import * as THREE from "three";
import { FINGER_CHAINS, FINGER_IDS, type FingerId, type Handedness, type HandJointName, type JointPose } from "./joints";
import { withPinchClose, type HandPoseRecipe } from "./poses";

// Pose maths for the Oculus generic-hand GLBs, ported from Hexalt (src/lib/hand/kinematics.ts) without React or the grab/terrain extras.
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _axis = new THREE.Vector3();

export function cloneJointPose(src: JointPose): JointPose {
  const out: JointPose = {};
  for (const [name, j] of Object.entries(src)) {
    out[name] = {
      position: [j.position[0], j.position[1], j.position[2]],
      quaternion: [
        j.quaternion[0],
        j.quaternion[1],
        j.quaternion[2],
        j.quaternion[3],
      ],
    };
  }
  return out;
}


export function captureJointPose(
  objects: Iterable<THREE.Object3D>,
): JointPose {
  const pose: JointPose = {};
  for (const obj of objects) {
    if (!obj.name) continue;
    pose[obj.name] = {
      position: obj.position.toArray() as [number, number, number],
      quaternion: obj.quaternion.toArray() as [
        number,
        number,
        number,
        number,
      ],
    };
  }
  return pose;
}

export function applyJointPose(
  objects: Map<string, THREE.Object3D>,
  pose: JointPose,
): void {
  for (const [name, obj] of objects) {
    const j = pose[name];
    if (!j) continue;
    obj.position.fromArray(j.position);
    obj.quaternion.fromArray(j.quaternion);
  }
}


/**
 * Palm faces -X on the right generic-hand, +X on the left (model space).
 * Fingers run -Y; pinky is +Z.
 */
export function palmNormal(handedness: Handedness): THREE.Vector3 {
  return new THREE.Vector3(handedness === "right" ? -1 : 1, 0, 0);
}

export function fingerDirection(
  pose: JointPose,
  finger: FingerId,
): THREE.Vector3 {
  const chain = FINGER_CHAINS[finger];
  const a = pose[chain[1]!];
  const b = pose[chain[0]!];
  if (!a || !b) return new THREE.Vector3(0, -1, 0);
  return new THREE.Vector3(
    a.position[0] - b.position[0],
    a.position[1] - b.position[1],
    a.position[2] - b.position[2],
  ).normalize();
}

/** Flexion hinge: rotate around this axis to curl toward the palm. */
export function fingerHinge(
  pose: JointPose,
  finger: FingerId,
  handedness: Handedness,
): THREE.Vector3 {
  const dir = fingerDirection(pose, finger);
  const palm = palmNormal(handedness);
  const hinge = new THREE.Vector3().crossVectors(dir, palm);
  if (hinge.lengthSq() < 1e-8) {
    hinge.set(0, 0, handedness === "right" ? 1 : -1);
  }
  return hinge.normalize();
}

export function rotateChain(
  pose: JointPose,
  chain: readonly HandJointName[],
  jointIndex: number,
  axis: THREE.Vector3,
  angle: number,
): void {
  if (Math.abs(angle) < 1e-8) return;
  if (jointIndex < 0 || jointIndex >= chain.length - 1) return;
  const pivotName = chain[jointIndex]!;
  const pivotJoint = pose[pivotName];
  if (!pivotJoint) return;

  const pivot = new THREE.Vector3().fromArray(pivotJoint.position);
  _axis.copy(axis).normalize();
  _q.setFromAxisAngle(_axis, angle);

  _q2.fromArray(pivotJoint.quaternion);
  _q2.premultiply(_q);
  pivotJoint.quaternion = [_q2.x, _q2.y, _q2.z, _q2.w];

  for (let i = jointIndex + 1; i < chain.length; i++) {
    const name = chain[i]!;
    const joint = pose[name];
    if (!joint) continue;
    _v.fromArray(joint.position).sub(pivot).applyQuaternion(_q).add(pivot);
    joint.position = [_v.x, _v.y, _v.z];
    _q2.fromArray(joint.quaternion);
    _q2.premultiply(_q);
    joint.quaternion = [_q2.x, _q2.y, _q2.z, _q2.w];
  }
}


const SPREAD_SIGN: Record<FingerId, number> = {
  thumb: 1,
  index: -1,
  middle: 0.15,
  ring: 1,
  pinky: 1.2,
};

export function applyRecipe(
  bind: JointPose,
  recipe: HandPoseRecipe,
  handedness: Handedness,
): JointPose {
  const pose = cloneJointPose(bind);
  const palm = palmNormal(handedness);
  // Opposition and spread spin around the palm. A YZ-mirrored left bind
  // needs the opposite sense on that axis; flexion around the finger
  // hinge already matches via dir × palm.
  const palmSpin = handedness === "left" ? -1 : 1;

  for (const finger of FINGER_IDS) {
    const chain = FINGER_CHAINS[finger];
    const curl = recipe[finger];
    const hinge = fingerHinge(pose, finger, handedness);

    if (finger === "thumb" && curl.opposition) {
      rotateChain(pose, chain, 0, palm, curl.opposition * palmSpin);
    }
    if (curl.spread) {
      rotateChain(
        pose,
        chain,
        1,
        palm,
        curl.spread * (SPREAD_SIGN[finger] ?? 1) * palmSpin,
      );
    }

    if (finger === "thumb") {
      rotateChain(pose, chain, 1, hinge, curl.mcp);
      rotateChain(pose, chain, 2, hinge, curl.pip + curl.dip * 0.35);
    } else {
      rotateChain(pose, chain, 1, hinge, curl.mcp);
      rotateChain(pose, chain, 2, hinge, curl.pip);
      rotateChain(pose, chain, 3, hinge, curl.dip);
    }
  }
  return pose;
}


export function jointDistance(
  pose: JointPose,
  a: HandJointName,
  b: HandJointName,
): number {
  const pa = pose[a];
  const pb = pose[b];
  if (!pa || !pb) return 0;
  return Math.hypot(
    pa.position[0] - pb.position[0],
    pa.position[1] - pb.position[1],
    pa.position[2] - pb.position[2],
  );
}


export function quaternionFromFingerAndPalm(
  fingerWorld: THREE.Vector3,
  palmWorld: THREE.Vector3,
  handedness: Handedness,
): THREE.Quaternion {
  const fingerLocal = new THREE.Vector3(0, -1, 0);
  const palmLocal = palmNormal(handedness);
  const f = fingerWorld.clone().normalize();
  const p = palmWorld.clone().normalize();
  const proj = f.clone().multiplyScalar(p.dot(f));
  p.sub(proj);
  if (p.lengthSq() < 1e-8) {
    p.copy(palmLocal);
  } else {
    p.normalize();
  }

  const q1 = new THREE.Quaternion().setFromUnitVectors(fingerLocal, f);
  const palmRotated = palmLocal.clone().applyQuaternion(q1);
  palmRotated.sub(f.clone().multiplyScalar(palmRotated.dot(f)));
  if (palmRotated.lengthSq() < 1e-8) return q1;
  palmRotated.normalize();

  if (palmRotated.dot(p) < -0.999) {
    const twist = new THREE.Quaternion().setFromAxisAngle(f, Math.PI);
    return twist.multiply(q1);
  }
  const qTwist = new THREE.Quaternion().setFromUnitVectors(palmRotated, p);
  return qTwist.multiply(q1);
}


function pinchGapPenalty(gap: number, target: number): number {
  if (gap >= target) return gap - target;
  return (target - gap) * 8;
}

export function closePinchToObject(
  bind: JointPose,
  recipe: HandPoseRecipe,
  handedness: Handedness,
  targetGapMeters: number,
): JointPose {
  let best = applyRecipe(bind, recipe, handedness);
  let bestPenalty = pinchGapPenalty(
    jointDistance(best, "thumb-tip", "index-finger-tip"),
    targetGapMeters,
  );

  for (let i = -12; i <= 16; i++) {
    if (i === 0) continue;
    const pose = applyRecipe(
      bind,
      withPinchClose(recipe, i * 0.1),
      handedness,
    );
    const penalty = pinchGapPenalty(
      jointDistance(pose, "thumb-tip", "index-finger-tip"),
      targetGapMeters,
    );
    if (penalty < bestPenalty) {
      best = pose;
      bestPenalty = penalty;
    }
  }
  return best;
}


