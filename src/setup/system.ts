import { REVISION } from "three";

export interface EnvRow { label: string; value: string }
/** Per-check facts shown in the system table: a one-line summary and the rows behind its dropdown. */
export interface CheckAction { id: string; label: string; icon: string }
export type EnvDetail = Record<string, { summary: string; rows: EnvRow[]; status?: "warn"; actions?: CheckAction[] }>;
export interface Env {
  mediaDevices: boolean; webgl: boolean; audio: boolean; speech: boolean; worker: boolean; stockfish: boolean; gamepad: boolean;
  detail?: EnvDetail;
}
export interface Check { id: string; label: string; status: "ok" | "warn" | "fail"; detail: string; summary?: string; rows?: EnvRow[]; actions?: CheckAction[] }

/** Pure evaluation of the environment: what works, what degrades, what blocks. */
export function evaluateEnv(e: Env): Check[] {
  const c = (id: string, label: string, ok: boolean, level: "warn" | "fail", good: string, bad: string): Check => ({ id, label, status: ok ? "ok" : level, detail: ok ? good : bad });
  const checks = [
    c("webgl", "3D graphics (WebGL)", e.webgl, "fail", "Hardware acceleration available.", "WebGL unavailable: the 3D room and projector output cannot run."),
    c("camera", "Camera access", e.mediaDevices, "warn", "Webcams can be listed and opened.", "No camera API (needs https or localhost): use virtual cameras."),
    c("audio", "Sound engine", e.audio, "warn", "Rain, thunder and fire are synthesised live.", "No Web Audio: scenes will be silent."),
    c("speech", "Narrator voices", e.speech, "warn", "Speech synthesis available for the commentators.", "No speech synthesis: narration will be text only."),
    c("stockfish", "Stockfish engine", e.worker && e.stockfish, "warn", "Stockfish 19 (WASM) found.", e.worker ? "Run `npm run setup:stockfish`. A weaker fallback opponent will be used." : "No Web Workers: fallback opponent only."),
    c("gamepad", "Gamepad", e.gamepad, "warn", "Gamepad API available (D-pad / A / B).", "No Gamepad API: use keyboard or mouse."),
  ];
  if (e.detail?.system) checks.unshift({ id: "system", label: "This device", status: "ok", detail: "Browser and hardware." });
  for (const k of checks) { const d = e.detail?.[k.id]; if (d) { k.summary = d.summary; k.rows = d.rows; k.actions = d.actions; if (d.status && k.status === "ok") k.status = d.status; } }
  return checks;
}

const safe = async <T>(f: () => T | Promise<T>, fallback: T): Promise<T> => { try { return await f(); } catch { return fallback; } };
const row = (label: string, value: unknown): EnvRow[] => (value === undefined || value === null || value === "" ? [] : [{ label, value: String(value) }]);
const ms = (s: unknown) => (typeof s === "number" && isFinite(s) ? `${(s * 1000).toFixed(1)} ms` : "");

async function listDevices(kind: MediaDeviceKind): Promise<MediaDeviceInfo[]> {
  return safe(async () => (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === kind), []);
}
const deviceNames = (ds: MediaDeviceInfo[], none: string) => (!ds.length ? none : ds.every((d) => !d.label) ? `${ds.length} found (names hidden until camera or microphone permission is granted)` : ds.map((d) => d.label || "Unnamed").join(", "));

function webglDetail(gl: any): { summary: string; rows: EnvRow[] } {
  const two = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;
  const ext = gl.getExtension?.("WEBGL_debug_renderer_info");
  const gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter?.(gl.RENDERER) ?? "");
  const vendor = ext ? String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)) : String(gl.getParameter?.(gl.VENDOR) ?? "");
  const soft = /swiftshader|llvmpipe|software|basic render/i.test(gpu);
  const aniso = gl.getExtension?.("EXT_texture_filter_anisotropic");
  const api = two ? "WebGL 2" : "WebGL 1";
  return {
    summary: [`three.js r${REVISION}`, api, gpu].filter(Boolean).join(" · "),
    rows: [
      ...row("3D engine", `three.js r${REVISION}`), ...row("Graphics API", api),
      ...row("GPU", gpu), ...row("GPU vendor", vendor), ...row("Acceleration", gpu ? (soft ? "Software rendering (slow)" : "Hardware") : ""),
      ...row("Shading language", gl.getParameter?.(gl.SHADING_LANGUAGE_VERSION)), ...row("Max texture size", gl.getParameter?.(gl.MAX_TEXTURE_SIZE)),
      ...row("Max anisotropy", aniso ? gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : ""),
      ...row("MSAA samples", two ? gl.getParameter(gl.MAX_SAMPLES) : ""),
    ],
  };
}

async function audioDetail(): Promise<{ summary: string; rows: EnvRow[] }> {
  const outs = await listDevices("audiooutput");
  let ctx: AudioContext | null = null;
  try { ctx = new AudioContext(); } catch { ctx = null; }
  const rate = ctx ? `${ctx.sampleRate} Hz` : "";
  const chans = ctx?.destination?.maxChannelCount;
  const out = { summary: ["Web Audio", rate, chans ? `${chans} ch` : ""].filter(Boolean).join(" · "),
    rows: [...row("Engine", "Web Audio API (synthesised live)"), ...row("Output device", deviceNames(outs, "System default")), ...row("Sample rate", rate),
      ...row("Output channels", chans), ...row("Base latency", ms(ctx?.baseLatency)), ...row("Output latency", ms((ctx as any)?.outputLatency)),
      ...row("State", ctx?.state === "suspended" ? "Suspended until the first click or key press" : ctx?.state)] };
  try { void ctx?.close(); } catch { /* ignore */ }
  return out;
}

async function speechDetail(): Promise<EnvDetail[string]> {
  let voices = speechSynthesis.getVoices();
  if (!voices.length) await new Promise<void>((r) => { const t = setTimeout(r, 400); speechSynthesis.addEventListener?.("voiceschanged", () => { clearTimeout(t); r(); }, { once: true }); });
  voices = speechSynthesis.getVoices();
  const fr = voices.filter((v) => /^fr/i.test(v.lang));
  const def = voices.find((v) => v.default);
  return {
    summary: `${voices.length} voices · ${fr.length} French`,
    actions: voices.length ? [{ id: "speech.test", label: "Test voice", icon: "play" }] : undefined,
    rows: [...row("Voices installed", voices.length), ...row("French voices", fr.length ? fr.map((v) => `${v.name}${v.localService ? "" : " (online)"}`).join(", ") : "None: narration may use another language"),
      ...row("Default voice", def ? `${def.name} (${def.lang})` : "")],
  };
}

function systemDetail(): { summary: string; rows: EnvRow[] } {
  const nav = navigator as any;
  const brands = nav.userAgentData?.brands?.filter((b: { brand: string }) => !/not.?a.?brand/i.test(b.brand)).map((b: { brand: string; version: string }) => `${b.brand} ${b.version}`).join(", ");
  const screenText = typeof screen !== "undefined" ? `${screen.width}×${screen.height} @ ${window.devicePixelRatio || 1}x` : "";
  return {
    summary: [nav.hardwareConcurrency ? `${nav.hardwareConcurrency} threads` : "", screenText].filter(Boolean).join(" · "),
    rows: [...row("Browser", brands || navigator.userAgent), ...row("Platform", nav.userAgentData?.platform || navigator.platform),
      ...row("CPU threads", nav.hardwareConcurrency), ...row("Memory", nav.deviceMemory ? `${nav.deviceMemory} GB or more` : ""), ...row("Screen", screenText),
      ...row("Language", navigator.language), ...row("Secure context", window.isSecureContext ? "Yes" : "No (camera needs https or localhost)"), ...row("Network", navigator.onLine ? "Online" : "Offline")],
  };
}

export async function detectEnv(): Promise<Env> {
  const canvas = document.createElement("canvas");
  let gl: any = null;
  try { gl = canvas.getContext("webgl2") || canvas.getContext("webgl"); } catch { gl = null; }
  const webgl = !!gl;
  let stockfish = false; let wasm: Response | null = null;
  try { wasm = await fetch(`${import.meta.env.BASE_URL}stockfish/stockfish-19-lite-single.wasm`, { method: "HEAD" }); stockfish = wasm.ok && !String(wasm.headers.get("content-type")).includes("html"); } catch { stockfish = false; }
  const mediaDevices = !!navigator.mediaDevices?.getUserMedia;
  const audio = typeof AudioContext !== "undefined", speech = typeof speechSynthesis !== "undefined";
  const worker = typeof Worker !== "undefined", gamepad = typeof navigator.getGamepads === "function";

  const detail: EnvDetail = {};
  const put = async (id: string, on: boolean, f: () => EnvDetail[string] | Promise<EnvDetail[string]>) => { if (on) { const d = await safe(f, null as null | EnvDetail[string]); if (d) detail[id] = d; } };
  await put("system", true, systemDetail);
  await put("webgl", webgl, () => webglDetail(gl));
  await put("camera", mediaDevices, async () => {
    const cams = await listDevices("videoinput");
    const perm = await safe(async () => (await navigator.permissions.query({ name: "camera" as PermissionName })).state as string, "unknown");
    const granted = perm === "granted" || (cams.length > 0 && cams.every((d) => !!d.label));
    const denied = perm === "denied";
    const n = `${cams.length} camera${cams.length === 1 ? "" : "s"}`;
    const summary = denied ? "Permission blocked" : !cams.length ? "No camera detected" : granted ? `${n} ready` : `${n} · permission needed`;
    return { summary, status: granted && cams.length ? undefined : "warn" as const,
      actions: [{ id: "camera.grant", label: granted ? "Re-grant" : denied ? "Retry" : "Allow camera", icon: "camera" }],
      rows: [...row("Permission", denied ? "Blocked: click the lock icon in the address bar, set Camera to Allow, then Retry" : granted ? "Granted" : "Not granted yet"),
        ...row("Cameras", deviceNames(cams, "None detected")), ...row("Secure context", window.isSecureContext ? "Yes" : "No")] };
  });
  await put("audio", audio, audioDetail);
  await put("speech", speech, speechDetail);
  await put("stockfish", worker, () => ({ summary: stockfish ? "Stockfish 19 · WASM" : "Not installed", rows: [...row("Engine", "Stockfish 19 lite (single-thread WASM)"), ...row("File", "/stockfish/stockfish-19-lite-single.wasm"),
    ...row("Status", stockfish ? "Found" : "Missing: run npm run setup:stockfish"), ...row("Size", wasm?.headers.get("content-length") ? `${(Number(wasm.headers.get("content-length")) / 1048576).toFixed(1)} MB` : ""),
    ...row("Web Workers", "Available"), ...row("Cross-origin isolated", (self as any).crossOriginIsolated ? "Yes" : "No (single-thread build is used)")] }));
  await put("gamepad", gamepad, () => { const pads = Array.from(navigator.getGamepads()).filter((g): g is Gamepad => !!g && g.connected); return { summary: pads.length ? `${pads.length} connected` : "None connected", rows: [...row("Connected", pads.length ? pads.map((g) => g.id).join(", ") : "None: press a button on a pad to wake it"), ...row("Mapping", pads[0]?.mapping || "")] }; });

  return { mediaDevices, webgl, audio, speech, worker, stockfish, gamepad, detail };
}

/** Run a check's fix/test button. The caller re-runs the checks afterwards. */
export async function runCheckAction(id: string): Promise<void> {
  if (id === "camera.grant") {
    const s = await navigator.mediaDevices.getUserMedia({ video: true });
    s.getTracks().forEach((t) => t.stop());
  } else if (id === "speech.test") {
    const u = new SpeechSynthesisUtterance("Bonjour, la partie peut commencer."); u.lang = "fr-CA";
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  }
}
