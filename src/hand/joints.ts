/** WebXR / Oculus generic-hand joint names (25 skinned bones). Ported from Hexalt (src/lib/hand/joints.ts). */

export const HAND_JOINT_NAMES = [
  "wrist",
  "thumb-metacarpal",
  "thumb-phalanx-proximal",
  "thumb-phalanx-distal",
  "thumb-tip",
  "index-finger-metacarpal",
  "index-finger-phalanx-proximal",
  "index-finger-phalanx-intermediate",
  "index-finger-phalanx-distal",
  "index-finger-tip",
  "middle-finger-metacarpal",
  "middle-finger-phalanx-proximal",
  "middle-finger-phalanx-intermediate",
  "middle-finger-phalanx-distal",
  "middle-finger-tip",
  "ring-finger-metacarpal",
  "ring-finger-phalanx-proximal",
  "ring-finger-phalanx-intermediate",
  "ring-finger-phalanx-distal",
  "ring-finger-tip",
  "pinky-finger-metacarpal",
  "pinky-finger-phalanx-proximal",
  "pinky-finger-phalanx-intermediate",
  "pinky-finger-phalanx-distal",
  "pinky-finger-tip",
] as const;

export type HandJointName = (typeof HAND_JOINT_NAMES)[number];

export type Handedness = "left" | "right";

export type HandPoseName = "rest" | "open" | "pinch" | "grip";

export type FingerId = "thumb" | "index" | "middle" | "ring" | "pinky";

export const FINGER_CHAINS: Record<FingerId, readonly HandJointName[]> = {
  thumb: [
    "thumb-metacarpal",
    "thumb-phalanx-proximal",
    "thumb-phalanx-distal",
    "thumb-tip",
  ],
  index: [
    "index-finger-metacarpal",
    "index-finger-phalanx-proximal",
    "index-finger-phalanx-intermediate",
    "index-finger-phalanx-distal",
    "index-finger-tip",
  ],
  middle: [
    "middle-finger-metacarpal",
    "middle-finger-phalanx-proximal",
    "middle-finger-phalanx-intermediate",
    "middle-finger-phalanx-distal",
    "middle-finger-tip",
  ],
  ring: [
    "ring-finger-metacarpal",
    "ring-finger-phalanx-proximal",
    "ring-finger-phalanx-intermediate",
    "ring-finger-phalanx-distal",
    "ring-finger-tip",
  ],
  pinky: [
    "pinky-finger-metacarpal",
    "pinky-finger-phalanx-proximal",
    "pinky-finger-phalanx-intermediate",
    "pinky-finger-phalanx-distal",
    "pinky-finger-tip",
  ],
};

export const FINGER_IDS: readonly FingerId[] = [
  "thumb",
  "index",
  "middle",
  "ring",
  "pinky",
];

export type JointTransform = {
  position: [number, number, number];
  quaternion: [number, number, number, number];
};

export type JointPose = Record<string, JointTransform>;