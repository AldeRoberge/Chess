import { CueEngine } from "../scene/cues";
import { SCENES, type SceneId, type SceneState } from "../scene/types";
import { MAX_CAMERAS, hasErrors, nextCameraId, validateSetup, virtualCamera, webcamSetup, type Rig, type SetupConfig } from "../setup/config";
import type { CameraDevice } from "../setup/devices";
import type { Check } from "../setup/system";
import { fmtCorners, parseCorners } from "../plugins/shared";
import { RIGS, rigCorners } from "../sim/rigs";
import { SCENARIOS } from "../sim/scenarios";
import type { Item } from "./menu";

export interface WizardState {
  checks: Check[] | null;
  detected: CameraDevice[];
  scanning: boolean;
  boardCam: number; // camera being calibrated
  scenePreview: SceneState;
}

export interface StepCtx {
  cfg: SetupConfig;
  state: WizardState;
  refresh(): void; // re-render after a state change
  scan(): void;
  runChecks(): void;
  speak(text: string, voice: "A" | "B"): void;
  thunder(): void;
  finish(): void;
  go(step: number): void;
  syncScenePreview(): void;
}

export interface Step { id: string; title: string; blurb: string; items(c: StepCtx): Item[] }

const NAMES = ["Jean", "Margot", "Hugo", "Camille", "Léa", "Louis"].map((n) => ({ value: n, label: n }));
const pct = (v: number) => (v < 0 ? "Scene default" : `${Math.round(v * 100)}%`);

export function sceneStateFor(cfg: SetupConfig): SceneState {
  const cues = new CueEngine();
  cues.setScene(cfg.scene === "auto" ? "winter-forest" : cfg.scene);
  if (cfg.rain >= 0) cues.state.rain = cfg.rain;
  if (cfg.snow >= 0) cues.state.snow = cfg.snow;
  if (cfg.hour >= 0) cues.state.timeOfDay = cfg.hour;
  return cues.state;
}

const cornerItems = (c: StepCtx): Item[] => {
  const cam = c.cfg.cameras[c.state.boardCam];
  const pts = parseCorners(cam.corners) ?? parseCorners(fmtCorners(rigCorners(RIGS.A)))!;
  const names = ["a8", "h8", "h1", "a1"];
  const out: Item[] = [];
  pts.forEach((p, i) => {
    for (const axis of ["x", "y"] as const) {
      out.push({ kind: "slider", label: `Corner ${names[i]}, ${axis}`, min: 0, max: axis === "x" ? 480 : 360, step: 2, get: () => (parseCorners(cam.corners) ?? pts)[i][axis],
        set: (v) => { const q = [...(parseCorners(cam.corners) ?? pts)]; q[i] = { ...q[i], [axis]: v }; cam.corners = fmtCorners(q); } });
    }
  });
  return out;
};

export const STEPS: Step[] = [
  { id: "briefing", title: "System check", blurb: "Checking that this device can run the experience. Setup then takes about two minutes: cameras, board, scenes, narration, opponent.",
    items: (c) => [
      ...(c.state.checks ? [{ kind: "action", icon: "refresh", label: "Re-run system check", run: () => c.runChecks() } as Item] : [{ kind: "info", label: "Running system check…" } as Item]),
    ] },
  { id: "cameras", title: "Cameras", blurb: "Add webcams (IR if you have them) or virtual 3D cameras. An offline camera is simply ignored.",
    items: (c) => {
      const out: Item[] = [];
      c.cfg.cameras.forEach((cam, i) => {
        out.push({ kind: "toggle", label: `${cam.id} · ${cam.label}`, get: () => cam.online, set: (v) => { cam.online = v; }, hint: cam.kind === "virtual" ? "Virtual camera (3D simulation)" : "Physical webcam",
          remove: { label: `Remove camera ${cam.id}`, run: () => { c.cfg.cameras.splice(i, 1); c.state.boardCam = 0; c.refresh(); } } });
      });
      out.push({ kind: "action", icon: "scan", label: c.state.scanning ? "Scanning…" : "Scan for webcams", disabled: c.state.scanning, run: () => c.scan() });
      for (const d of c.state.detected.filter((d) => !c.cfg.cameras.some((x) => x.deviceId === d.deviceId))) {
        out.push({ kind: "action", icon: "plus", label: `Add webcam · ${d.label}`, disabled: c.cfg.cameras.length >= MAX_CAMERAS, run: () => { c.cfg.cameras.push(webcamSetup(d.deviceId, d.label, nextCameraId(c.cfg))); c.refresh(); } });
      }
      out.push({ kind: "action", icon: "world", label: "Add virtual camera", disabled: c.cfg.cameras.length >= MAX_CAMERAS, run: () => {
        const used = new Set(c.cfg.cameras.filter((x) => x.kind === "virtual").map((x) => x.rig));
        const rig = (["A", "B", "C"] as Rig[]).find((r) => !used.has(r)) ?? "A";
        c.cfg.cameras.push(virtualCamera(rig, nextCameraId(c.cfg))); c.refresh();
      } });
      return out;
    } },
  { id: "board", title: "Board", blurb: "Drag the four green handles onto the board corners: a8, h8, h1, a1 (black's left rook first, clockwise from white's view).",
    items: (c) => {
      if (!c.cfg.cameras.length) return [{ kind: "info", label: "No cameras", value: "Add one in the previous step.", tone: "warn" }];
      const cam = c.cfg.cameras[c.state.boardCam];
      return [
        { kind: "choice", label: "Camera", options: c.cfg.cameras.map((x, i) => ({ value: String(i), label: `${x.id} · ${x.label}` })), get: () => String(c.state.boardCam), set: (v) => { c.state.boardCam = Number(v); } },
        { kind: "choice", label: "Channel", options: ["luma", "red", "green", "blue"].map((v) => ({ value: v, label: v === "luma" ? "Gray (luma)" : v[0].toUpperCase() + v.slice(1) })), get: () => cam.channel, set: (v) => { cam.channel = v as typeof cam.channel; }, hint: "IR cameras often show up in the red channel." },
        { kind: "slider", label: "Trust", min: 0, max: 2, step: 0.1, get: () => cam.trust, set: (v) => { cam.trust = v; } },
        { kind: "slider", label: "Field of view", min: 30, max: 110, step: 1, get: () => cam.fov, set: (v) => { cam.fov = v; }, fmt: (v) => `${v}°`, hint: "Vertical angle of the lens. Used to place the camera in the room from its board corners." },
        { kind: "action", icon: "refresh", label: "Reset corners", run: () => { cam.corners = fmtCorners(rigCorners(RIGS[cam.rig])); c.refresh(); } },
        ...cornerItems(c),
      ];
    } },
  { id: "scenes", title: "Scenes", blurb: "Pick the atmosphere. Rain, snow and thunder react to the game; tune the baseline here.",
    items: (c) => [
      { kind: "choice", label: "Scene", options: [{ value: "auto", label: "Auto (by phase)" }, ...(Object.keys(SCENES) as SceneId[]).map((id) => ({ value: id, label: SCENES[id].name }))], get: () => c.cfg.scene, set: (v) => { c.cfg.scene = v as SceneId | "auto"; c.syncScenePreview(); } },
      { kind: "slider", label: "Rain", min: -1, max: 1, step: 0.1, get: () => c.cfg.rain, set: (v) => { c.cfg.rain = v; c.syncScenePreview(); }, fmt: pct },
      { kind: "slider", label: "Snow", min: -1, max: 1, step: 0.1, get: () => c.cfg.snow, set: (v) => { c.cfg.snow = v; c.syncScenePreview(); }, fmt: pct },
      { kind: "slider", label: "Time of day", min: -1, max: 24, step: 1, get: () => c.cfg.hour, set: (v) => { c.cfg.hour = v; c.syncScenePreview(); }, fmt: (v) => (v < 0 ? "Scene default" : `${v}:00`) },
      { kind: "action", icon: "bolt", label: "Test thunder", run: () => c.thunder() },
    ] },
  { id: "narration", title: "Narration", blurb: "One or two commentators describe the game as it happens, in French.",
    items: (c) => [
      { kind: "choice", label: "Commentators", options: [{ value: "1", label: "One voice" }, { value: "2", label: "Two voices" }], get: () => String(c.cfg.narrator.voices), set: (v) => { c.cfg.narrator.voices = v === "1" ? 1 : 2; } },
      { kind: "choice", label: "Voice A", options: NAMES, get: () => c.cfg.narrator.nameA, set: (v) => { c.cfg.narrator.nameA = v; } },
      { kind: "choice", label: "Voice B", options: NAMES, get: () => c.cfg.narrator.nameB, set: (v) => { c.cfg.narrator.nameB = v; } },
      { kind: "toggle", label: "Speak aloud", get: () => c.cfg.narrator.speak, set: (v) => { c.cfg.narrator.speak = v; } },
      { kind: "slider", label: "Volume", min: 0, max: 1, step: 0.1, get: () => c.cfg.narrator.volume, set: (v) => { c.cfg.narrator.volume = v; }, fmt: (v) => `${Math.round(v * 100)}%` },
      { kind: "action", icon: "sound", label: "Test voice A", run: () => c.speak("Un joueur rejoint la partie.", "A") },
      { kind: "action", icon: "sound", label: "Test voice B", run: () => c.speak("Quel coup de tonnerre !", "B") },
    ] },
  { id: "opponent", title: "Opponent", blurb: "Who does a player face? Choose how the opponent is picked for every game. The computer opponent is Stockfish, a chess engine.",
    items: (c) => [
      { kind: "choice", label: "Opponent for each game", options: [{ value: "menu", label: "Ask at the table" }, { value: "engine", label: "Always the computer" }, { value: "human", label: "Always another person" }], get: () => c.cfg.opponent.mode, set: (v) => { c.cfg.opponent.mode = v as "menu"; },
        hint: ({ menu: "Players hover a hand over a button on the table to choose the computer or another person each game.", engine: "No question is asked: every game is played against the computer. Good for a kiosk.", human: "No question is asked: every game is two people at the board. The computer is never used." } as Record<string, string>)[c.cfg.opponent.mode] },
      { kind: "choice", label: "Computer strength", options: [{ value: "500", label: "Beginner (500)" }, { value: "1000", label: "Casual (1000)" }, { value: "1500", label: "Strong (1500)" }], get: () => String(c.cfg.opponent.elo), set: (v) => { c.cfg.opponent.elo = Number(v) as 500; },
        hint: c.cfg.opponent.mode === "human" ? "Not used while every game is two people." : "Elo is the chess rating the computer plays at: higher is harder to beat." },
    ] },
  { id: "room", title: "Room", blurb: "Projectors and lights. Scan your room and aim each projector later from the 3D / Mapping tab.",
    items: (c) => [
      { kind: "slider", label: "Projectors", min: 0, max: 3, step: 1, get: () => c.cfg.projectors.count, set: (v) => { c.cfg.projectors.count = v; } },
      { kind: "toggle", label: "People tracking", get: () => c.cfg.tracking.pose, set: (v) => { c.cfg.tracking.pose = v; }, hint: "Tracks players in 3D with the cameras (MediaPipe pose, GPU). Replaces the virtual player." },
      { kind: "toggle", label: "DMX lighting", get: () => c.cfg.projectors.dmx, set: (v) => { c.cfg.projectors.dmx = v; } },
      { kind: "text", label: "DMX bridge URL", get: () => c.cfg.projectors.dmxUrl, set: (v) => { c.cfg.projectors.dmxUrl = v; } },
    ] },
  { id: "launch", title: "Launch", blurb: "Review, then start. You can reopen this setup any time from the top bar.",
    items: (c) => {
      const issues = validateSetup(c.cfg);
      return [
        ...issues.map((i): Item => ({ kind: "info", label: i.level === "error" ? "Error" : "Notice", value: i.message, tone: i.level === "error" ? "fail" : "warn" })),
        { kind: "info", label: "Cameras", value: `${c.cfg.cameras.filter((x) => x.online).length} online / ${c.cfg.cameras.length}` },
        { kind: "toggle", label: "Autoplay demo game", get: () => c.cfg.demo.autoplay, set: (v) => { c.cfg.demo.autoplay = v; }, hint: "Virtual players play a scripted game on the virtual cameras." },
        { kind: "choice", label: "Demo game", options: SCENARIOS.map((s) => ({ value: s.id, label: s.name })), get: () => c.cfg.demo.scenario, set: (v) => { c.cfg.demo.scenario = v; } },
        { kind: "action", label: "Launch experience", disabled: hasErrors(issues), run: () => c.finish() },
      ];
    } },
];
