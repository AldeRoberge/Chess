import { CueEngine } from "../scene/cues";
import { SCENES, type SceneId, type SceneState } from "../scene/types";
import { MAX_CAMERAS, hasErrors, nextCameraId, setAutoField, validateSetup, virtualCamera, webcamSetup, type AutoField, type BoardReading, type Rig, type SetupConfig } from "../setup/config";
import { CHANNEL_NAME, type Channel } from "../setup/autodetect";
import type { CameraDevice } from "../setup/devices";
import type { Check } from "../setup/system";
import { testElevenLabs, testOpenAiKey, type TestResult } from "../setup/keyTests";
import { OPENAI_PRICES } from "../narrator/openaiModels";
import { elevenVoiceLabel, fetchElevenVoices, type ElevenVoice, type VoiceSettings } from "../narrator/voice";
import { fmtCorners, parseCorners } from "../plugins/shared";
import { RIGS, rigCorners } from "../sim/rigs";
import { SCENARIOS } from "../sim/scenarios";
import type { Item } from "./menu";
import { eloVisual } from "./eloGraph";
import { APP_THEMES, MODES, appMode, appTheme, detectRestyler, setAppMode, setAppTheme, type ModePref } from "./appTheme";

export interface WizardState {
  checks: Check[] | null;
  detected: CameraDevice[];
  scanning: boolean;
  boardCam: number; // camera being calibrated
  scenePreview: SceneState;
  tests: Record<string, TestResult>; // latest "Test key" outcome per service id
  groups: Record<string, boolean>; // open state of collapsible sections, by id (absent = the section's default)
  /** Latest unprocessed picture of the board camera (no overlay): what auto detect measures. Null without a signal. */
  frame: ImageData | null;
  /** Latest board reading per camera id, shown on its tab. */
  board: Record<string, BoardReading>;
  /** Result line of the last auto detect. */
  autoMsg: string;
}

export interface StepCtx {
  cfg: SetupConfig;
  state: WizardState;
  refresh(): void; // re-render after a state change
  scan(): void;
  runChecks(): void;
  speak(text: string, voice: "A" | "B"): void;
  thunder(): void;
  /** Opens a web page (where to get an API key) in a new tab. */
  open(url: string): void;
  /** Runs an async key check and shows its result under `state.tests[id]`. */
  test(id: string, job: () => Promise<TestResult>): void;
  /** The voice settings as configured, for testing ElevenLabs without the browser fallback. */
  voiceSettings(): VoiceSettings;
  finish(): void;
  go(step: number): void;
  syncScenePreview(): void;
  /** Fills a camera field from its board picture (or, for the field of view, from the corners) and says what it did. */
  detect(field: AutoField): void;
}

export interface Step { id: string; title: string; blurb: string; items(c: StepCtx): Item[] }

const NAMES = ["Jean", "Margot", "Hugo", "Camille", "Léa", "Louis"].map((n) => ({ value: n, label: n }));
/** The engine has two roles (A calls the action, B adds colour), so there are two commentator slots. */
const SLOT_ROLE = ["Calls the action", "Adds colour and reactions"];
const SLOT_TEST = ["Un joueur rejoint la partie.", "Quel coup de tonnerre !"];

/** Commentator slots, each a name picker with its test / move / remove rows; an empty slot offers to add one. */
const narratorSlots = (c: StepCtx): Item[] => {
  const n = c.cfg.narrator;
  const swap = () => { [n.nameA, n.nameB] = [n.nameB, n.nameA]; c.refresh(); };
  const names = [() => n.nameA, () => n.nameB], setNames = [(x: string) => { n.nameA = x; }, (x: string) => { n.nameB = x; }];
  const out: Item[] = [];
  for (let i = 0; i < 2; i++) {
    const role = SLOT_ROLE[i];
    if (i >= n.voices) {
      out.push({ kind: "action", icon: "plus", label: `Add commentator · slot ${i + 1} (${role.toLowerCase()})`, run: () => {
        if (n.nameB === n.nameA) n.nameB = NAMES.find((o) => o.value !== n.nameA)!.value;
        n.voices = 2; c.refresh();
      } });
      continue;
    }
    out.push(
      { kind: "choice", label: `Slot ${i + 1} · ${role}`, icon: "voice", options: NAMES, get: names[i], set: setNames[i] },
      { kind: "action", icon: "sound", label: `Test slot ${i + 1}`, run: () => c.speak(SLOT_TEST[i], i === 0 ? "A" : "B") },
      { kind: "action", icon: "arrow", label: i === 0 ? "Move slot 1 down" : "Move slot 2 up", disabled: n.voices < 2, hint: n.voices < 2 ? "Add a second commentator to reorder." : undefined, run: swap },
      { kind: "action", icon: "trash", danger: true, label: `Remove slot ${i + 1}`, disabled: n.voices < 2, hint: n.voices < 2 ? "At least one commentator is needed." : undefined,
        run: () => { if (i === 0) n.nameA = n.nameB; n.voices = 1; c.refresh(); } },
    );
  }
  return out;
};

const pct = (v: number) => (v < 0 ? "Scene default" : `${Math.round(v * 100)}%`);

export function sceneStateFor(cfg: SetupConfig): SceneState {
  const cues = new CueEngine();
  cues.setScene(cfg.scene === "auto" ? "winter-forest" : cfg.scene);
  if (cfg.rain >= 0) cues.state.rain = cfg.rain;
  if (cfg.snow >= 0) cues.state.snow = cfg.snow;
  if (cfg.hour >= 0) cues.state.timeOfDay = cfg.hour;
  return cues.state;
}

/** Which square each corner of the board is, seen from white: a board icon with the corner marked. */
const CORNER_ICON = ["corner-tl", "corner-tr", "corner-br", "corner-bl"];
const CORNER_NAME = ["a8", "h8", "h1", "a1"];

/** Corners as a collapsible section: one sub-section per corner (open by default), each with its x and y sliders. */
const cornerItems = (c: StepCtx): Item[] => {
  const cam = c.cfg.cameras[c.state.boardCam];
  const pts = parseCorners(cam.corners) ?? parseCorners(fmtCorners(rigCorners(RIGS.A)))!;
  const now = () => parseCorners(cam.corners) ?? pts;
  const flag = (id: string, def: boolean) => ({ get: () => c.state.groups[id] ?? def, set: (v: boolean) => { c.state.groups[id] = v; } });
  const corners: Item[] = pts.map((_, i) => {
    const name = CORNER_NAME[i];
    const sliders = (["x", "y"] as const).map((axis): Item => ({
      kind: "slider", label: axis === "x" ? "Across (x)" : "Down (y)", min: 0, max: axis === "x" ? 480 : 360, step: 2,
      get: () => now()[i][axis],
      set: (v) => { const q = [...now()]; q[i] = { ...q[i], [axis]: v }; cam.corners = fmtCorners(q); setAutoField(cam, "corners", false); },
    }));
    return { kind: "group", label: name, icon: CORNER_ICON[i], summary: `${now()[i].x}, ${now()[i].y}`, ...flag(`corner.${name}`, true), children: sliders };
  });
  const picture = !!c.state.frame;
  return [{ kind: "group", label: "Corners", icon: "board", summary: (cam.autoFields ?? []).includes("corners") ? "auto-detected" : `${pts.length} corners`, ...flag("corners", false), auto: {
    label: "Auto detect", disabled: !picture, hint: "Needs a live picture from this camera: check that it is online and has a signal.",
    about: "Finds a8, h8, h1 and a1 from the checkerboard, from printed a–h and 1–8 labels, and from AI when an OpenAI key is set.",
    run: () => c.detect("corners"),
  }, children: [
    { kind: "action", icon: "refresh", label: "Reset corners", run: () => { cam.corners = fmtCorners(rigCorners(RIGS[cam.rig])); setAutoField(cam, "corners", false); c.refresh(); } },
    ...corners,
  ] }];
};

/** A numbered how-to line: the label is the step's number and title, the value says what to do. */
const howTo = (n: number, title: string, what: string): Item => ({ kind: "info", label: `${n}. ${title}`, value: what });
const OPENAI_KEYS_URL = "https://platform.openai.com/api-keys";
const OPENAI_BILLING_URL = "https://platform.openai.com/settings/organization/billing/overview";
const ELEVEN_KEYS_URL = "https://elevenlabs.io/app/settings/api-keys";
const ELEVEN_VOICES_URL = "https://elevenlabs.io/app/voice-library";
const link = (c: StepCtx, label: string, url: string): Item => ({ kind: "action", icon: "arrow", label, hint: url, run: () => c.open(url) });
const testLine = (c: StepCtx, id: string): Item[] => { const r = c.state.tests[id]; return r ? [{ kind: "info", label: "Key test", value: r.text, tone: r.tone }] : []; };

const aiItems = (c: StepCtx): Item[] => {
  const ai = c.cfg.ai;
  const out: Item[] = [
    { kind: "choice", label: "Commentary", options: [{ value: "builtin", label: "Built-in (free, offline)" }, { value: "openai", label: "AI by OpenAI" }], get: () => ai.engine, set: (v) => { ai.engine = v as typeof ai.engine; },
      hint: ai.engine === "openai" ? "OpenAI writes fresh commentary for each move. If it is slow or fails, the built-in line plays instead, so the game never waits." : "Ready-made lines. Nothing to set up: no account, no key, no cost." },
  ];
  out.push(
    howTo(1, "Get an OpenAI account", "Sign in or sign up at platform.openai.com. This is the developer platform, separate from a ChatGPT subscription."),
    howTo(2, "Add a little credit", "Open Billing and add a few dollars. The API is pay as you go, and short live commentary costs very little."),
    howTo(3, "Create a secret key", "Open API keys, press Create new secret key, name it (for example Chess), then Copy. The key is shown only once."),
    howTo(4, "Paste it below", "The key starts with sk-. It is kept in this browser and only ever sent to OpenAI."),
    link(c, "Open OpenAI billing", OPENAI_BILLING_URL),
    link(c, "Open OpenAI API keys", OPENAI_KEYS_URL),
  );
  if (ai.engine !== "openai") return out; // the steps above are always listed; the key fields only matter once OpenAI is chosen
  out.push(
    { kind: "text", label: "OpenAI API key", secret: true, get: () => ai.apiKey, set: (v) => { ai.apiKey = v.trim(); delete c.state.tests.openai; c.refresh(); }, hint: "Paste the key you just copied, then press Enter." },
    { kind: "choice", label: "Model", options: Object.keys(OPENAI_PRICES).map((id) => ({ value: id, label: `${id} · $${OPENAI_PRICES[id].input} in / $${OPENAI_PRICES[id].output} out per 1M` })), get: () => ai.model, set: (v) => { ai.model = v; },
      hint: "Small models are fast and cheap, which suits live commentary. Prices are per million tokens." },
    { kind: "action", icon: "refresh", label: "Test key", run: () => c.test("openai", () => testOpenAiKey(ai.apiKey)) },
    ...testLine(c, "openai"),
  );
  return out;
};

/** The ElevenLabs voices of the key last loaded (kept across re-renders of the step). */
const voiceList: { key: string; voices: ElevenVoice[]; busy: boolean; error: string } = { key: "", voices: [], busy: false, error: "" };
function loadVoices(c: StepCtx) {
  const key = c.cfg.voice.apiKey.trim();
  if (!key || voiceList.busy) return;
  voiceList.busy = true; voiceList.error = "";
  fetchElevenVoices(key).then((vs) => { voiceList.key = key; voiceList.voices = vs; if (!vs.length) voiceList.error = "This account has no voices."; })
    .catch((e) => { voiceList.error = /401|403/.test(String(e)) ? "ElevenLabs refused the key (the key may lack the voices_read permission). Type voice IDs instead." : "Could not load voices. Check the key and connection."; })
    .finally(() => { voiceList.busy = false; c.refresh(); });
  c.refresh();
}

/** Voice id to name for the loaded account voices, or undefined until they are loaded for the current key. */
const voiceNamesFor = (c: StepCtx): Record<string, string> | undefined =>
  voiceList.key === c.cfg.voice.apiKey.trim() && voiceList.voices.length ? Object.fromEntries(voiceList.voices.map((x) => [x.id, x.name])) : undefined;

const voiceItems = (c: StepCtx): Item[] => {
  const v = c.cfg.voice;
  const out: Item[] = [
    { kind: "choice", label: "Voice engine", options: [{ value: "browser", label: "System voices (free)" }, { value: "elevenlabs", label: "ElevenLabs (natural)" }], get: () => v.engine, set: (x) => { v.engine = x as typeof v.engine; },
      hint: v.engine === "elevenlabs" ? "Lifelike voices. If the key fails or you are offline, the system voice speaks instead." : "Uses the voices installed on this computer. Free and works offline, but they sound more robotic." },
  ];
  if (v.engine !== "elevenlabs") {
    out.push({ kind: "action", icon: "sound", label: "Test voice A", run: () => c.speak("Un joueur rejoint la partie.", "A") }, { kind: "action", icon: "sound", label: "Test voice B", run: () => c.speak("Quel coup de tonnerre !", "B") });
    return out;
  }
  const say = (who: "A" | "B", text: string) => c.test("elevenlabs", () => testElevenLabs(text, who, c.voiceSettings()));
  out.push(
    howTo(1, "Get an ElevenLabs account", "Sign up at elevenlabs.io. The free plan includes some monthly credits, and each spoken line uses a few."),
    howTo(2, "Create an API key", "Open your profile (bottom left) then API Keys, press Create API Key and name it. Switching on Text to Speech access is enough."),
    howTo(3, "Copy and paste it", "Copy the key right away and paste it below. It is kept in this browser and only ever sent to ElevenLabs."),
    howTo(4, "Optional: pick voices", "Press Load my voices to choose from your account's voices in a dropdown. Or paste a voice ID from the Voice Library. The defaults already work."),
    link(c, "Open ElevenLabs API keys", ELEVEN_KEYS_URL),
    link(c, "Open ElevenLabs voice library", ELEVEN_VOICES_URL),
    { kind: "text", label: "ElevenLabs API key", secret: true, get: () => v.apiKey, set: (x) => { v.apiKey = x.trim(); delete c.state.tests.elevenlabs; loadVoices(c); c.refresh(); }, hint: "Paste the key you just copied, then press Enter." },
    { kind: "action", icon: "refresh", label: voiceList.busy ? "Loading voices…" : "Load my voices", disabled: voiceList.busy, run: () => loadVoices(c) },
    ...(voiceList.error ? [{ kind: "info", label: "Voices", value: voiceList.error, tone: "fail" } as Item] : []),
  );
  if (voiceList.key === v.apiKey && voiceList.voices.length) {
    // include a currently set ID that is not in the account's list, so the dropdown never shows a blank
    const opts = (cur: string) => {
      const o = voiceList.voices.map((x) => ({ value: x.id, label: elevenVoiceLabel(x) }));
      return !cur || o.some((x) => x.value === cur) ? o : [{ value: cur, label: `Custom (${cur})` }, ...o];
    };
    out.push(
      { kind: "choice", label: "Voice A", options: opts(v.voiceIdA), get: () => v.voiceIdA, set: (x) => { v.voiceIdA = x; } },
      { kind: "choice", label: "Voice B", options: opts(v.voiceIdB), get: () => v.voiceIdB, set: (x) => { v.voiceIdB = x; } },
    );
  } else {
    out.push(
      { kind: "text", label: "Voice ID A", get: () => v.voiceIdA, set: (x) => { v.voiceIdA = x.trim(); } },
      { kind: "text", label: "Voice ID B", get: () => v.voiceIdB, set: (x) => { v.voiceIdB = x.trim(); } },
    );
  }
  for (const i of validateSetup(c.cfg, voiceNamesFor(c)).filter((x) => x.field === "voice" && x.level === "error")) out.push({ kind: "info", label: "Error", value: i.message, tone: "fail" });
  out.push(
    { kind: "action", icon: "sound", label: "Test voice A", run: () => say("A", "Un joueur rejoint la partie.") },
    { kind: "action", icon: "sound", label: "Test voice B", run: () => say("B", "Quel coup de tonnerre !") },
    ...testLine(c, "elevenlabs"),
  );
  return out;
};

export const STEPS: Step[] = [
  { id: "briefing", title: "System check", blurb: "Checking that this device can run the experience. Settings then take about two minutes: cameras, board, scenes, narration, opponent.",
    items: (c) => [
      ...(c.state.checks ? [{ kind: "action", icon: "refresh", label: "Re-run system check", run: () => c.runChecks() } as Item] : [{ kind: "info", label: "Running system check…" } as Item]),
    ] },
  { id: "cameras", title: "Cameras", blurb: "Add webcams (IR if you have them) or virtual 3D cameras. An offline camera is simply ignored.",
    items: (c) => {
      // the cameras themselves (preview, status, online switch, remove) are the table the wizard draws above this list
      const out: Item[] = [];
      const full = c.cfg.cameras.length >= MAX_CAMERAS;
      const fullWhy = `All ${MAX_CAMERAS} camera slots are used. Remove a camera from the table above to add another.`;
      out.push({ kind: "action", icon: "scan", label: c.state.scanning ? "Scanning…" : "Scan for webcams", disabled: c.state.scanning, hint: c.state.scanning ? "A scan is already running. It finishes in a few seconds." : undefined, run: () => c.scan() });
      for (const d of c.state.detected.filter((d) => !c.cfg.cameras.some((x) => x.deviceId === d.deviceId))) {
        out.push({ kind: "action", icon: "plus", label: `Add webcam · ${d.label}`, disabled: full, hint: full ? fullWhy : undefined, run: () => { c.cfg.cameras.push(webcamSetup(d.deviceId, d.label, nextCameraId(c.cfg))); c.refresh(); } });
      }
      out.push({ kind: "action", icon: "world", label: "Add virtual camera", disabled: full, hint: full ? fullWhy : undefined, run: () => {
        const used = new Set(c.cfg.cameras.filter((x) => x.kind === "virtual").map((x) => x.rig));
        const rig = (["A", "B", "C"] as Rig[]).find((r) => !used.has(r)) ?? "A";
        c.cfg.cameras.push(virtualCamera(rig, nextCameraId(c.cfg))); c.refresh();
      } });
      return out;
    } },
  { id: "board", title: "Board", blurb: "Pick a camera from the tabs, then drag the four green handles onto a8, h8, h1 and a1, or press Auto detect on Corners. That uses the checkerboard, printed a–h and 1–8 labels, and AI when an OpenAI key is set.",
    items: (c) => {
      if (!c.cfg.cameras.length) return [{ kind: "info", label: "No cameras", value: "Add one in the previous step.", tone: "warn" }];
      // the camera itself is chosen on the tabs above this list; the rows below are that camera's settings
      const cam = c.cfg.cameras[c.state.boardCam];
      const picture = !!c.state.frame, noPicture = "Needs a live picture from this camera: check that it is online and has a signal.";
      return [
        { kind: "choice", label: "Channel", icon: "palette", options: (["luma", "red", "green", "blue"] as Channel[]).map((v) => ({ value: v, label: CHANNEL_NAME[v] })), get: () => cam.channel,
          set: (v) => { cam.channel = v as Channel; setAutoField(cam, "channel", false); }, hint: "IR cameras often show up in the red channel. Auto detect picks the channel where the board stands out most.",
          auto: { label: "Auto detect", disabled: !picture, hint: noPicture, run: () => c.detect("channel") } },
        { kind: "slider", label: "Trust", icon: "scale", min: 0, max: 2, step: 0.1, get: () => cam.trust, set: (v) => { cam.trust = v; setAutoField(cam, "trust", false); },
          hint: "How much this camera counts when the cameras disagree. Auto detect rates how clearly the board squares show.",
          auto: { label: "Auto detect", disabled: !picture, hint: noPicture, run: () => c.detect("trust") } },
        { kind: "slider", label: "Field of view", icon: "eye", min: 30, max: 110, step: 1, get: () => cam.fov, set: (v) => { cam.fov = v; setAutoField(cam, "fov", false); }, fmt: (v) => `${v}°`,
          hint: "Vertical angle of the lens. Used to place the camera in the room from its board corners. Auto detect reads it from the corners.",
          auto: { label: "Auto detect", run: () => c.detect("fov") } },
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
  { id: "narration", title: "Narration", blurb: "Fill the commentator slots: the first calls the action, the second adds colour. Add, remove or swap them, in French.",
    items: (c) => [...narratorSlots(c),
      { kind: "toggle", label: "Speak aloud", icon: "sound", get: () => c.cfg.narrator.speak, set: (v) => { c.cfg.narrator.speak = v; } },
      { kind: "slider", label: "Volume", icon: "sound", min: 0, max: 1, step: 0.1, get: () => c.cfg.narrator.volume, set: (v) => { c.cfg.narrator.volume = v; }, fmt: (v) => `${Math.round(v * 100)}%` },
    ] },
  { id: "ai", title: "AI commentary", blurb: "Optional: let OpenAI write the commentary live instead of the built-in lines. You need an API key; the steps below show how to get one.", items: aiItems },
  { id: "voice", title: "Voice engine", blurb: "Choose who speaks the commentary: the voices already on this computer, or lifelike ElevenLabs voices (needs an API key).", items: voiceItems },
  { id: "opponent", title: "Opponent", blurb: "Who does a player face? Choose how the opponent is picked for every game. The computer opponent is Stockfish, a chess engine.",
    items: (c) => [
      { kind: "choice", label: "Opponent for each game", options: [{ value: "menu", label: "Ask at the table" }, { value: "engine", label: "Always the computer" }, { value: "human", label: "Always another person" }], get: () => c.cfg.opponent.mode, set: (v) => { c.cfg.opponent.mode = v as "menu"; },
        hint: ({ menu: "Players hover a hand over a button on the table to choose the computer or another person each game.", engine: "No question is asked: every game is played against the computer. Good for a kiosk.", human: "No question is asked: every game is two people at the board. The computer is never used." } as Record<string, string>)[c.cfg.opponent.mode] },
      { kind: "slider", label: "Computer strength", min: 500, max: 2800, step: 50, get: () => c.cfg.opponent.elo, set: (v) => { c.cfg.opponent.elo = v; }, fmt: (v) => `${v} Elo`,
        visual: eloVisual(c.cfg.opponent.elo),
        hint: c.cfg.opponent.mode === "human" ? "Not used while every game is two people." : "Elo is the chess rating the computer plays at: higher is harder to beat." },
    ] },
  { id: "room", title: "Room", blurb: "Projectors and lights. Scan your room and aim each projector later from the 3D / Mapping tab.",
    items: (c) => [
      { kind: "slider", label: "Projectors", min: 0, max: 3, step: 1, get: () => c.cfg.projectors.count, set: (v) => { c.cfg.projectors.count = v; } },
      { kind: "toggle", label: "People tracking", get: () => c.cfg.tracking.pose, set: (v) => { c.cfg.tracking.pose = v; }, hint: "Tracks players in 3D with the cameras (MediaPipe pose, GPU). Replaces the virtual player." },
      { kind: "toggle", label: "DMX lighting", get: () => c.cfg.projectors.dmx, set: (v) => { c.cfg.projectors.dmx = v; } },
      { kind: "text", label: "DMX bridge URL", get: () => c.cfg.projectors.dmxUrl, set: (v) => { c.cfg.projectors.dmxUrl = v; } },
    ] },
  { id: "theme", title: "Theme", blurb: "Pick the look of the whole app: a theme and a light, dark or system mode. It changes right away.",
    items: (c) => {
      const out: Item[] = [
        { kind: "choice", label: "Theme", icon: "palette", options: APP_THEMES.map((t) => ({ value: t.id, label: t.name })), get: () => appTheme().id, set: (v) => setAppTheme(v) },
        { kind: "choice", label: "Mode", icon: "sun", options: MODES.map((m) => ({ value: m, label: m[0].toUpperCase() + m.slice(1) })), get: () => appMode(), set: (v) => setAppMode(v as ModePref) },
      ];
      const r = detectRestyler();
      if (r) out.push({ kind: "info", label: `${r} is active`, value: "It recolours the page and can hide the theme. Turn it off for this site.", tone: "warn" });
      return out;
    } },
  { id: "launch", title: "Launch", blurb: "Review, then start. You can reopen settings any time from the top bar.",
    items: (c) => {
      const issues = validateSetup(c.cfg, voiceNamesFor(c));
      return [
        ...issues.map((i): Item => ({ kind: "info", label: i.level === "error" ? "Error" : "Notice", value: i.message, tone: i.level === "error" ? "fail" : "warn" })),
        { kind: "info", label: "Cameras", value: `${c.cfg.cameras.filter((x) => x.online).length} online / ${c.cfg.cameras.length}` },
        { kind: "toggle", label: "Autoplay demo game", get: () => c.cfg.demo.autoplay, set: (v) => { c.cfg.demo.autoplay = v; }, hint: "Virtual players play a scripted game on the virtual cameras." },
        { kind: "choice", label: "Demo game", options: SCENARIOS.map((s) => ({ value: s.id, label: s.name })), get: () => c.cfg.demo.scenario, set: (v) => { c.cfg.demo.scenario = v; } },
        { kind: "action", label: "Launch experience", disabled: hasErrors(issues), hint: hasErrors(issues) ? "Can't launch yet: fix the error listed above first." : undefined, run: () => c.finish() },
      ];
    } },
];
