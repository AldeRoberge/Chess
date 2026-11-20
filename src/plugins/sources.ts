import type { NodeSpec, Plugin } from "../core/types";
import type { VirtualTable } from "../sim/virtualTable";
import { applySensor, renderLuminance } from "../sim/render3d";
import { renderPool } from "../sim/renderPool";
import { FRAME_H, FRAME_W, RIGS } from "../sim/rigs";
import type { GrayFrame } from "../vision/types";
import { drawFrame, withDetail } from "./shared";
import { frameHover } from "./hover";
import { openStream } from "../setup/devices";

interface WebcamState { video: HTMLVideoElement | null; canvas: HTMLCanvasElement | null; stream: MediaStream | null; starting: boolean; last: number; frame: GrayFrame | null; err: string; frozenUntil: number; res: string; status: string; debug: string; frames: number; dev?: string }
const webcamStatus = (s: WebcamState) => s.err ? "Error" : s.starting || (s.stream && !s.frame) ? "Loading" : s.frame ? "Live" : "Offline";
/** Capture sizes. The picture is kept at this size (or the camera's own size when that is smaller). The board reader averages it down to 480×360 to sample the squares. */
const RESOLUTIONS: Record<string, [number, number]> = { "640x480": [640, 480], "960x720": [960, 720], "1280x960": [1280, 960] };

/** The Device dropdown's choices, edited in place: the editor rebuilds the list from these arrays each time it opens. */
const deviceOptions: string[] = [""], deviceLabels: string[] = ["Default camera"];
async function refreshDevices() {
  try {
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput" && d.deviceId);
    deviceOptions.length = 0; deviceLabels.length = 0;
    deviceOptions.push(""); deviceLabels.push("Default camera");
    cams.forEach((d, i) => { deviceOptions.push(d.deviceId); deviceLabels.push(d.label || `Camera ${i + 1}`); });
  } catch { /* no camera API: only the default stays */ }
}
if (typeof navigator !== "undefined" && typeof navigator.mediaDevices?.enumerateDevices === "function") {
  void refreshDevices();
  navigator.mediaDevices.addEventListener?.("devicechange", () => void refreshDevices());
}

const webcam: NodeSpec<WebcamState> = {
  type: "source.webcam", title: "Webcam", category: "Source",
  inputs: [], outputs: [{ id: "frame", type: "frame" }],
  params: [
    { id: "online", kind: "bool", label: "Online", value: true },
    { id: "device", kind: "select", label: "Device", options: deviceOptions, labels: deviceLabels, value: "" },
    { id: "channel", kind: "select", label: "Channel", options: ["luma", "red", "green", "blue"], value: "luma" },
    { id: "fps", kind: "number", label: "FPS", min: 1, max: 30, step: 1, value: 4 },
    { id: "resolution", kind: "select", label: "Capture resolution", options: Object.keys(RESOLUTIONS), value: "1280x960" },
    // Simulated faults, to test how the pipeline copes with a bad camera. All off by default.
    // Shown as a list: pick a fault from the "Add…" dropdown and it appears with its own sliders.
    { id: "ir", kind: "bool", optional: true, label: "Fake IR", value: false },
    { id: "bw", kind: "bool", optional: true, label: "Black and white", value: false },
    { id: "over", kind: "bool", optional: true, label: "Overexposed", value: false },
    { id: "overAmount", kind: "number", group: "over", label: "Overexposure %", min: 0, max: 100, step: 5, value: 50 },
    { id: "under", kind: "bool", optional: true, label: "Underexposed", value: false },
    { id: "underAmount", kind: "number", group: "under", label: "Underexposure %", min: 0, max: 100, step: 5, value: 50 },
    { id: "drop", kind: "bool", optional: true, label: "Dropped frames", value: false },
    { id: "dropPct", kind: "number", group: "drop", label: "Dropped frames %", min: 0, max: 100, step: 5, value: 30 },
    { id: "freeze", kind: "bool", optional: true, label: "Freeze frames", value: false },
    { id: "freezePct", kind: "number", group: "freeze", label: "Freeze chance %", min: 0, max: 100, step: 5, value: 10 },
    { id: "freezeMs", kind: "number", group: "freeze", label: "Freeze length (ms)", min: 100, max: 5000, step: 100, value: 1500 },
  ],
  previewSize: [240, 240],
  init: () => ({ video: null, canvas: null, stream: null, starting: false, last: 0, frame: null, err: "", frozenUntil: 0, res: "", status: "Waiting for first tick", debug: "Camera has not been requested yet", frames: 0 }),
  process(_i, { params, state, now, setFidelity, span }) {
    const stop = () => { state.stream?.getTracks().forEach((t) => t.stop()); state.stream = null; state.video = null; state.frame = null; };
    if (!params.online) { if (state.stream) stop(); state.status = "Camera disabled"; state.debug = "Online is off; no frames requested"; setFidelity(null); return { frame: null }; }
    if (!navigator.mediaDevices) { state.err = "Camera API unavailable (requires HTTPS or localhost)"; state.status = "Cannot open camera"; state.debug = state.err; }
    const [capW, capH] = RESOLUTIONS[String(params.resolution)] ?? RESOLUTIONS["640x480"];
    if (state.stream && state.res !== String(params.resolution)) stop(); // a new capture size reopens the camera
    if (!state.stream && !state.starting && navigator.mediaDevices) {
      state.starting = true;
      state.status = "Enumerating video devices";
      state.debug = "Awaiting navigator.mediaDevices.enumerateDevices()";
      void (async () => {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const want = String(params.device);
          const dev = want ? devices.find((d) => d.kind === "videoinput" && (d.deviceId === want || d.label.toLowerCase().includes(want.toLowerCase()))) : undefined;
          state.dev = dev?.label || (want && !/^[0-9a-f]{20,}$/i.test(want) ? want : "") || "default camera";
          state.status = "Requesting camera stream";
          state.debug = `${devices.filter(d => d.kind === "videoinput").length} cameras; ${dev?.label || dev?.deviceId || "default device"}; ${capW}×${capH}. Awaiting getUserMedia (permission/device open; 6s timeout)`;
          const stream = await openStream({ video: { ...(dev ? { deviceId: { exact: dev.deviceId } } : {}), width: capW, height: capH } });
          state.status = "Starting video playback";
          state.debug = "Stream acquired; attaching srcObject and awaiting video.play()";
          const v = document.createElement("video"); v.srcObject = stream; v.muted = true; await v.play();
          void refreshDevices(); // names are only known once the camera is allowed
          state.stream = stream; state.video = v; state.res = String(params.resolution); state.canvas = document.createElement("canvas"); state.err = "";
          state.status = "Waiting for first frame";
          state.debug = `Video playback started; capture scheduled at ${params.fps} FPS`;
          stream.getVideoTracks()[0].onended = () => { stop(); state.status = "Camera track ended"; state.debug = "Device unplugged or stream ended; will attempt to reopen"; };
        } catch (e) { state.err = String(e); state.status = "Camera startup failed"; state.debug = state.err; }
        state.starting = false;
      })();
    }
    if (state.video && now - state.last >= 1000 / Number(params.fps)) {
      state.last = now;
      if (now < state.frozenUntil) { state.status = "Simulated freeze"; state.debug = `Holding last frame for ${Math.ceil(state.frozenUntil - now)} ms`; }
      else if (params.freeze && Math.random() * 100 < Number(params.freezePct)) { state.frozenUntil = now + Number(params.freezeMs); state.status = "Simulated freeze"; state.debug = `Holding last frame for ${params.freezeMs} ms`; }
      else if (params.drop && Math.random() * 100 < Number(params.dropPct)) { state.status = "Simulated dropped frame"; state.debug = "Capture skipped; retaining previous frame"; }
      else {
        const video = state.video!, canvas = state.canvas!;
        // Keep the camera's real pixels. Only shrink when the camera is larger than the chosen capture size, and do not stretch a smaller one up.
        const vw = video.videoWidth || capW, vh = video.videoHeight || capH;
        let tw = vw, th = vh;
        if (vw > capW || vh > capH) { const sc = Math.min(capW / vw, capH / vh); tw = Math.max(1, Math.round(vw * sc)); th = Math.max(1, Math.round(vh * sc)); }
        if (canvas.width !== tw || canvas.height !== th) { canvas.width = tw; canvas.height = th; }
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        ctx.imageSmoothingEnabled = tw !== vw || th !== vh;
        const px = span("grab frame (read pixels)", () => { ctx.drawImage(video, 0, 0, tw, th); return ctx.getImageData(0, 0, tw, th).data; });
        const g = new Uint8ClampedArray(tw * th);
        // Fake IR reads the red plane (how IR often lands in a colour camera) and beats the channel menu; black and white forces brightness.
        const ch = params.ir ? "red" : params.bw ? "luma" : String(params.channel);
        const n = g.length; // channel chosen once, not per pixel
        span("to grayscale", () => {
          if (ch === "red") for (let i = 0; i < n; i++) g[i] = px[i * 4];
          else if (ch === "green") for (let i = 0; i < n; i++) g[i] = px[i * 4 + 1];
          else if (ch === "blue") for (let i = 0; i < n; i++) g[i] = px[i * 4 + 2];
          else for (let i = 0; i < n; i++) g[i] = px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114;
        });
        // Exposure: a gain on the picture; the Uint8ClampedArray store clips highlights (over) or shadows crush to black (under).
        const gain = params.over ? 1 + Number(params.overAmount) / 100 * 3 : params.under ? 1 - Number(params.underAmount) / 100 * 0.9 : 1;
        if (gain !== 1) span("apply exposure", () => { for (let i = 0; i < n; i++) g[i] = g[i] * gain; });
        state.frame = { width: tw, height: th, data: g, t: now, source: state.dev };
        state.frames++;
        state.status = `Captured frame ${state.frames}`;
        state.debug = `${vw}×${vh} video → ${tw}×${th} pixels → ${ch}; gain ${gain.toFixed(2)}; ${params.fps} FPS target; t=${Math.round(now)} ms`;
      }
    }
    setFidelity(state.frame ? 1 : 0);
    return { frame: state.frame };
  },
  dispose(s) { s.stream?.getTracks().forEach((t) => t.stop()); },
  hover: (p, w, h, s) => frameHover(p, w, h, [240, 240], s.frame, "Webcam", [
    { label: "Status", value: webcamStatus(s), tone: s.err ? "bad" : s.frame ? "ok" : "warn" },
    { label: "Operation", value: s.status }, { label: "Debug", value: s.debug },
    ...(s.err ? [{ label: "Error", value: s.err, tone: "bad" as const }] : []),
  ]),
  preview: (ctx, w, h, s) => withDetail(ctx, w, h, [240, 240], (pw, ph) => {
    const imageH = Math.max(30, ph - 88), status = webcamStatus(s);
    drawFrame(ctx, pw, imageH, s.frame, status);
    if (status === "Loading") {
      const x = pw / 2, y = imageH / 2 - 24, angle = performance.now() / 180;
      ctx.beginPath(); ctx.strokeStyle = "#35e0b4"; ctx.lineWidth = 2;
      ctx.arc(x, y, 9, angle, angle + Math.PI * 1.5); ctx.stroke();
    }
    ctx.fillStyle = "#07090d"; ctx.fillRect(0, imageH, pw, ph - imageH);
    ctx.fillStyle = s.err ? "#ff5a6e" : "#b9c6e4";
    ctx.font = "10px monospace"; ctx.textAlign = "left"; ctx.textBaseline = "top";
    // Keep the operation and full diagnostics visible below the picture at normal node size.
    const chars = Math.max(8, Math.floor((pw - 12) / 6));
    const lines = [s.status, s.debug].flatMap(text => text.match(new RegExp(`.{1,${chars}}`, "g")) ?? []);
    lines.slice(0, 7).forEach((line, i) => ctx.fillText(line, 6, imageH + 4 + i * 12));
  }, () => [
    ["status", webcamStatus(s), s.err ? "#ff5a6e" : undefined], ["operation", s.status], ["debug", s.debug], ["error", s.err || "none"],
    ["resolution", s.frame ? `${s.frame.width}×${s.frame.height}` : "—"], ["frames", String(s.frames)], ["frame t", s.frame ? `${Math.round(s.frame.t)} ms` : "—"]]),
};

interface SynthState { frame: GrayFrame | null; last: number; seed: number; key: string; lum: Float32Array | null; inflight: boolean; epoch: number }
const synthetic: NodeSpec<SynthState> = {
  type: "source.synthetic", title: "Virtual camera (3D)", category: "Source",
  inputs: [{ id: "world", type: "world", label: "Virtual world" }], outputs: [{ id: "frame", type: "frame" }],
  params: [
    { id: "online", kind: "bool", label: "Online", value: true },
    { id: "cam", kind: "select", label: "Viewpoint", options: ["A", "B", "C"], value: "A" },
    { id: "noise", kind: "number", label: "Noise", min: 0, max: 40, step: 1, value: 8 },
    { id: "gain", kind: "number", label: "Exposure", min: 0.4, max: 1.6, step: 0.05, value: 1 },
    { id: "gradient", kind: "number", label: "Light falloff", min: 0, max: 0.6, step: 0.05, value: 0.15 },
    { id: "shadows", kind: "bool", label: "Shadows", value: true },
    { id: "fps", kind: "number", label: "FPS", min: 1, max: 20, step: 1, value: 8 },
  ],
  previewSize: [160, 120],
  init: () => ({ frame: null, last: 0, seed: 1, key: "", lum: null, inflight: false, epoch: 0 }),
  process(inputs, { params, state, now, setFidelity, span }) {
    const table = inputs?.world as VirtualTable | undefined; // the camera looks at a Virtual World; unwired, it sees nothing
    if (!params.online || !table) { state.frame = null; state.epoch++; setFidelity(null); return { frame: null }; }
    if (state.frame && now - state.last < 1000 / Number(params.fps)) { setFidelity(1); return { frame: state.frame }; } // reused frame is still a live one; without this the label vanishes between renders
    const pool = renderPool();
    if (pool.supported && state.inflight) { setFidelity(state.frame ? 1 : 0); return { frame: state.frame }; } // a render is still running on a worker: keep showing the last frame
    state.last = now;
    const opts = { width: FRAME_W, height: FRAME_H, rig: RIGS[String(params.cam)], noise: Number(params.noise), gain: Number(params.gain), gradient: Number(params.gradient), shadows: !!params.shadows, seed: ++state.seed, t: now };
    const key = `${params.cam}|${opts.shadows}|${table.sceneKey}`;
    if (pool.supported) { // ray-cast off the main thread; the result lands a few ms later and is picked up by a later tick
      state.inflight = true; const epoch = state.epoch;
      const scene = span("build 3D scene", () => table.scene3d());
      void span("dispatch render to worker", () => pool.request({ cam: String(params.cam), key, scene, opts })).then((f) => { if (epoch === state.epoch) state.frame = f; state.inflight = false; });
      setFidelity(state.frame ? 1 : 0);
      return { frame: state.frame };
    }
    if (key !== state.key || !state.lum) { state.key = key; state.lum = span("ray-cast luminance", () => renderLuminance(table.scene3d(), opts)); } // ray-cast only when something moved
    const lum = state.lum;
    state.frame = span("apply sensor noise", () => applySensor(lum, opts));
    setFidelity(1);
    return { frame: state.frame };
  },
  hover: (p, w, h, s) => frameHover(p, w, h, [160, 120], s.frame, "Virtual Camera", [{ label: "Render", value: s.inflight ? "in flight (worker)" : "idle" }, { label: "Frames", value: String(s.seed) }]),
  preview: (ctx, w, h, s) => withDetail(ctx, w, h, [160, 120], (pw, ph) => drawFrame(ctx, pw, ph, s.frame), () => [
    ["status", s.frame ? "rendering" : "offline"], ["resolution", s.frame ? `${s.frame.width}×${s.frame.height}` : "—"], ["frame t", s.frame ? `${Math.round(s.frame.t)} ms` : "—"],
    ["scene key", s.key || "—"], ["render", s.inflight ? "in flight (worker)" : "idle"], ["frames", String(s.seed)]]),
};

export const sourcesPlugin: Plugin = { id: "sources", name: "Sources", register: (r) => { r.register(webcam); r.register(synthetic); } };
