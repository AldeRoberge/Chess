import { SceneRenderer } from "../scene/renderer";
import { applySensor, renderLuminance } from "../sim/render3d";
import { FRAME_H, FRAME_W, RIGS } from "../sim/rigs";
import { virtualTable } from "../sim/virtualTable";
import type { SetupConfig } from "../setup/config";
import type { CameraDevice } from "../setup/devices";
import { evaluateEnv, runCheckAction, type Env } from "../setup/system";
import { fmtCorners, parseCorners } from "../plugins/shared";
import { CornerPicker } from "./cornerPicker";
import { activate, adjust, isFocusable, valueText, type Item } from "./menu";
import { GamepadPoller, keyToAction, type NavAction } from "./nav";
import type { VoiceSettings } from "../narrator/voice";
import type { Sfx } from "./sfx";
import { icon } from "./icons";
import { spinnerHTML } from "./spinner";
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
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private streamFor = "";
  private virtualLum: Float32Array | null = null;
  private virtualKey = "";
  private scr = new SceneRenderer();
  private lastFrame = 0;
  private onKey = (e: KeyboardEvent) => this.key(e);

  constructor(public cfg: SetupConfig, private deps: WizardDeps, startStep = 0) {
    this.step = Math.max(0, Math.min(STEPS.length - 1, Math.floor(startStep) || 0));
    this.state = { checks: null, detected: [], scanning: false, boardCam: 0, scenePreview: sceneStateFor(cfg), tests: {}, groups: {} };
    this.canvas.width = FRAME_W; this.canvas.height = FRAME_H;
    const brand = el("div", "halo-brand"); brand.innerHTML = `<span class="halo-brand-ic">${icon("knight", 22)}</span>`; brand.append(el("span", "halo-logo", "Chess XP"));
    const head = el("header"); head.append(brand, this.progress);
    if (deps.canCancel?.() !== false) { // first run can't be skipped, so there is nothing to close back to
      const x = el("button", "halo-close", "✕"); x.type = "button"; x.title = "Close setup (Esc)"; x.setAttribute("aria-label", "Close setup");
      x.onclick = () => this.cancel(); head.append(x);
    }
    const foot = el("footer", "halo-keys"); foot.innerHTML = "<span><b>↑↓</b> Select</span><span><b>←→</b> Adjust</span><span><b>Enter / A</b> Confirm</span><span><b>Esc / B</b> Back</span>";
    this.pane.append(this.title, this.blurb, this.extra, this.list, this.hint, this.nav); // previews first: they are what you drag
    const body = el("div", "halo-body"); body.append(this.stepsEl, this.splitter(), this.pane);
    this.root.append(el("div", "halo-bg"), head, body, foot);
    this.canvas.addEventListener("pointerdown", (e) => this.pointer("down", e));
    this.canvas.addEventListener("pointermove", (e) => this.pointer("move", e));
    this.canvas.addEventListener("pointerup", () => this.pointer("up"));
    this.enterStep();
    this.render();
  }

  mount(parent: HTMLElement) { parent.append(this.root); window.addEventListener("keydown", this.onKey); }

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
  destroy() { window.removeEventListener("keydown", this.onKey); this.stopStream(); this.root.remove(); }

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
  private async runChecks() { this.state.checks = evaluateEnv(await this.deps.detectEnv()); this.render(); }

  // ---- input
  private key(e: KeyboardEvent) {
    if ((e.target as HTMLElement | null)?.tagName === "INPUT") { if (e.key === "Escape" || e.key === "Enter") (e.target as HTMLElement).blur(); return; }
    if (e.key === "Delete" && this.zone === "pane") { const it = this.focusables()[this.focus]?.it; if (it?.kind === "toggle" && it.remove) { e.preventDefault(); this.removeItem(it.remove.run); return; } }
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
    this.extra.replaceChildren();
    const id = STEPS[this.step].id;
    if (id === "briefing" && !this.state.checks) void this.runChecks();
    if (id === "board" && this.cfg.cameras.length) {
      this.state.boardCam = Math.min(this.state.boardCam, this.cfg.cameras.length - 1);
      this.extra.append(this.canvas);
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
      this.cfg.cameras[this.state.boardCam].corners = fmtCorners(this.picker.corners);
      this.renderList();
    }
  }

  /** Animated previews + gamepad polling; call from the app's rAF loop. */
  frame(now: number) {
    for (const a of this.pad.poll(now)) this.handle(a);
    const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0.016; this.lastFrame = now;
    const id = STEPS[this.step].id, ctx = this.canvas.getContext("2d")!;
    if (id === "scenes") this.scr.draw(ctx, this.canvas.width, this.canvas.height, this.state.scenePreview, now, dt);
    else if (id === "board" && this.cfg.cameras.length) this.drawBoardPreview(ctx);
  }

  private drawBoardPreview(ctx: CanvasRenderingContext2D) {
    const cam = this.cfg.cameras[this.state.boardCam];
    if (cam.kind === "virtual") {
      const key = `${cam.rig}|${virtualTable.sceneKey}`;
      if (key !== this.virtualKey) { this.virtualKey = key; this.virtualLum = renderLuminance(virtualTable.scene3d(), { width: FRAME_W, height: FRAME_H, rig: RIGS[cam.rig] }); }
      const f = applySensor(this.virtualLum!, { width: FRAME_W, height: FRAME_H, rig: RIGS[cam.rig], noise: 3 });
      const img = ctx.createImageData(FRAME_W, FRAME_H);
      for (let i = 0; i < f.data.length; i++) { img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = f.data[i]; img.data[i * 4 + 3] = 255; }
      ctx.putImageData(img, 0, 0);
    } else if (this.video) ctx.drawImage(this.video, 0, 0, FRAME_W, FRAME_H);
    else { ctx.fillStyle = "#04101c"; ctx.fillRect(0, 0, FRAME_W, FRAME_H); ctx.fillStyle = "#6fb8ff"; ctx.fillText("No signal", 20, 30); }
    const pts = parseCorners(cam.corners);
    if (!pts) return;
    if (!this.picker || this.picker.active < 0) this.picker = new CornerPicker(pts, FRAME_W, FRAME_H);
    const c = this.picker.corners;
    ctx.strokeStyle = "#7dffb0"; ctx.lineWidth = 2; ctx.beginPath(); c.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.stroke();
    ctx.fillStyle = "#7dffb0"; c.forEach((p, i) => { ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, 7); ctx.fill(); ctx.fillStyle = "#fff"; ctx.strokeStyle = "#001"; ctx.lineWidth = 3; const lab = ["a8", "h8", "h1", "a1"][i]; ctx.strokeText(lab, p.x + 9, p.y - 9); ctx.fillText(lab, p.x + 9, p.y - 9); ctx.strokeStyle = "#7dffb0"; ctx.lineWidth = 2; ctx.fillStyle = "#7dffb0"; });
  }

  // ---- rendering
  private render() {
    this.stepsEl.replaceChildren();
    STEPS.forEach((s, i) => {
      const li = el("li", `halo-step${i === this.step ? " cur" : ""}${i === this.step && this.zone === "steps" ? " sel" : ""}`, `${String(i + 1).padStart(2, "0")}  ${s.title}`);
      li.onclick = () => { this.step = i; this.focus = 0; this.zone = "steps"; this.deps.sfx.play("tick"); this.enterStep(); this.render(); };
      this.stepsEl.append(li);
    });
    this.progress.replaceChildren(...STEPS.map((_, i) => el("i", i < this.step ? "done" : i === this.step ? "cur" : "")), el("span", "", `Step ${this.step + 1} of ${STEPS.length}`));
    this.title.textContent = STEPS[this.step].title;
    this.blurb.textContent = STEPS[this.step].blurb;
    this.renderNav();
    this.renderList();
    if (this.stepId === "briefing") this.renderSystem();
    if (this.reported !== this.stepId) { this.reported = this.stepId; this.deps.onStep?.(this.reported); }
    this.deps.onProgress?.(this.cfg, this.step);
  }

  private open = new Set<string>();
  /** The system check as a table: one row per subsystem, each expanding to the facts behind it. */
  private renderSystem() {
    const checks = this.state.checks;
    if (!checks) { this.extra.replaceChildren(); return; }
    const t = el("table", "halo-sys");
    const head = el("thead"), hr = el("tr");
    for (const h of ["", "Component", "Status", ""]) hr.append(el("th", "", h));
    head.append(hr); t.append(head);
    const body = el("tbody");
    for (const k of checks) {
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
    const bad = checks.filter((k) => k.status !== "ok").length;
    const bar = el("div", `sys-bar${bad ? " bad" : ""}`);
    bar.innerHTML = `<span class="sys-dot">${icon(bad ? "warn" : "check", 14)}</span>`;
    bar.append(el("span", "sys-sum", bad ? `${bad} of ${checks.length} need attention` : `All ${checks.length} checks passed`));
    const re = el("button", "sys-act"); re.type = "button"; re.dataset.tip = "Re-run checks"; re.dataset.tipBody = "Test cameras, graphics, sound and the engine again, for example after plugging something in."; re.innerHTML = `${icon("refresh", 14)}<span>Re-run checks</span>`;
    re.onclick = () => { re.disabled = true; re.classList.add("busy"); re.innerHTML = `${spinnerHTML("rook", 14)}<span>Re-running…</span>`; void this.runChecks(); };
    bar.append(re);
    this.extra.replaceChildren(bar, t);
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
          if (it.visual) { li.classList.add("has-visual"); li.append(it.visual.el); }
        } else if (it.kind === "choice") {
          const s = el("span", "halo-value halo-stepper");
          s.innerHTML = `<span class="halo-arr">◂</span> <span class="halo-num"></span> <span class="halo-arr">▸</span>`;
          s.querySelector(".halo-num")!.textContent = valueText(it);
          li.append(s);
        } else li.append(el("span", "halo-value", valueText(it)));
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
    this.hint.textContent = this.zone === "pane" && cur && "hint" in cur && cur.hint ? cur.hint : "";
  }
}

/** Row icons by label, so every setting has one; anything unlisted falls back to its kind's icon. */
const LABEL_ICON: Record<string, string> = {
  "Camera": "camera", "Channel": "palette", "Trust": "scale", "Field of view": "eye", "Across (x)": "board", "Down (y)": "board",
  "Scene": "scene", "Rain": "scene", "Snow": "scene", "Time of day": "clock",
  "Speak aloud": "sound", "Volume": "sound", "Opponent for each game": "opponent", "Computer strength": "knight",
  "Projectors": "lamp", "People tracking": "people", "DMX lighting": "lamp", "Autoplay demo game": "play", "Demo game": "film",
};
const KIND_FALLBACK: Record<string, string> = { toggle: "toggle", choice: "list", slider: "sliders", text: "text" };

const SYS_ICON: Record<string, string> = { system: "setup", webgl: "cube", camera: "camera", audio: "sound", speech: "voice", stockfish: "knight", gamepad: "bolt" };

const ACTION_INFO: Record<string, string> = { "camera.grant": "Asks the browser for camera access so cameras can be named and opened. If it was blocked, unblock it from the address bar first.", "speech.test": "Speaks a short French line with the default narrator voice." };
