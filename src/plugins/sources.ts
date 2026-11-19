import type { NodeSpec, Plugin } from "../core/types";
import type { VirtualTable } from "../sim/virtualTable";
import { applySensor, renderLuminance } from "../sim/render3d";
import { renderPool } from "../sim/renderPool";
import { FRAME_H, FRAME_W, RIGS } from "../sim/rigs";
import type { GrayFrame } from "../vision/types";
import { drawFrame, withDetail } from "./shared";
import { frameHover } from "./hover";
import { openStream } from "../setup/devices";

interface WebcamState { video: HTMLVideoElement | null; canvas: HTMLCanvasElement | null; stream: MediaStream | null; starting: boolean; last: number; frame: GrayFrame | null; err: string; frozenUntil: number }

const webcam: NodeSpec<WebcamState> = {
  type: "source.webcam", title: "Webcam", category: "Source",
  inputs: [], outputs: [{ id: "frame", type: "frame" }],
  params: [
    { id: "online", kind: "bool", label: "Online", value: true },
    { id: "device", kind: "text", label: "Device", value: "" },
    { id: "channel", kind: "select", label: "Channel", options: ["luma", "red", "green", "blue"], value: "luma" },
    { id: "fps", kind: "number", label: "FPS", min: 1, max: 30, step: 1, value: 12 },
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
  previewSize: [160, 120],
  init: () => ({ video: null, canvas: null, stream: null, starting: false, last: 0, frame: null, err: "", frozenUntil: 0 }),
  process(_i, { params, state, now, setFidelity, span }) {
    const stop = () => { state.stream?.getTracks().forEach((t) => t.stop()); state.stream = null; state.video = null; state.frame = null; };
    if (!params.online) { if (state.stream) stop(); setFidelity(null); return { frame: null }; }
    if (!state.stream && !state.starting && navigator.mediaDevices) {
      state.starting = true;
      void (async () => {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const want = String(params.device);
          const dev = want ? devices.find((d) => d.kind === "videoinput" && (d.deviceId === want || d.label.toLowerCase().includes(want.toLowerCase()))) : undefined;
          const stream = await openStream({ video: { ...(dev ? { deviceId: { exact: dev.deviceId } } : {}), width: 640, height: 480 } });
          const v = document.createElement("video"); v.srcObject = stream; v.muted = true; await v.play();
          state.stream = stream; state.video = v; state.canvas = document.createElement("canvas"); state.canvas.width = 480; state.canvas.height = 360; state.err = "";
          stream.getVideoTracks()[0].onended = () => stop(); // unplugged -> camera simply goes offline
        } catch (e) { state.err = String(e); }
        state.starting = false;
      })();
    }
    if (state.video && now - state.last >= 1000 / Number(params.fps)) {
      state.last = now;
      if (now < state.frozenUntil) { /* frozen: the camera keeps the last picture */ }
      else if (params.freeze && Math.random() * 100 < Number(params.freezePct)) { state.frozenUntil = now + Number(params.freezeMs); }
      else if (params.drop && Math.random() * 100 < Number(params.dropPct)) { /* dropped: this frame never arrives, the last one stays */ }
      else {
        const ctx = state.canvas!.getContext("2d", { willReadFrequently: true })!;
        const px = span("grab frame (read pixels)", () => { ctx.drawImage(state.video!, 0, 0, 480, 360); return ctx.getImageData(0, 0, 480, 360).data; });
        const g = new Uint8ClampedArray(480 * 360);
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
        state.frame = { width: 480, height: 360, data: g, t: now };
      }
    }
    setFidelity(state.frame ? 1 : 0);
    return { frame: state.frame };
  },
  dispose(s) { s.stream?.getTracks().forEach((t) => t.stop()); },
  hover: (p, w, h, s) => frameHover(p, w, h, [160, 120], s.frame, "Webcam", [{ label: "Status", value: s.err ? "error" : s.frame ? "live" : "offline", tone: s.err ? "bad" : s.frame ? "ok" : "warn" }, ...(s.err ? [{ label: "Error", value: s.err, tone: "bad" as const }] : [])]),
  preview: (ctx, w, h, s) => withDetail(ctx, w, h, [160, 120], (pw, ph) => drawFrame(ctx, pw, ph, s.frame, s.err ? "no camera" : "offline"), () => [
    ["status", s.err ? "error" : s.frame ? "live" : "offline", s.err ? "#ff5a6e" : undefined], ["error", s.err || "none"],
    ["resolution", s.frame ? `${s.frame.width}×${s.frame.height}` : "—"], ["frame t", s.frame ? `${Math.round(s.frame.t)} ms` : "—"]]),
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
