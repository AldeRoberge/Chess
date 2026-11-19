import { SceneRenderer } from "../scene/renderer";
import { applySensor, renderLuminance } from "../sim/render3d";
import { FRAME_H, FRAME_W, RIGS } from "../sim/rigs";
import { virtualTable } from "../sim/virtualTable";
import { camHealth, setAutoField, type AutoField, type CameraSetup, type SetupConfig } from "../setup/config";
import { CHANNEL_NAME, boardSeparation, detectChannel, estimateFov, trustFor } from "../setup/autodetect";
import { detectBoardCorners } from "../setup/corners";
import type { CameraDevice } from "../setup/devices";
import { evaluateEnv, runCheckAction, type Env } from "../setup/system";
import { BUILD, buildBadge, ciBadge, latestCi, type CiRun } from "../setup/buildInfo";
import { fmtCorners, parseCorners } from "../plugins/shared";
import { CornerPicker } from "./cornerPicker";
import { activate, adjust, isFocusable, valueText, type AutoAction, type Item } from "./menu";
import { GamepadPoller, keyToAction, type NavAction } from "./nav";
import type { VoiceSettings } from "../narrator/voice";
import type { Sfx } from "./sfx";
import { icon } from "./icons";
import { KNIGHT_SVG } from "./brandIcon";
import { resizableColumns } from "./colResize";
import { STEPS, sceneStateFor, type StepCtx, type WizardState } from "./wizardSteps";

export interface WizardDeps {
  listCameras(): Promise<CameraDevice[]>;
  openCamera(deviceId: string): Promise<MediaStream>;
  detectEnv(): Promise<Env>;
  sfx: Pick<Sfx, "play">;
  speak(text: string, voice: "A" | "B", volume: number): void;
  thunder(): void;
  onFinish(cfg: SetupConfig): void;
  onCancel?(): void;
  /** False hides the close button (first run has nothing to close back to). */
  canCancel?(): boolean;
  /** Fired when the visible step changes (drives the URL). */
  onStep?(id: string): void;
  /** Called after every change so an unfinished setup can be resumed after a reload. */
  onProgress?(cfg: SetupConfig, step: number): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };

/**
 * First-run (and re-runnable) setup, styled after a console-era shooter's options menu:
 * chamfered steel panels, a step list on the left, the focused step's items on the right,
 * keyboard / gamepad / mouse driven, with synthesised blips.
 */
export class SetupWizard {
  root = el("div", "halo");
  step = 0;
  zone: "steps" | "pane" = "steps";
  focus = 0;
  state: WizardState;
  private stepsEl = el("ul", "halo-steps");
  private pane = el("section", "halo-pane");
  private title = el("h2");
  private blurb = el("p", "halo-blurb");
  private list = el("ul", "halo-items");
  private extra = el("div", "halo-extra");
  private hint = el("div", "halo-hint");
  private nav = el("div", "halo-navrow");
  private reported = "";
  private progress = el("div", "halo-progress");
  private pad = new GamepadPoller();
  private canvas = el("canvas", "halo-canvas");
  private picker: CornerPicker | null = null;
  /** Bumped when a corner detection is superseded, so a late reply cannot overwrite a newer one. */
  private cornerJob = 0;
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private streamFor = "";
  private virtualLum: Float32Array | null = null;
  private virtualKey = "";
  private scr = new SceneRenderer();
  private lastFrame = 0;
  private onKey = (e: KeyboardEvent) => this.key(e);
  /** One live thumbnail per camera on the cameras step, keyed by camera id. */
  private camPreviews = new Map<string, CamPreview>();
  private openCams = new Set<string>();
  /** When the board picture was last read (ms, from the frame clock): readings are taken a few times a second, not every frame. */
  private measuredAt = -Infinity;

  constructor(public cfg: SetupConfig, private deps: WizardDeps, startStep = 0) {
    this.step = Math.max(0, Math.min(STEPS.length - 1, Math.floor(startStep) || 0));
    this.state = { checks: null, detected: [], scanning: false, boardCam: 0, scenePreview: sceneStateFor(cfg), tests: {}, groups: {}, frame: null, board: {}, autoMsg: "" };
    this.canvas.width = FRAME_W; this.canvas.height = FRAME_H;
    const brand = el("div", "halo-brand"); brand.innerHTML = `<span class="halo-brand-ic">${KNIGHT_SVG}</span>`; brand.append(el("span", "halo-logo", "Chess XP"));
    this.buildRow = el("div", "halo-build"); this.buildRow.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;justify-content:center";
    const head = el("header"); head.append(brand, this.buildRow, this.progress);
    if (deps.canCancel?.() !== false) { // first run can't be skipped, so there is nothing to close back to
      const x = el("button", "halo-close"); x.innerHTML = icon("x", 14); x.type = "button"; x.title = "Close settings (Esc)"; x.setAttribute("aria-label", "Close settings");
      x.onclick = () => this.cancel(); head.append(x);
    }
    const foot = el("footer", "halo-keys"); foot.innerHTML = "<span><kbd>↑</kbd><kbd>↓</kbd> Select</span><span><kbd>←</kbd><kbd>→</kbd> Adjust</span><span><kbd>Enter</kbd> / <kbd>A</kbd> Confirm</span><span><kbd>Esc</kbd> / <kbd>B</kbd> Back</span>";
    this.pane.append(this.title, this.blurb, this.extra, this.list, this.hint, this.nav); // previews first: they are what you drag
    const body = el("div", "halo-body"); body.append(this.stepsEl, this.splitter(), this.pane);
    this.root.append(el("div", "halo-bg"), head, body, foot);
    this.canvas.addEventListener("pointerdown", (e) => this.pointer("down", e));
    this.canvas.addEventListener("pointermove", (e) => this.pointer("move", e));
    this.canvas.addEventListener("pointerup", () => this.pointer("up"));
    this.enterStep();
    this.render();
  }

  mount(parent: HTMLElement) { document.getElementById("app")?.setAttribute("inert", ""); parent.append(this.root); window.addEventListener("keydown", this.onKey); }

  /** Vertical bar between the step list and the pane; dragging it sets the list's width (--steps-w). */
  private splitter() {
    const s = el("div", "halo-split"); s.setAttribute("role", "separator"); s.setAttribute("aria-orientation", "vertical"); s.setAttribute("aria-label", "Resize step list"); s.title = "Drag to resize";
    s.addEventListener("pointerdown", (e) => {
      const body = s.parentElement!, r = body.getBoundingClientRect(), pl = parseFloat(getComputedStyle(body).paddingLeft) || 0;
      s.setPointerCapture(e.pointerId); e.preventDefault();
      const move = (ev: PointerEvent) => { const w = Math.round(Math.min(480, Math.max(180, ev.clientX - r.left - pl))); body.style.setProperty("--steps-w", `${w}px`); };
      const up = () => { s.removeEventListener("pointermove", move); s.removeEventListener("pointerup", up); s.removeEventListener("pointercancel", up); };
      s.addEventListener("pointermove", move); s.addEventListener("pointerup", up); s.addEventListener("pointercancel", up);
    });
    return s;
  }
  get stepId() { return STEPS[this.step].id; }
  /** Jump to a step by id (from the URL); ignored when unknown. Does not notify `onStep`. */
  setStep(id: string) {
    const i = STEPS.findIndex((s) => s.id === id);
    if (i < 0 || i === this.step) return;
    this.step = i; this.focus = 0; this.zone = "steps"; this.enterStep(); this.render();
  }
  destroy() { document.getElementById("app")?.removeAttribute("inert"); window.removeEventListener("keydown", this.onKey); this.stopStream(); this.stopCamPreviews(); this.root.remove(); }

  // ---- context handed to the step definitions
  private ctx(): StepCtx {
    return {
      cfg: this.cfg, state: this.state,
      refresh: () => { this.enterStep(true); this.render(); },
      scan: () => void this.scan(),
      runChecks: () => void this.runChecks(),
      speak: (t, v) => this.deps.speak(t, v, this.cfg.narrator.volume),
      open: (url) => { window.open(url, "_blank", "noopener,noreferrer"); },
      test: (id, job) => {
        this.state.tests[id] = { tone: "warn", text: "Testing…" }; this.renderList();
        void job().then((r) => { this.state.tests[id] = r; }).catch(() => { this.state.tests[id] = { tone: "fail", text: "The test failed unexpectedly." }; }).finally(() => { if (this.root.isConnected) this.renderList(); });
      },
      voiceSettings: (): VoiceSettings => ({ provider: "elevenlabs", lang: "fr", volume: this.cfg.narrator.volume, browserA: "", browserB: "", apiKey: this.cfg.voice.apiKey, voiceIdA: this.cfg.voice.voiceIdA, voiceIdB: this.cfg.voice.voiceIdB, model: "" }),
      thunder: () => this.deps.thunder(),
      finish: () => { this.deps.sfx.play("launch"); this.deps.onFinish({ ...this.cfg, completed: true }); },
      go: (n) => { this.step = n; this.focus = 0; this.zone = "pane"; this.enterStep(); this.render(); },
      syncScenePreview: () => { this.state.scenePreview = sceneStateFor(this.cfg); },
      detect: (f) => this.detect(f),
    };
  }

  /** Nesting depth of each listed item (0 = top level). Open groups are flattened into the list, so focus and keys walk them like any row. */
  private depth = new WeakMap<Item, number>();
  private items(): Item[] {
    const out: Item[] = [];
    const walk = (list: Item[], d: number) => {
      for (const it of list) {
        out.push(it); this.depth.set(it, d);
        if (it.kind === "group" && it.get()) walk(it.children, d + 1);
      }
    };
    walk(STEPS[this.step].items(this.ctx()), 0);
    return out;
  }
  private focusables() { return this.items().map((it, i) => ({ it, i })).filter((x) => isFocusable(x.it)); }

  private async scan() {
    this.state.scanning = true; this.render();
    try { this.state.detected = await this.deps.listCameras(); } finally { this.state.scanning = false; }
    this.render();
  }
  private async runChecks() {
    this.state.checks = evaluateEnv(await this.deps.detectEnv()); this.render();
    this.ci = await latestCi(); // undefined until the first answer; null when GitHub can't be reached
    if (this.stepId === "briefing") this.render();
  }

  // ---- input
  private key(e: KeyboardEvent) {
    if ((e.target as HTMLElement | null)?.tagName === "INPUT") { if (e.key === "Escape" || e.key === "Enter") (e.target as HTMLElement).blur(); return; }
    if (e.key === "Delete" && this.zone === "pane") { const it = this.focusables()[this.focus]?.it; if (it?.kind === "toggle" && it.remove) { e.preventDefault(); this.removeItem(it.remove.run); return; } }
    // the camera tabs and the auto-detect buttons are real buttons: arrows pick a tab, Enter / Space press the focused button
    const onTab = (e.target as HTMLElement | null)?.closest?.(".cam-tabs");
    if (onTab && (e.key === "ArrowLeft" || e.key === "ArrowRight")) { e.preventDefault(); const n = this.cfg.cameras.length; this.selectCamera((this.state.boardCam + (e.key === "ArrowRight" ? 1 : -1) + n) % n); return; }
    if (((e.target as HTMLElement | null)?.closest?.(".cam-tab, .halo-auto")) && (e.key === "Enter" || e.key === " ")) return;
    const a = keyToAction(e.key);
    if (a) { e.preventDefault(); this.handle(a); }
  }

  handle(a: NavAction) {
    const f = this.focusables();
    if (a === "next" || a === "prev") { this.stepTo(this.step + (a === "next" ? 1 : -1)); return; }
    if (this.zone === "steps") {
      if (a === "up" || a === "down") this.stepTo(this.step + (a === "down" ? 1 : -1));
      else if (a === "select" || a === "right") { if (f.length) { this.zone = "pane"; this.focus = 0; this.deps.sfx.play("ok"); this.render(); } else this.deps.sfx.play("deny"); }
      else if (a === "back") this.cancel();
      return;
    }
    if (a === "up" || a === "down") {
      this.focus = (this.focus + (a === "down" ? 1 : -1) + f.length) % f.length;
      this.deps.sfx.play("tick"); this.render();
    } else if (a === "left" || a === "right") {
      const r = adjust(f[this.focus].it, a === "right" ? 1 : -1);
      if (r === "changed") { this.deps.sfx.play("tick"); this.afterChange(); } else if (f[this.focus].it.kind === "action") this.leavePane(); else this.deps.sfx.play("deny");
    } else if (a === "select") {
      const r = activate(f[this.focus].it); // a pane is only entered when it has focusable items
      if (r === "edit") this.editText(); else if (r === "none") this.deps.sfx.play("deny"); else { this.deps.sfx.play("ok"); this.afterChange(); }
    } else this.leavePane(); // the only action left is "back"
  }

  private removeItem(run: () => void) { run(); this.deps.sfx.play("back"); this.afterChange(); }

  private stepTo(n: number) {
    const to = Math.min(STEPS.length - 1, Math.max(0, n));
    if (to === this.step) { this.deps.sfx.play("deny"); return; }
    this.step = to; this.focus = 0; this.zone = "steps";
    this.deps.sfx.play("tick"); this.enterStep(); this.render();
  }
  private leavePane() { this.zone = "steps"; this.deps.sfx.play("back"); this.render(); }
  private cancel() { this.deps.sfx.play("back"); this.deps.onCancel?.(); }
  private afterChange() {
    const n = this.focusables().length;
    this.focus = Math.min(this.focus, Math.max(0, n - 1));
    this.picker = null; this.render();
  }

  private editText() {
    const input = this.list.querySelector<HTMLInputElement>("li.sel input");
    input?.focus();
  }

  // ---- previews
  private enterStep(keepStream = false) {
    if (!keepStream) this.stopStream();
    this.picker = null;
    this.state.scenePreview = sceneStateFor(this.cfg);
    this.extra.replaceChildren(); // render() fills it: the camera tabs and the picture on the board step
    if (!keepStream) this.state.autoMsg = "";
    const id = STEPS[this.step].id;
    if (id !== "cameras") this.stopCamPreviews(); // webcams are only held open while the table is on screen
    else if (!keepStream) this.stopCamPreviews();
    if (id === "briefing" && !this.state.checks) void this.runChecks();
    if (id === "board" && this.cfg.cameras.length) {
      this.state.boardCam = Math.min(this.state.boardCam, this.cfg.cameras.length - 1);
      this.measuredAt = -Infinity;
      this.ensureVideo();
    }
    if (id === "scenes") { this.canvas.width = 640; this.canvas.height = 360; this.extra.append(this.canvas); }
    else { this.canvas.width = FRAME_W; this.canvas.height = FRAME_H; }
  }

  private ensureVideo() {
    const cam = this.cfg.cameras[this.state.boardCam];
    if (!cam || cam.kind !== "webcam") { this.stopStream(); return; }
    if (this.streamFor === cam.deviceId && this.stream) return;
    this.stopStream();
    this.streamFor = cam.deviceId;
    void this.deps.openCamera(cam.deviceId).then((s) => {
      if (this.streamFor !== cam.deviceId) { s.getTracks().forEach((t) => t.stop()); return; }
      this.stream = s;
      this.video = document.createElement("video"); this.video.muted = true; this.video.srcObject = s; void this.video.play();
    }).catch(() => { this.stream = null; });
  }
  private stopStream() { this.stream?.getTracks().forEach((t) => t.stop()); this.stream = null; this.video = null; this.streamFor = ""; }

  private pointer(kind: "down" | "move" | "up", e?: PointerEvent) {
    if (!this.picker) return;
    if (kind === "up") { this.picker.up(); return; }
    const r = this.canvas.getBoundingClientRect();
    const x = ((e!.clientX - r.left) / (r.width || 1)) * this.canvas.width, y = ((e!.clientY - r.top) / (r.height || 1)) * this.canvas.height;
    if (kind === "down") this.picker.down(x, y);
    else if (this.picker.active >= 0) {
      this.picker.move(x, y);
      const cam = this.cfg.cameras[this.state.boardCam];
      cam.corners = fmtCorners(this.picker.corners);
      setAutoField(cam, "corners", false);
      this.renderList();
    }
  }

  /** Animated previews + gamepad polling; call from the app's rAF loop. */
  frame(now: number) {
    for (const a of this.pad.poll(now)) this.handle(a);
    const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0.016; this.lastFrame = now;
    const id = STEPS[this.step].id, ctx = this.canvas.getContext("2d")!;
    if (id === "scenes") this.scr.draw(ctx, this.canvas.width, this.canvas.height, this.state.scenePreview, now, dt);
    else if (id === "board" && this.cfg.cameras.length) this.drawBoardPreview(ctx, now);
    else if (id === "cameras") this.drawCamPreviews(now);
  }

  private drawBoardPreview(ctx: CanvasRenderingContext2D, now: number) {
    const cam = this.cfg.cameras[this.state.boardCam];
    const live = cam.kind === "virtual" || (!!this.video && this.video.readyState >= 2);
    if (cam.kind === "virtual") {
      const key = `${cam.rig}|${virtualTable.sceneKey}`;
      if (key !== this.virtualKey) { this.virtualKey = key; this.virtualLum = renderLuminance(virtualTable.scene3d(), { width: FRAME_W, height: FRAME_H, rig: RIGS[cam.rig] }); }
      const f = applySensor(this.virtualLum!, { width: FRAME_W, height: FRAME_H, rig: RIGS[cam.rig], noise: 3 });
      const img = ctx.createImageData(FRAME_W, FRAME_H);
      for (let i = 0; i < f.data.length; i++) { img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = f.data[i]; img.data[i * 4 + 3] = 255; }
      ctx.putImageData(img, 0, 0);
    } else if (this.video) ctx.drawImage(this.video, 0, 0, FRAME_W, FRAME_H);
    else { ctx.fillStyle = "#04101c"; ctx.fillRect(0, 0, FRAME_W, FRAME_H); ctx.fillStyle = "#6fb8ff"; ctx.fillText("No signal", 20, 30); }
    // read the bare picture before the overlay goes on: auto detect and the tab's status measure it
    if (now - this.measuredAt >= 400) { this.measuredAt = now; this.measure(cam, ctx, live); }
    const pts = parseCorners(cam.corners);
    if (!pts) return;
    if (!this.picker || this.picker.active < 0) this.picker = new CornerPicker(pts, FRAME_W, FRAME_H);
    const c = this.picker.corners;
    ctx.strokeStyle = "#7dffb0"; ctx.lineWidth = 2; ctx.beginPath(); c.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.stroke();
    ctx.fillStyle = "#7dffb0"; c.forEach((p, i) => { ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, 7); ctx.fill(); ctx.fillStyle = "#fff"; ctx.strokeStyle = "#001"; ctx.lineWidth = 3; const lab = ["a8", "h8", "h1", "a1"][i]; ctx.strokeText(lab, p.x + 9, p.y - 9); ctx.fillText(lab, p.x + 9, p.y - 9); ctx.strokeStyle = "#7dffb0"; ctx.lineWidth = 2; ctx.fillStyle = "#7dffb0"; });
  }

  // ---- rendering
  private render() {
    this.paintBuild();
    // Built once: recreating the items on every edit would replay their entry animation.
    if (this.stepsEl.children.length !== STEPS.length) {
      this.stepsEl.replaceChildren();
      STEPS.forEach((s, i) => {
        const li = el("li", "halo-step");
        const ic = el("span", "halo-step-ic"); ic.innerHTML = icon(STEP_ICON[s.id] ?? "setup", 22);
        li.append(ic, el("span", "halo-step-name", s.title));
        li.onclick = () => { this.step = i; this.focus = 0; this.zone = "steps"; this.deps.sfx.play("tick"); this.enterStep(); this.render(); };
        this.stepsEl.append(li);
      });
    }
    Array.from(this.stepsEl.children).forEach((li, i) => {
      li.classList.toggle("cur", i === this.step);
      if (i === this.step) (li as HTMLElement).scrollIntoView?.({ block: "nearest", inline: "nearest" }); // keeps the current step in view in the phone strip
      li.classList.toggle("sel", i === this.step && this.zone === "steps");
    });
    this.progress.replaceChildren(...STEPS.map((_, i) => el("i", i < this.step ? "done" : i === this.step ? "cur" : "")), el("span", "", `Step ${this.step + 1} of ${STEPS.length}`));
    this.title.textContent = STEPS[this.step].title;
    this.blurb.textContent = STEPS[this.step].blurb;
    this.renderNav();
    this.renderList();
    if (this.stepId === "briefing") this.renderSystem();
    if (this.stepId === "cameras") this.renderCameras();
    if (this.stepId === "board") this.renderBoard();
    if (this.reported !== this.stepId) { this.reported = this.stepId; this.deps.onStep?.(this.reported); }
    this.deps.onProgress?.(this.cfg, this.step);
  }

  // ---- board: one tab per camera with its status, the board picture under them, and the readings behind the status
  /** Reads the board picture's squares (before the overlay) so the camera's tab and auto detect can use them. */
  private measure(cam: CameraSetup, ctx: CanvasRenderingContext2D, live: boolean) {
    if (!live) { this.state.frame = null; this.state.board[cam.id] = { signal: false }; return; }
    const img = ctx.getImageData(0, 0, FRAME_W, FRAME_H), pts = parseCorners(cam.corners);
    this.state.frame = img;
    this.state.board[cam.id] = { signal: true, separation: pts ? boardSeparation(img, pts, cam.channel) : undefined };
  }

  private selectCamera(i: number) {
    if (i === this.state.boardCam || !this.cfg.cameras[i]) return;
    this.state.boardCam = i; this.picker = null; this.state.frame = null; this.measuredAt = -Infinity; this.state.autoMsg = ""; this.cornerJob++;
    this.deps.sfx.play("tick"); this.ensureVideo(); this.render();
  }

  private renderBoard() {
    const cams = this.cfg.cameras;
    if (!cams.length) { this.extra.replaceChildren(); return; }
    const tabs = el("div", "cam-tabs"); tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", "Cameras");
    cams.forEach((cam, i) => {
      const sel = i === this.state.boardCam, h = camHealth(cam, this.state.board[cam.id]);
      const b = el("button", `cam-tab ${h.tone}${sel ? " sel" : ""}`); b.type = "button";
      b.setAttribute("role", "tab"); b.setAttribute("aria-selected", String(sel)); b.tabIndex = sel ? 0 : -1;
      b.setAttribute("aria-label", `${cam.id} · ${cam.label}: ${h.text}`);
      const flags = el("span", "cam-flags");
      flags.append(
        this.camFlag("setup", "Configured", h.configured, "A device is chosen and the board corners are marked."),
        this.camFlag("wand", "Placement auto-detected", h.auto, "The field of view was measured from the board corners."),
        this.camFlag("check", "Ready", h.ready, "Online, configured and performing well."),
        this.camFlag("warn", "Performing badly", h.bad, "No signal, or the board squares barely stand out in this camera's picture.", true),
      );
      const name = el("span", "cam-tab-name"); name.innerHTML = `<span class="sys-ico">${icon(cam.kind === "virtual" ? "world" : "camera", 15)}</span>`; name.append(`${cam.id} · ${cam.label}`);
      b.append(name, flags, el("span", "cam-tab-status", h.text));
      b.onclick = () => this.selectCamera(i);
      tabs.append(b);
    });
    this.extra.replaceChildren(tabs, this.canvas);
  }

  private camFlag(name: string, label: string, on: boolean, body: string, bad = false): HTMLElement {
    const f = el("span", `cam-flag${on ? " on" : ""}${bad && on ? " bad" : ""}`);
    f.innerHTML = icon(name, 13);
    f.setAttribute("aria-label", `${label}: ${on ? "yes" : "no"}`);
    f.dataset.tip = label; f.dataset.tipBody = body;
    return f;
  }

  /** Fills one field of the board camera. Corners come from the picture (shape, printed coordinates, AI); the rest are measured as before. */
  private detect(field: AutoField) {
    if (field === "corners") { this.detectCorners(); return; }
    const cam = this.cfg.cameras[this.state.boardCam], img = this.state.frame, pts = parseCorners(cam.corners);
    let msg: string, ok = true;
    if (field === "fov") {
      const fov = pts ? estimateFov(pts, FRAME_W, FRAME_H) : null;
      if (fov === null) { ok = false; msg = "Field of view not detected: the board corners don't show two pairs of converging edges. Drag the corners onto the board first."; }
      else { cam.fov = fov; setAutoField(cam, "fov", true); msg = `Field of view set to ${fov}° from the board's edges.`; }
    } else if (!pts) { ok = false; msg = "Mark the board corners first: the picture is measured inside them."; }
    else if (!img) { ok = false; msg = "No live picture to measure: check that this camera is online and has a signal."; }
    else if (field === "channel") {
      const r = detectChannel(img, pts);
      cam.channel = r.channel; setAutoField(cam, "channel", true);
      msg = `Channel set to ${CHANNEL_NAME[r.channel]}: the board stands out most there.`;
    } else {
      cam.trust = trustFor(boardSeparation(img, pts, cam.channel)); setAutoField(cam, "trust", true);
      msg = `Trust set to ${cam.trust.toFixed(1)} from how clearly the board squares show in ${CHANNEL_NAME[cam.channel]}.`;
    }
    this.state.autoMsg = msg; this.deps.sfx.play(ok ? "ok" : "deny"); this.render();
  }

  /** Places a8, h8, h1 and a1 from the checkerboard, from printed coordinates, and from AI when a key is set. */
  private detectCorners() {
    const cam = this.cfg.cameras[this.state.boardCam], img = this.state.frame;
    if (!img) { this.state.autoMsg = "No live picture to measure: check that this camera is online and has a signal."; this.deps.sfx.play("deny"); this.render(); return; }
    const key = this.cfg.ai.apiKey.trim(), job = ++this.cornerJob;
    this.state.autoMsg = key ? "Detecting corners from the checkerboard, printed coordinates, and AI…" : "Detecting corners from the checkerboard and printed coordinates…";
    this.deps.sfx.play("tick"); this.renderList();
    void detectBoardCorners(img, { apiKey: key, model: this.cfg.ai.model }).then((r) => {
      if (job !== this.cornerJob || !this.root.isConnected || this.cfg.cameras[this.state.boardCam] !== cam) return;
      if (!r.corners) { this.state.autoMsg = r.detail; this.deps.sfx.play("deny"); }
      else { cam.corners = fmtCorners(r.corners); setAutoField(cam, "corners", true); this.picker = null; this.state.autoMsg = r.detail; this.deps.sfx.play("ok"); }
      this.render();
    });
  }

  private autoButton(a: AutoAction): HTMLButtonElement {
    const b = el("button", "halo-auto"); b.type = "button"; b.disabled = !!a.disabled;
    b.innerHTML = `${icon("wand", 14)}<span>${a.label}</span>`;
    if (a.disabled && a.hint) { b.dataset.tip = "Unavailable"; b.dataset.tipBody = a.hint; }
    else { b.dataset.tip = a.label; b.dataset.tipBody = a.about ?? "Fills this value from the camera's picture or its board corners."; }
    b.onclick = (ev) => { ev.stopPropagation(); if (!a.disabled) a.run(); };
    return b;
  }

  // ---- cameras as a table: live preview, name, status, access, online switch, remove, details
  private previewFor(cam: CameraSetup): CamPreview {
    const key = cam.kind === "webcam" ? cam.deviceId : `rig:${cam.rig}`;
    let p = this.camPreviews.get(cam.id);
    if (p && p.key !== key) { this.dropPreview(cam.id); p = undefined; } // the device or rig behind this id changed
    if (!p) {
      const canvas = el("canvas", "halo-cam-thumb"); canvas.width = FRAME_W; canvas.height = FRAME_H;
      p = { key, canvas, stream: null, video: null, pending: false, error: "", drawn: 0, lumKey: "", lum: null };
      this.camPreviews.set(cam.id, p);
    }
    return p;
  }

  private openPreview(cam: CameraSetup, p: CamPreview) {
    p.pending = true;
    this.deps.openCamera(cam.deviceId).then((s) => {
      p.pending = false;
      if (this.camPreviews.get(cam.id) !== p) { s.getTracks().forEach((t) => t.stop()); return; } // camera was removed meanwhile
      p.stream = s; p.video = document.createElement("video"); p.video.muted = true; p.video.srcObject = s; void p.video.play();
      if (this.stepId === "cameras") this.render();
    }).catch(() => {
      p.pending = false; p.error = "No access";
      if (this.camPreviews.get(cam.id) === p && this.stepId === "cameras") this.render();
    });
  }

  private stopPreview(p: CamPreview) { p.stream?.getTracks().forEach((t) => t.stop()); p.stream = null; p.video = null; }
  private dropPreview(id: string) { const p = this.camPreviews.get(id); if (p) this.stopPreview(p); this.camPreviews.delete(id); this.openCams.delete(id); }
  private stopCamPreviews() { for (const id of [...this.camPreviews.keys()]) this.dropPreview(id); }

  private camStatus(cam: CameraSetup, p: CamPreview): { text: string; tone: "ok" | "warn" | "fail"; action?: string } {
    if (!cam.online) return { text: "Offline: ignored by the tracker", tone: "warn" };
    if (cam.kind === "virtual") return { text: "Simulated 3D camera · live", tone: "ok" };
    if (p.stream) return { text: "Live", tone: "ok" };
    if (p.error) return { text: "No access: blocked or no signal", tone: "fail", action: "Retry" };
    return { text: "Connecting…", tone: "warn" };
  }

  private camFacts(cam: CameraSetup, p: CamPreview): [string, string][] {
    const access = cam.kind === "virtual" ? "Not needed" : p.stream ? "Granted" : p.error ? "Blocked or no signal: allow the camera in the address bar, then Retry" : p.pending ? "Asking…" : "Not granted yet";
    return [
      ["Type", cam.kind === "virtual" ? "Virtual 3D camera (simulated room)" : "Physical webcam"],
      cam.kind === "virtual" ? ["Viewpoint", `Rig ${cam.rig}`] : ["Device", cam.label || cam.deviceId],
      ["Access", access],
      ["Channel", cam.channel === "luma" ? "Gray (luma)" : cam.channel],
      ["Trust", cam.trust.toFixed(1)],
      ["Field of view", `${cam.fov}°`],
      ["Board corners", parseCorners(cam.corners) ? "Marked" : "Not marked: set them on the Board step"],
      ["Secure context", window.isSecureContext ? "Yes" : "No (camera needs https or localhost)"],
    ];
  }

  private renderCameras() {
    const cams = this.cfg.cameras;
    for (const id of [...this.camPreviews.keys()]) if (!cams.some((c) => c.id === id)) this.dropPreview(id);
    if (!cams.length) { this.extra.replaceChildren(); return; } // the list below offers scan and add
    const online = cams.filter((c) => c.online).length;
    const bar = el("div", `sys-bar${online < cams.length ? " bad" : ""}`);
    bar.innerHTML = `<span class="sys-dot">${icon(online ? "check" : "warn", 14)}</span>`;
    bar.append(el("span", "sys-sum", `${online} of ${cams.length} online`));
    const t = el("table", "halo-sys halo-cams");
    const head = el("thead"), hr = el("tr");
    for (const h of ["", "Camera", "Preview", "Status", ""]) hr.append(el("th", "", h));
    head.append(hr); t.append(head);
    resizableColumns(t, "cameras");
    const body = el("tbody");
    for (const cam of cams) {
      const p = this.previewFor(cam);
      if (cam.kind === "webcam" && cam.online && !p.stream && !p.pending && !p.error) this.openPreview(cam, p);
      if (!cam.online && cam.kind === "webcam") this.stopPreview(p);
      const st = this.camStatus(cam, p), isOpen = this.openCams.has(cam.id);
      const tr = el("tr", `sys-row ${st.tone} has${isOpen ? " open" : ""}`);
      const bd = el("td", "sys-badge"); bd.innerHTML = `<span class="sys-dot">${icon(st.tone === "ok" ? "check" : st.tone === "warn" ? "warn" : "x", 14)}</span>`;
      const nm = el("td", "sys-name"); nm.innerHTML = `<span class="sys-ico">${icon(cam.kind === "virtual" ? "world" : "camera", 16)}</span>`; nm.append(`${cam.id} · ${cam.label}`);
      const pv = el("td", "halo-cam-cell"); pv.append(p.canvas);
      const sv = el("td", "sys-val", st.text);
      const tog = el("td", "sys-tog"), wrap = el("div", "sys-acts");

      const on = el("button", `sys-act${cam.online ? "" : " hot"}`); on.type = "button"; on.setAttribute("aria-pressed", String(cam.online));
      on.setAttribute("aria-label", `${cam.id}: ${cam.online ? "online" : "offline"}, switch`);
      on.innerHTML = `<span>${cam.online ? "Online" : "Offline"}</span>`; on.dataset.tip = "Online or offline"; on.dataset.tipBody = "An offline camera is ignored by the tracker until you switch it back on.";
      on.onclick = (e) => { e.stopPropagation(); cam.online = !cam.online; this.deps.sfx.play("tick"); this.render(); };
      wrap.append(on);
      if (st.action) {
        const ab = el("button", "sys-act hot"); ab.type = "button"; ab.innerHTML = `${icon("refresh", 14)}<span>${st.action}</span>`;
        ab.dataset.tip = st.action; ab.dataset.tipBody = "Asks the browser for this camera again. If it was blocked, unblock it from the address bar first.";
        ab.onclick = (e) => { e.stopPropagation(); p.error = ""; this.deps.sfx.play("tick"); this.render(); };
        wrap.append(ab);
      }
      const rm = el("button", "sys-btn"); rm.type = "button"; rm.setAttribute("aria-label", `Remove camera ${cam.id}`);
      rm.dataset.tip = "Remove camera"; rm.dataset.tipBody = "Takes this camera out of the settings."; rm.dataset.tipTag = "destructive"; rm.dataset.tipColor = "#ff7070"; rm.innerHTML = icon("trash", 16);
      rm.onclick = (e) => {
        e.stopPropagation(); const i = this.cfg.cameras.indexOf(cam);
        this.dropPreview(cam.id); if (i >= 0) this.cfg.cameras.splice(i, 1);
        this.state.boardCam = 0; this.deps.sfx.play("back"); this.render();
      };
      const chev = el("button", "sys-btn"); chev.type = "button"; chev.setAttribute("aria-expanded", String(isOpen));
      chev.setAttribute("aria-label", `${isOpen ? "Hide" : "Show"} details for ${cam.id}`); chev.dataset.tip = isOpen ? "Hide details" : "Show details"; chev.dataset.tipBody = `The facts behind ${cam.label}.`; chev.innerHTML = icon("chevron", 16);
      const flip = () => { if (this.openCams.has(cam.id)) this.openCams.delete(cam.id); else this.openCams.add(cam.id); this.deps.sfx.play("tick"); this.render(); };
      chev.onclick = (e) => { e.stopPropagation(); flip(); };
      tr.onclick = (e) => { if (!(e.target as HTMLElement).closest("button")) flip(); };
      wrap.append(rm, chev); tog.append(wrap);
      tr.append(bd, nm, pv, sv, tog); body.append(tr);
      if (isOpen) {
        const dr = el("tr", `sys-detail ${st.tone}`), td = el("td"); td.colSpan = 5;
        const dl = el("dl");
        for (const [k, v] of this.camFacts(cam, p)) dl.append(el("dt", "", k), el("dd", "", v));
        td.append(dl); dr.append(td); body.append(dr);
      }
    }
    t.append(body);
    this.extra.replaceChildren(bar, t);
  }

  /** Thumbnails: virtual cameras re-render the 3D room; webcams show their stream; both are throttled to ~8 fps. */
  private drawCamPreviews(now: number) {
    for (const cam of this.cfg.cameras) {
      const p = this.camPreviews.get(cam.id);
      if (!p || now - p.drawn < 120) continue;
      p.drawn = now;
      const ctx = p.canvas.getContext("2d")!, W = FRAME_W, H = FRAME_H;
      if (!cam.online) { ctx.fillStyle = "#0a0d12"; ctx.fillRect(0, 0, W, H); ctx.fillStyle = "#5c6675"; ctx.font = "28px sans-serif"; ctx.textAlign = "center"; ctx.fillText("OFFLINE", W / 2, H / 2 + 10); ctx.textAlign = "start"; continue; }
      if (cam.kind === "virtual") {
        const key = `${cam.rig}|${virtualTable.sceneKey}`;
        if (key !== p.lumKey) { p.lumKey = key; p.lum = renderLuminance(virtualTable.scene3d(), { width: W, height: H, rig: RIGS[cam.rig] }); }
        const f = applySensor(p.lum!, { width: W, height: H, rig: RIGS[cam.rig], noise: 3 });
        const img = ctx.createImageData(W, H);
        for (let i = 0; i < f.data.length; i++) { img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = f.data[i]; img.data[i * 4 + 3] = 255; }
        ctx.putImageData(img, 0, 0);
      } else if (p.video && p.video.readyState >= 2) ctx.drawImage(p.video, 0, 0, W, H);
      else { ctx.fillStyle = "#04101c"; ctx.fillRect(0, 0, W, H); ctx.fillStyle = "#6fb8ff"; ctx.font = "24px sans-serif"; ctx.fillText(p.error ? "No access" : "Connecting…", 20, 40); }
    }
  }

  private open = new Set<string>();
  /** All checks passed: the summary is collapsed until clicked. */
  private sysAllOpen = false;
  /** Some checks failed: the passed ones fold away under the failing rows until asked for. */
  private sysPassedOpen = false;
  /** Latest ci.yml run on main: undefined while asking, null when GitHub can't say. */
  private ci: CiRun | null | undefined;

  /** Build time and CI, in the header so they are not mixed into "all checks passed". */
  private buildRow!: HTMLElement;
  private paintBuild() {
    const row = this.buildRow; if (!row) return; row.replaceChildren();
    for (const v of [buildBadge(BUILD, this.ci), ciBadge(this.ci)]) {
      const chip = document.createElement(v.href ? "a" : "span");
      chip.className = `chip ${v.tone}`.trim(); chip.textContent = v.text;
      chip.dataset.tip = v.href ? "Latest CI run" : "Build"; chip.dataset.tipBody = v.tip;
      if (v.href) { const a = chip as HTMLAnchorElement; a.href = v.href; a.target = "_blank"; a.rel = "noopener noreferrer"; }
      row.append(chip);
    }
  }

  /** The system check as a table: one row per subsystem, each expanding to the facts behind it. */
  private renderSystem() {
    const checks = this.state.checks;
    if (!checks) { this.extra.replaceChildren(); return; }
    const t = el("table", "halo-sys");
    const head = el("thead"), hr = el("tr");
    for (const h of ["", "Component", "Status", ""]) hr.append(el("th", "", h));
    head.append(hr); t.append(head);
    resizableColumns(t, "system");
    const body = el("tbody");
    const bad = checks.filter((k) => k.status !== "ok").length, passed = checks.length - bad;
    // everything fine: collapsed behind the summary; otherwise failing rows first and the passed ones folded away
    const shown = bad === 0 ? (this.sysAllOpen ? checks : []) : this.sysPassedOpen ? [...checks.filter((k) => k.status !== "ok"), ...checks.filter((k) => k.status === "ok")] : checks.filter((k) => k.status !== "ok");
    for (const k of shown) {
      const rows = k.rows ?? [], isOpen = this.open.has(k.id) && rows.length > 0;
      const tr = el("tr", `sys-row ${k.status}${rows.length ? " has" : ""}${isOpen ? " open" : ""}`);
      const bd = el("td", "sys-badge"); bd.innerHTML = `<span class="sys-dot">${icon(k.status === "ok" ? "check" : k.status === "warn" ? "warn" : "x", 14)}</span>`;
      const nm = el("td", "sys-name"); nm.innerHTML = `<span class="sys-ico">${icon(SYS_ICON[k.id] ?? "setup", 16)}</span>`; nm.append(k.label);
      tr.append(bd, nm, el("td", "sys-val", k.summary ?? k.detail));
      const tog = el("td", "sys-tog"), wrap = el("div", "sys-acts");
      for (const a of k.actions ?? []) {
        const ab = el("button", `sys-act${k.status === "ok" ? "" : " hot"}`); ab.type = "button"; ab.innerHTML = `${icon(a.icon, 14)}<span>${a.label}</span>`; ab.dataset.tip = a.label; ab.dataset.tipBody = ACTION_INFO[a.id] ?? "Run this fix, then the checks run again."; 
        ab.onclick = async (e) => {
          e.stopPropagation(); ab.disabled = true; ab.classList.add("busy");
          try { await runCheckAction(a.id); } catch { /* denied or dismissed: the re-check shows the state */ }
          if (a.id.endsWith(".grant")) await this.runChecks(); else { ab.disabled = false; ab.classList.remove("busy"); }
        };
        wrap.append(ab);
      }
      if (rows.length) {
        const b = el("button", "sys-btn"); b.type = "button"; b.setAttribute("aria-expanded", String(isOpen)); b.dataset.tip = isOpen ? "Hide details" : "Show details"; b.dataset.tipBody = `The facts behind the ${k.label} check.`; b.setAttribute("aria-label", `${isOpen ? "Hide" : "Show"} details for ${k.label}`); b.innerHTML = icon("chevron", 16);
        const flip = () => { if (this.open.has(k.id)) this.open.delete(k.id); else this.open.add(k.id); this.deps.sfx.play("tick"); this.renderSystem(); };
        b.onclick = flip; tr.onclick = (e) => { if (!(e.target as HTMLElement).closest(".sys-act")) flip(); };
        wrap.append(b);
      }
      tog.append(wrap); tr.append(tog); body.append(tr);
      if (isOpen) {
        const dr = el("tr", `sys-detail ${k.status}`), td = el("td"); td.colSpan = 4;
        if (k.status !== "ok") td.append(el("p", "sys-note", k.detail));
        const dl = el("dl");
        for (const r of rows) dl.append(el("dt", "", r.label), el("dd", "", r.value));
        td.append(dl); dr.append(td); body.append(dr);
      }
    }
    t.append(body);
    t.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") e.stopPropagation(); });
    const bar = el("div", `sys-bar${bad ? " bad" : ""}`);
    bar.innerHTML = `<span class="sys-dot">${icon(bad ? "warn" : "check", 14)}</span>`;
    if (bad) bar.append(el("span", "sys-sum", `${bad} of ${checks.length} need attention`));
    else {
      const tg = el("button", "sys-toggle"); tg.type = "button"; tg.setAttribute("aria-expanded", String(this.sysAllOpen));
      tg.dataset.tip = this.sysAllOpen ? "Hide checks" : "Show checks"; tg.dataset.tipBody = "The individual results behind the summary.";
      tg.innerHTML = `<span class="sys-sum">All ${checks.length} checks passed</span>${icon("chevron", 16)}`;
      tg.onclick = () => { this.sysAllOpen = !this.sysAllOpen; this.deps.sfx.play("tick"); this.renderSystem(); };
      bar.append(tg);
    }
    const parts: HTMLElement[] = [bar];
    if (shown.length) parts.push(t);
    if (bad && passed) {
      const fold = el("button", "sys-fold"); fold.type = "button"; fold.setAttribute("aria-expanded", String(this.sysPassedOpen));
      fold.innerHTML = `${icon("chevron", 14)}<span>${this.sysPassedOpen ? "Hide" : "Show"} passed checks (${passed})</span>`;
      fold.onclick = () => { this.sysPassedOpen = !this.sysPassedOpen; this.deps.sfx.play("tick"); this.renderSystem(); };
      parts.push(fold);
    }
    this.extra.replaceChildren(...parts);
  }

  private renderNav() {
    this.nav.replaceChildren();
    const mk = (to: number, dir: "prev" | "next") => {
      const s = STEPS[to]; if (!s) return;
      const b = el("button", `halo-nav ${dir}`); b.type = "button";
      b.innerHTML = dir === "prev" ? `${icon("back")}<span>${s.title}</span>` : `<span>Next</span>${icon("arrow")}`;
      b.onclick = () => this.stepTo(to);
      this.nav.append(b);
    };
    mk(this.step - 1, "prev"); mk(this.step + 1, "next");
  }

  private renderList() {
    this.list.replaceChildren();
    const items = this.items();
    let k = -1;
    items.forEach((it, i) => {
      const li = el("li", `halo-item ${it.kind}`);
      if (isFocusable(it)) {
        k++;
        const idx = k;
        if (this.zone === "pane" && idx === this.focus) li.classList.add("sel");
        li.onclick = () => { this.zone = "pane"; this.focus = idx; this.handle("select"); };
        li.onmouseenter = () => { if (this.zone !== "pane" || this.focus !== idx) { this.zone = "pane"; this.focus = idx; this.deps.sfx.play("tick"); this.renderList(); } };
      } else if (it.kind === "info" && it.tone) li.classList.add(it.tone);
      if (it.kind === "info" && it.tone) li.append(el("span", "halo-badge", it.tone === "ok" ? "✓" : it.tone === "warn" ? "!" : "✕"));
      if (it.kind !== "info") {
        const ic = el("span", "halo-ic"); ic.innerHTML = icon(it.icon ?? (it.kind === "action" ? "arrow" : LABEL_ICON[it.label] ?? KIND_FALLBACK[it.kind]), 18); li.append(ic);
      }
      const depth = this.depth.get(it) ?? 0;
      if (depth) li.classList.add(`halo-d${depth}`);
      li.append(el("span", "halo-label", it.label));
      if (it.kind === "group") {
        const open = it.get();
        li.classList.add(open ? "open" : "closed"); li.setAttribute("aria-expanded", String(open));
        const ch = el("span", "halo-chev"); ch.innerHTML = icon("chevron", 14);
        li.append(el("span", "halo-value", valueText(it)), ch);
        if (it.auto) li.append(this.autoButton(it.auto));
      } else if (it.kind === "text") {
        const inp = el("input"); inp.value = it.get();
        if (it.secret) { inp.type = "password"; inp.autocomplete = "off"; inp.spellcheck = false; inp.placeholder = "Paste your key"; } inp.onchange = () => { it.set(inp.value); this.deps.sfx.play("ok"); };
        inp.onclick = (e) => e.stopPropagation();
        li.append(inp);
      } else {
        if (it.kind === "slider") {
          const rng = el("input", "halo-range"); rng.type = "range";
          rng.min = String(it.min); rng.max = String(it.max); rng.step = String(it.step); rng.value = String(it.get());
          rng.setAttribute("aria-label", it.label);
          // the value keeps its ◂ ▸ stepper, in fixed columns so the arrows line up down the list
          const num = el("span", "halo-value halo-stepper");
          num.innerHTML = `<span class="halo-arr">◂</span> <span class="halo-num"></span> <span class="halo-arr">▸</span>`;
          const txt = num.querySelector(".halo-num")!; txt.textContent = valueText(it);
          rng.onclick = (e) => e.stopPropagation();
          rng.oninput = () => { it.set(Number(rng.value)); txt.textContent = valueText(it); it.visual?.update(Number(rng.value)); this.deps.sfx.play("tick"); };
          rng.onchange = () => this.afterChange();
          li.append(rng, num);
          if (it.visual) {
            // dragging the graph moves the slider: snap to its step, clamp to its range, and run the normal input/change path
            it.visual.onPick = (raw, final) => {
              const v = Math.min(it.max, Math.max(it.min, Math.round(raw / it.step) * it.step));
              if (v !== Number(rng.value)) { rng.value = String(v); rng.oninput?.(new InputEvent("input")); }
              if (final) rng.onchange?.(new Event("change"));
            };
            li.classList.add("has-visual"); li.append(it.visual.el);
          }
        } else if (it.kind === "choice") {
          // a dropdown, so any option is one pick away (←/→ on the focused row still steps through them)
          const sel = el("select", "halo-select"); sel.setAttribute("aria-label", it.label);
          const cur = it.get();
          for (const o of it.options) { const op = el("option", "", o.label); op.value = o.value; op.selected = o.value === cur; sel.append(op); }
          sel.onclick = (e) => e.stopPropagation();
          sel.onchange = () => { it.set(sel.value); this.deps.sfx.play("tick"); this.afterChange(); };
          const at = k; // clicking the row opens the list instead of cycling to the next option (hover already focused it)
          li.onclick = () => { this.zone = "pane"; this.focus = at; try { sel.showPicker(); } catch { sel.focus(); } };
          li.append(sel);
        } else li.append(el("span", "halo-value", valueText(it)));
        if ((it.kind === "slider" || it.kind === "choice") && it.auto) li.append(this.autoButton(it.auto));
        if (it.kind === "action" && it.disabled) li.classList.add("disabled");
        // a disabled action explains itself on hover (the bottom hint line does the same for keyboard focus)
        if (it.kind === "action" && it.disabled && it.hint) { li.dataset.tip = "Unavailable"; li.dataset.tipBody = it.hint; }
        if (it.kind === "action" && it.danger) li.classList.add("danger");
        if (it.kind === "toggle" && it.remove) {
          const rm = it.remove, b = el("button", "halo-trash"); b.type = "button"; b.title = rm.label; b.setAttribute("aria-label", rm.label); b.innerHTML = icon("trash", 18);
          b.onclick = (ev) => { ev.stopPropagation(); this.removeItem(rm.run); };
          li.append(b);
        }
      }
      void i;
      this.list.append(li);
    });
    const cur = this.focusables()[this.focus]?.it;
    this.hint.textContent = this.state.autoMsg || (this.zone === "pane" && cur && "hint" in cur && cur.hint ? cur.hint : "");
  }
}

/** Row icons by label, so every setting has one; anything unlisted falls back to its kind's icon. */
const LABEL_ICON: Record<string, string> = {
  "Camera": "camera", "Channel": "palette", "Trust": "scale", "Field of view": "eye", "Across (x)": "board", "Down (y)": "board",
  "Scene": "scene", "Rain": "scene", "Snow": "scene", "Time of day": "clock",
  "Speak aloud": "sound", "Volume": "sound", "Opponent for each game": "opponent", "Computer strength": "knight",
  "Projectors": "lamp", "People tracking": "people", "DMX lighting": "lamp", "Autoplay demo game": "play", "Demo game": "film",
};
/** Icon for each setup step in the left list. */
const STEP_ICON: Record<string, string> = {
  briefing: "briefing", cameras: "camera", board: "board", scenes: "scene", narration: "chat",
  ai: "brain", voice: "voice", opponent: "opponent", room: "room", theme: "palette", launch: "launch",
};
const KIND_FALLBACK: Record<string, string> = { toggle: "toggle", choice: "list", slider: "sliders", text: "text" };

/** Per-camera live state on the cameras step. */
interface CamPreview {
  key: string; // device id, or the virtual rig
  canvas: HTMLCanvasElement;
  stream: MediaStream | null;
  video: HTMLVideoElement | null;
  pending: boolean;
  error: string;
  drawn: number; // last paint time (ms), for throttling
  lumKey: string; // virtual cameras: scene key the cached luminance was rendered for
  lum: Float32Array | null;
}

const SYS_ICON: Record<string, string> = { system: "setup", webgl: "cube", camera: "camera", audio: "sound", speech: "voice", stockfish: "knight", gamepad: "bolt" };

const ACTION_INFO: Record<string, string> = { "camera.grant": "Asks the browser for camera access so cameras can be named and opened. If it was blocked, unblock it from the address bar first.", "speech.test": "Speaks a short French line with the default narrator voice." };
