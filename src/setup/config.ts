import type { Graph } from "../core/graph";
import { LLM_DEFAULT_MODEL } from "../narrator/llm";
import { ELEVENLABS_DEFAULTS } from "../narrator/voice";
import { fmtCorners, parseCorners } from "../plugins/shared";
import { poseString } from "../vision/boardPose";
import { FRAME_H, FRAME_W, RIGS, rigCorners } from "../sim/rigs";
import { SCENARIOS } from "../sim/scenarios";
import { SCENES, type SceneId } from "../scene/types";

export const MAX_CAMERAS = 4;
export type CameraKind = "webcam" | "virtual";
export type Rig = "A" | "B" | "C";

export interface CameraSetup {
  id: string;
  kind: CameraKind;
  deviceId: string;
  label: string;
  online: boolean;
  channel: "luma" | "red" | "green" | "blue";
  rig: Rig; // virtual cameras only
  corners: string; // a8;h8;h1;a1 in 480x360 camera pixels
  trust: number; // 0..2
  fov: number; // vertical field of view in degrees (used to place the camera in 3D from its board corners)
  /** Fields filled in by "Auto detect" (cleared again when the value is set by hand). "fov" is the camera's placement. */
  autoFields?: AutoField[];
}

export type AutoField = "fov" | "trust" | "channel";

/** Records whether a field was filled by auto detect (true) or set by hand (false). */
export function setAutoField(cam: CameraSetup, field: AutoField, auto: boolean) {
  const rest = (cam.autoFields ?? []).filter((f) => f !== field);
  cam.autoFields = auto ? [...rest, field] : rest;
}

/** A board separation below this (d', see autodetect.ts) means the squares barely stand out: the camera performs badly. */
export const BAD_SEPARATION = 0.5;

/** What the board step last measured for a camera: whether a picture arrived, and how well the squares show in it. */
export interface BoardReading { signal: boolean; separation?: number }

export interface CamHealth {
  configured: boolean; // a device is chosen (webcams) and the board corners are marked
  auto: boolean; // the placement (field of view) was auto-detected
  ready: boolean; // online, configured and not performing badly
  bad: boolean; // no signal, or the board squares barely stand out
  tone: "ok" | "warn" | "fail";
  text: string; // one-line status for the camera's tab
}

/** A camera's status on the board step's tabs, derived from its setup and the latest reading of its picture. */
export function camHealth(cam: CameraSetup, reading?: BoardReading): CamHealth {
  const configured = !!parseCorners(cam.corners) && (cam.kind === "virtual" || !!cam.deviceId);
  const auto = (cam.autoFields ?? []).includes("fov");
  const noSignal = cam.kind === "webcam" && reading?.signal === false;
  const poor = reading?.signal === true && reading.separation !== undefined && reading.separation < BAD_SEPARATION;
  const bad = noSignal || poor;
  const ready = cam.online && configured && !bad;
  const text = noSignal ? "No signal" : poor ? "Performing badly" : !cam.online ? "Offline" : !configured ? "Not configured" : auto ? "Ready · placement auto" : "Ready";
  return { configured, auto, ready, bad, tone: bad ? "fail" : ready ? "ok" : "warn", text };
}

export interface SetupConfig {
  version: 1;
  completed: boolean;
  cameras: CameraSetup[];
  scene: SceneId | "auto";
  rain: number; // -1 = scene default
  snow: number;
  hour: number; // -1 = scene default
  narrator: { voices: 1 | 2; nameA: string; nameB: string; speak: boolean; volume: number };
  /** "menu" = the player picks by hovering a hand over the table menu; otherwise a fixed opponent (kiosk). */
  /** Who writes the commentary: the built-in lines, or OpenAI (needs an API key). */
  ai: { engine: "builtin" | "openai"; apiKey: string; model: string };
  /** Who speaks the lines: the system (browser) voices, or ElevenLabs (needs an API key). */
  voice: { engine: "browser" | "elevenlabs"; apiKey: string; voiceIdA: string; voiceIdB: string };
  opponent: { mode: "menu" | "engine" | "human"; elo: number };
  projectors: { count: number; dmx: boolean; dmxUrl: string };
  /** pose = track people in 3D (MediaPipe) and use them for seating and hand pointers, instead of the virtual player */
  tracking: { pose: boolean };
  demo: { autoplay: boolean; scenario: string };
}

export interface Issue { level: "error" | "warn"; field: string; message: string }

export const virtualCamera = (rig: Rig, id: string = rig): CameraSetup => ({ id, kind: "virtual", deviceId: "", label: `Virtual camera ${rig}`, online: true, channel: "luma", rig, corners: fmtCorners(rigCorners(RIGS[rig])), trust: 1, fov: RIGS[rig].fovY });

export const webcamSetup = (deviceId: string, label: string, id: string): CameraSetup => ({ id, kind: "webcam", deviceId, label, online: true, channel: "luma", rig: "A", corners: fmtCorners(rigCorners(RIGS.A)), trust: 1, fov: 60 });

/** Out-of-the-box configuration: two virtual 3D cameras and an autoplaying demo game. */
export const defaultSetup = (): SetupConfig => ({
  version: 1, completed: false,
  cameras: [virtualCamera("A"), virtualCamera("B")],
  scene: "auto", rain: -1, snow: -1, hour: -1,
  narrator: { voices: 2, nameA: "Jean", nameB: "Margot", speak: true, volume: 0.9 },
  ai: { engine: "builtin", apiKey: "", model: LLM_DEFAULT_MODEL },
  voice: { engine: "browser", apiKey: "", voiceIdA: ELEVENLABS_DEFAULTS.voiceIdA, voiceIdB: ELEVENLABS_DEFAULTS.voiceIdB },
  opponent: { mode: "menu", elo: 1000 },
  projectors: { count: 0, dmx: false, dmxUrl: "ws://127.0.0.1:8787" },
  tracking: { pose: false },
  demo: { autoplay: false, scenario: SCENARIOS[0].id },
});

export function validateSetup(c: SetupConfig): Issue[] {
  const out: Issue[] = [];
  const err = (field: string, message: string) => out.push({ level: "error", field, message });
  const warn = (field: string, message: string) => out.push({ level: "warn", field, message });
  if (!c.cameras.length) err("cameras", "Add at least one camera (a webcam or a virtual camera).");
  if (c.cameras.length > MAX_CAMERAS) err("cameras", `At most ${MAX_CAMERAS} cameras are supported.`);
  const ids = new Set<string>();
  for (const cam of c.cameras) {
    if (ids.has(cam.id)) err("cameras", `Camera id "${cam.id}" is used twice.`);
    ids.add(cam.id);
    if (!parseCorners(cam.corners)) err("corners", `${cam.label}: board corners are not set (need 4 x,y pairs).`);
    if (cam.kind === "webcam" && !cam.deviceId) warn("cameras", `${cam.label}: no device chosen, the default webcam will be used.`);
  }
  const online = c.cameras.filter((x) => x.online).length;
  if (c.cameras.length && online === 0) err("cameras", "No camera is online.");
  if (online === 1) warn("cameras", "Only one camera online: occlusion by hands cannot be bridged. Two or more is recommended.");
  if (!c.narrator.nameA.trim() || !c.narrator.nameB.trim()) err("narrator", "Both commentators need a name.");
  if (c.ai.engine === "openai") {
    if (!c.ai.apiKey.trim()) warn("ai", "AI commentary is set to OpenAI but no API key is entered: the built-in commentary will be used.");
    else if (!/^sk-/.test(c.ai.apiKey.trim())) warn("ai", "OpenAI keys start with \"sk-\": check that you copied the whole key.");
  }
  if (c.voice.engine === "elevenlabs" && !c.voice.apiKey.trim()) warn("voice", "The voice engine is set to ElevenLabs but no API key is entered: the system voices will be used.");
  if (c.projectors.dmx && !/^wss?:\/\//.test(c.projectors.dmxUrl)) err("projectors", "DMX bridge URL must start with ws:// or wss://.");
  if (c.tracking.pose && online < 2) warn("tracking", "People tracking with one camera can only place feet on the floor. Two or more cameras give full 3D.");
  if (c.scene !== "auto" && !(c.scene in SCENES)) err("scene", `Unknown scene "${c.scene}".`);
  return out;
}

export const hasErrors = (issues: Issue[]) => issues.some((i) => i.level === "error");

/** Next free camera id: A, B, C… then W1, W2…. */
export function nextCameraId(c: SetupConfig): string {
  const used = new Set(c.cameras.map((x) => x.id));
  for (const id of ["A", "B", "C", "D"]) if (!used.has(id)) return id;
  let n = 1;
  while (used.has(`W${n}`)) n++;
  return `W${n}`;
}

const KEY = "cx.setup.v1";
export function loadSetup(): SetupConfig | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as SetupConfig;
    return j.version === 1 ? { ...defaultSetup(), ...j } : null;
  } catch { return null; }
}
export function saveSetup(c: SetupConfig) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* storage unavailable */ } }
export function clearSetup() { try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ } }

/** Turns a SetupConfig into the shipped patch: cameras -> readers -> fusion -> tracker -> narration / scenes / output. */
export function buildGraphFromConfig(g: Graph, c: SetupConfig) {
  for (const id of [...g.nodes.keys()]) g.removeNode(id);
  const wire = (a: { id: string }, ap: string, b: { id: string }, bp: string) => g.connect({ node: a.id, port: ap }, { node: b.id, port: bp });
  const fuse = g.addNode("vision.fuse", 640, 150);
  const sources: { id: string }[] = []; // camera source nodes, in order
  // virtual cameras look at one Virtual World, which the two AI players sit at (built below)
  const world = c.cameras.some((x) => x.kind === "virtual") ? g.addNode("world.virtual", 330, 820) : null;
  c.cameras.slice(0, MAX_CAMERAS).forEach((cam, i) => {
    const y = 30 + i * 340;
    let src: { id: string };
    if (cam.kind === "webcam") src = g.addNode("source.webcam", 20, y, { online: cam.online, device: cam.deviceId || cam.label, channel: cam.channel });
    else {
      src = g.addNode("source.synthetic", 20, y, { online: cam.online, cam: cam.rig });
      if (world) wire(world, "world", src, "world");
    }
    const rd = g.addNode("vision.boardReader", 330, y, { cam: cam.id, corners: cam.corners, weight: cam.trust });
    wire(src, "frame", rd, "frame"); wire(rd, "obs", fuse, `o${i + 1}`); sources.push(src);
  });
  const stab = g.addNode("vision.stabilize", 900, 150);
  const trk = g.addNode("game.tracker", 1160, 60);
  const dir = g.addNode("experience.director", 1160, 520, { preset: c.opponent.mode, presetElo: String(c.opponent.elo) });
  const eng = g.addNode("game.engine", 1440, 520);
  const nar = g.addNode("narration.narrator", 1700, 30, { voices: String(c.narrator.voices), nameA: c.narrator.nameA, nameB: c.narrator.nameB });
  const ai = g.addNode("narration.ai", 1840, 30, { voices: String(c.narrator.voices), nameA: c.narrator.nameA, nameB: c.narrator.nameB, provider: c.ai.engine, aiKey: c.ai.apiKey.trim(), aiModel: c.ai.model || LLM_DEFAULT_MODEL });
  const spk = g.addNode("narration.speech", 2100, 30, { enabled: c.narrator.speak, volume: c.narrator.volume, provider: c.voice.engine, apiKey: c.voice.apiKey.trim(), voiceIdA: c.voice.voiceIdA.trim() || ELEVENLABS_DEFAULTS.voiceIdA, voiceIdB: c.voice.voiceIdB.trim() || ELEVENLABS_DEFAULTS.voiceIdB });
  const cues = g.addNode("scene.cues", 1700, 250, { scene: c.scene === "auto" ? "(auto)" : c.scene, rain: c.rain, snow: c.snow, hour: c.hour });
  const out = g.addNode("scene.output", 2000, 330, { dmx: c.projectors.dmx, dmxUrl: c.projectors.dmxUrl });
  wire(fuse, "board", stab, "board"); wire(stab, "board", trk, "board"); wire(dir, "director", trk, "director");
  wire(trk, "events", dir, "events");
  if (c.tracking.pose) {
    // people tracking: each camera's pose in the room comes from its marked board corners
    const used = c.cameras.slice(0, 3), params: Record<string, string | boolean> = { enabled: true };
    used.forEach((cam, i) => { const pts = parseCorners(cam.corners); if (pts) params[`cam${i + 1}`] = poseString(pts, FRAME_W, FRAME_H, cam.fov); });
    const pose = g.addNode("tracking.pose", 20, 1400, params);
    used.forEach((_, i) => wire(sources[i], "frame", pose, `f${i + 1}`));
    wire(pose, "seats", dir, "seats"); wire(pose, "pointers", dir, "pointers");
  } else {
    const person = g.addNode("sim.person", 20, 1400, { seated: false });
    wire(person, "seats", dir, "seats"); wire(person, "pointers", dir, "pointers");
  }
  wire(trk, "game", eng, "game"); wire(dir, "director", eng, "director");
  wire(trk, "events", nar, "events"); wire(dir, "events", nar, "events2"); wire(eng, "events", nar, "events3"); wire(nar, "lines", ai, "lines"); wire(trk, "events", ai, "events"); wire(dir, "events", ai, "events2"); wire(eng, "events", ai, "events3"); wire(ai, "lines", spk, "lines");
  wire(trk, "events", cues, "events"); wire(dir, "events", cues, "events2"); wire(eng, "events", cues, "events3");
  wire(cues, "scene", out, "scene"); wire(cues, "fired", out, "fired");
  if (world) {
    g.addNode("sim.pose", 20, 1500);
    // the scenario asks for actions; the two AI players carry them out at the world, and the world reports to the tracker's control
    const sc = g.addNode("sim.scenario", 20, 1620, { scenario: c.demo.scenario, play: c.demo.autoplay });
    const white = g.addNode("sim.player", 330, 1620, { color: "w" }), black = g.addNode("sim.player", 640, 1620, { color: "b" });
    wire(sc, "events", trk, "control");
    wire(sc, "actions", white, "actions"); wire(sc, "actions", black, "actions");
    wire(white, "player", world, "white"); wire(black, "player", world, "black");
  }
}
