import "./style.css";
import { chipIcons, chipTone } from "./ui/chipIcons";
import { installContextMenus, registerContextMenu } from "./ui/contextMenu";
import { appMenu } from "./ui/menus/appMenu";
import "./ui/halo.css";
import "./ui/theme.css";
import "./ui/tooltip.css";
import "@fontsource/chakra-petch/400.css";
import "@fontsource/chakra-petch/500.css";
import "@fontsource/chakra-petch/600.css";
import "@fontsource/chakra-petch/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import { bus } from "./core/bus";
import { Graph } from "./core/graph";
import { createRegistry } from "./plugins";
import { startAudio } from "./plugins/scene";
import { AudioEngine } from "./scene/audio";
import { speakLine } from "./plugins/narration";
import { buildGraphFromConfig, clearSetup, defaultSetup, loadSetup, saveSetup, type SetupConfig } from "./setup/config";
import { listCameras, openCamera } from "./setup/devices";
import { detectEnv } from "./setup/system";
import { Sfx } from "./ui/sfx";
import { SetupWizard } from "./ui/wizard";
import { NodeEditor } from "./ui/editor";
import { editorTips } from "./ui/editorTips";
import { installTooltips } from "./ui/tooltip";
import { clearPrefs, loadPrefs, patchPrefs } from "./setup/prefs";
import { History } from "./core/history";
import { addBackup, ago, beatSession, closeSession, deleteBackup, listBackups, openSession, parseImport, type Backup } from "./setup/backups";
import { notify, openBackupPanel } from "./ui/recovery";
import { openWorkflowPanel } from "./ui/workflows";
import { LogPanel, TablePanel, WorldPanel } from "./ui/panels";
import { PerfPanel } from "./ui/perfPanel";
import { profiler } from "./core/profiler";
import "./ui/perf.css";
import type { GraphJSON } from "./core/types";
import { STEPS } from "./ui/wizardSteps";
import { icon } from "./ui/icons";
import { APP_THEMES, appMode, appTheme, nextMode, onAppTheme, setAppMode, setAppTheme } from "./ui/appTheme";
import { PAGES, formatRoute, parseRoute, routeTitle, sameRoute, type Route } from "./ui/route";
import { suggestNext, type Suggestion } from "./ui/nextSteps";

export interface Boot { graph: Graph; editor: NodeEditor; go(r: Route): void; route(): Route; step(now: number): void; start(): void; openWizard(): void; wizard: () => SetupWizard | null }

/** Builds the whole app into `root`. Nothing runs until `start()` (rAF loop) or `step()` (tests). */
export function boot(root: HTMLElement): Boot {
  const registry = createRegistry();
  const graph = new Graph(registry);
  const KEY = "cx.graph.v1";
  const crashed = openSession();
  let recovered: Backup | null = null;
  let savedRaw: string | null = null; try { savedRaw = localStorage.getItem(KEY); } catch { /* storage blocked */ }
  try { if (savedRaw) graph.load(JSON.parse(savedRaw) as GraphJSON); } catch {
    // Unreadable save: keep a copy for forensics, then fall back to the newest backup.
    try { localStorage.setItem("cx.graph.corrupt.v1", savedRaw ?? ""); } catch { /* storage full */ }
    for (const id of [...graph.nodes.keys()]) graph.removeNode(id);
    recovered = listBackups()[0] ?? null;
    if (recovered) try { graph.load(recovered.graph); } catch { recovered = null; for (const id of [...graph.nodes.keys()]) graph.removeNode(id); }
  }
  const setup = loadSetup();
  if (!graph.nodes.size) buildGraphFromConfig(graph, setup ?? defaultSetup());
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(graph.toJSON())); } catch { /* quota */ } };
  const edits = new History<GraphJSON>(graph.toJSON());
  let dirty = false;
  const sig = () => `${graph.nodes.size}:${graph.edges.length}:${graph.groups.length}`;
  const syncUndo = () => { for (const [id, ok] of [["undo", edits.canUndo], ["redo", edits.canRedo]] as const) { const b = document.getElementById(id) as HTMLButtonElement | null; if (b) b.disabled = !ok; } };
  const kb = (chars: number) => chars < 1024 * 100 ? `${(chars / 1024).toFixed(1)} KB` : chars < 1024 * 1024 * 10 ? `${(chars / 1048576).toFixed(2)} MB` : `${(chars / 1048576).toFixed(1)} MB`;
  /** Top-bar chips: action count, undo / redo depth, workflow size, history memory, browser storage and heap. */
  let stored = 0, storedAt = 0;
  const editChips = () => {
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const t = Date.now();
    if (t - storedAt > 2000) { storedAt = t; stored = 0; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; stored += k.length + (localStorage.getItem(k)?.length ?? 0); } } catch { /* storage unavailable */ } }
    return [
      `<span class="chip" data-tip="Actions" data-tip-body="Edits to the workflow this session. A drag counts once." data-tip-rows="Recorded:${edits.actions}|Nodes:${graph.nodes.size}|Wires:${graph.edges.length}">${chipIcons.actions(edits.actions)}${edits.actions} actions</span>`,
      `<span class="chip${edits.canUndo ? " on" : ""}" data-tip="Undo history" data-tip-body="Steps you can go back (Ctrl+Z). Oldest are dropped after 100." data-tip-rows="Undo steps:${edits.undoCount}|Limit:100">${chipIcons.undo(edits.undoCount)}${edits.undoCount}</span>`,
      `<span class="chip${edits.canRedo ? " on" : ""}" data-tip="Redo history" data-tip-body="Steps you undid and can bring back (Ctrl+Y). Any new edit clears them." data-tip-rows="Redo steps:${edits.redoCount}">${chipIcons.redo(edits.redoCount)}${edits.redoCount}</span>`,
      `<span class="chip${chipTone.workflow(edits.patchChars / 1024)}" data-tip="Workflow size" data-tip-body="Size of the node graph as saved JSON." data-tip-rows="Workflow:${kb(edits.patchChars)}|Nodes:${graph.nodes.size}|Wires:${graph.edges.length}|Unsaved backup:${dirty ? "yes" : "no"}">${chipIcons.workflow(edits.patchChars / 1024)}workflow ${kb(edits.patchChars)}</span>`,
      `<span class="chip${chipTone.hist(edits.chars / 1024)}" data-tip="History memory" data-tip-body="Memory held by every undo and redo snapshot." data-tip-rows="Snapshots:${edits.undoCount + edits.redoCount + 1}|Total:${kb(edits.chars)}">${chipIcons.hist(edits.chars / 1024)}hist ${kb(edits.chars)}</span>`,
      `<span class="chip${chipTone.store(stored / 5242880)}" data-tip="Browser storage" data-tip-body="Everything this site keeps in localStorage: workflow, setup, backups, preferences. Browsers allow about 5 MB." data-tip-rows="Used:${kb(stored)}|Typical limit:5 MB:${stored / 5242880}">${chipIcons.store(stored / 5242880)}store ${kb(stored)}</span>`,
      mem ? `<span class="chip${chipTone.heap(mem.usedJSHeapSize / 1048576)}" data-tip="JS heap" data-tip-body="Memory used by the page's JavaScript (Chromium only).">${chipIcons.heap(mem.usedJSHeapSize / 1048576)}heap ${(mem.usedJSHeapSize / 1048576).toFixed(0)} MB</span>` : "",
    ].join("");
  };
  /** Every edit: autosave, remember an undo step, mark the workflow as changed since the last backup. */
  const persist = () => { save(); dirty = true; edits.record(graph.toJSON(), Date.now(), sig()); syncUndo(); };

  const app = root;
  app.innerHTML = `
    <header>
      <a class="brand" id="home" href="#/table" aria-label="Home" data-tip="Home" data-tip-body="Back to the start page.">CE</a>
      <nav class="rtabs" role="tablist" aria-label="Ribbon">
        <button role="tab" class="on" data-rtab="home" aria-selected="true">Home</button>
        <button role="tab" data-rtab="view" aria-selected="false">View</button>
        <button role="tab" data-rtab="tools" aria-selected="false">Tools</button>
        <div class="spacer"></div>
        <div class="chips" id="hud"></div>
      </nav>
      <div class="ribbon" role="tabpanel">
        <div class="rpane on" data-rpane="home">
          <div class="rgroup"><div class="rbtns">
            <button id="undo" class="rb" disabled aria-label="Undo" data-tip="Undo" data-tip-keys="Ctrl,Z" data-tip-body="Step back through your edits to the workflow."><b>↶</b>Undo</button>
            <button id="redo" class="rb" disabled aria-label="Redo" data-tip="Redo" data-tip-keys="Ctrl,Y" data-tip-body="Bring back an edit you undid."><b>↷</b>Redo</button>
          </div><div class="rlabel">History</div></div>
          <div class="rgroup"><div class="rbtns">
            <button id="workflows" class="rb" data-tip="Workflow" data-tip-body="Load a demo workflow, build your own with AI, or open a workflow file."><b>▤</b>Workflow</button>
            <button id="backups" class="rb" data-tip="Backups" data-tip-body="Restore points, crash recovery, import and export."><b>⟲</b>Backups</button>
            <div class="rdrop"><button id="more" class="rb" aria-haspopup="menu" aria-expanded="false" data-tip="More" data-tip-body="Export or reset the workflow."><b>⋯</b>File ▾</button>
              <div class="rmenu" role="menu" hidden>
                <button id="export" role="menuitem" data-tip="Export workflow" data-tip-body="Downloads the current node graph as a JSON file you can keep or share."><span class="ic-slot"></span>Export workflow</button>
                <button id="reset" role="menuitem" data-tip="Reset workflow" data-tip-tag="destructive" data-tip-color="#ff7070" data-tip-body="Discards your saved node layout and setup, then reloads the page.">Reset workflow</button>
              </div></div>
          </div><div class="rlabel">Workflow</div></div>
        </div>
        <div class="rpane" data-rpane="view">
          <div class="rgroup"><div class="rbtns">
            <button id="heat" class="rb" data-tip="Node timings" data-tip-body="Show each node's cost on the workflow: a share bar, a sparkline of recent ticks, and avg / p95 / max milliseconds."><b>◔</b>Timings</button>
          </div><div class="rlabel">Graph</div></div>
          <div class="rgroup"><div class="rbtns">
            <select id="theme" aria-label="Theme" data-tip="Theme" data-tip-body="Pick the look of the whole app.">${APP_THEMES.map((t) => `<option value="${t.id}">${t.name}</option>`).join("")}</select>
            <button id="mode" class="rb" data-tip="Light / dark" data-tip-body="Cycle dark, light, or follow the system."><b>◐</b><span class="lbl"></span></button>
          </div><div class="rlabel">Theme</div></div>
        </div>
        <div class="rpane" data-rpane="tools">
          <div class="rgroup"><div class="rbtns">
            <button id="setup" class="rb" data-tip="Guided setup" data-tip-body="Reopen the step-by-step wizard for cameras, projector and players."><span class="ic-slot"></span>Setup</button>
            <button id="audio" class="rb" data-tip="Sound" data-tip-body="Browsers keep audio locked until you click. This starts the thunder and ambience engine."><span class="ic-slot"></span><span class="lbl">Enable sound</span></button>
          </div><div class="rlabel">Experience</div></div>
        </div>
      </div>
    </header>
    <main>
      <section id="graph"></section>
      <aside>
        <div class="resize" id="resize" role="separator" aria-orientation="vertical" tabindex="0" aria-label="Resize inspector" data-tip="Resize inspector" data-tip-body="Drag to change the width of this panel." data-tip-keys="Drag,Double-click" data-tip-hint="Double-click resets"></div>
        <nav id="tabs"></nav>
        <div id="next" aria-label="Suggested next steps"></div>
        <div id="dock"></div>
      </aside>
    </main>
    <footer id="sub"></footer>`;

  installTooltips().add(editorTips(graph));
  // ---- ribbon: tab headers switch panes; "File" dropdown closes on outside click / Escape
  for (const t of app.querySelectorAll<HTMLElement>("[data-rtab]")) t.onclick = () => {
    for (const o of app.querySelectorAll<HTMLElement>("[data-rtab]")) { const on = o === t; o.classList.toggle("on", on); o.setAttribute("aria-selected", String(on)); }
    for (const p of app.querySelectorAll<HTMLElement>("[data-rpane]")) p.classList.toggle("on", p.dataset.rpane === t.dataset.rtab);
  };
  const moreBtn = document.getElementById("more")!, moreMenu = app.querySelector<HTMLElement>(".rmenu")!;
  const setMenu = (open: boolean) => { moreMenu.hidden = !open; moreBtn.setAttribute("aria-expanded", String(open)); };
  moreBtn.onclick = (e) => { e.stopPropagation(); setMenu(moreMenu.hidden); };
  moreMenu.addEventListener("click", () => setMenu(false));
  document.addEventListener("click", () => setMenu(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setMenu(false); });
  const prefs = loadPrefs();
  // ---- resizable inspector: width lives in a CSS variable, saved to prefs
  const mainEl = root.querySelector("main") as HTMLElement, handle = document.getElementById("resize")!;
  const asideMax = () => Math.max(320, window.innerWidth * 0.7);
  const setAside = (w: number | null, save = true) => {
    if (w === null) mainEl.style.removeProperty("--aside-w"); else mainEl.style.setProperty("--aside-w", Math.round(Math.min(asideMax(), Math.max(280, w))) + "px");
    if (save) patchPrefs({ asideW: w === null ? undefined : Math.round(Math.min(asideMax(), Math.max(280, w))) });
  };
  if (prefs.asideW) setAside(prefs.asideW, false);
  handle.addEventListener("pointerdown", (e) => {
    if (e.button > 0) return;
    e.preventDefault(); handle.setPointerCapture?.(e.pointerId); handle.classList.add("drag"); document.body.classList.add("resizing");
    let last: number | null = null;
    const move = (ev: PointerEvent) => { last = window.innerWidth - ev.clientX; setAside(last, false); };
    const end = () => { handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", end); handle.removeEventListener("pointercancel", end); handle.classList.remove("drag"); document.body.classList.remove("resizing"); if (last !== null) setAside(last); };
    handle.addEventListener("pointermove", move); handle.addEventListener("pointerup", end); handle.addEventListener("pointercancel", end);
  });
  handle.addEventListener("dblclick", () => setAside(null));
  handle.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault(); setAside(handle.parentElement!.getBoundingClientRect().width + (e.key === "ArrowLeft" ? 24 : -24));
  });
  const editor = new NodeEditor(graph);
  editor.onChange = persist;
  if (prefs.view) editor.setView(prefs.view);
  let viewTimer: ReturnType<typeof setTimeout> | undefined;
  editor.onView = () => { clearTimeout(viewTimer); viewTimer = setTimeout(() => patchPrefs({ view: editor.getView() }), 400); };
  document.getElementById("graph")!.append(editor.root);
  const tools = document.createElement("div"); tools.className = "ne-tools";
  const tool = (label: string, tip: string, body: string, fn: () => void) => { const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.dataset.tip = tip; b.dataset.tipBody = body; b.onclick = fn; tools.append(b); return b; };
  tool("+ Section", "Add section", "Wrap the selected nodes (or the middle of the view) in a titled, coloured frame. Drag its title to move everything inside.", () => editor.addGroup());
  tool("Organize", "Organize into sections", "Lay the workflow out in bands: demo & input, analysis, game & experience, output (sound & narration). Undo with Ctrl+Z.", () => editor.organize());
  document.getElementById("graph")!.append(tools);

  const table = new TablePanel(), world = new WorldPanel(graph), log = new LogPanel();
  const perf = new PerfPanel(graph, { reveal: (id) => editor.reveal(id), setHeat: (on) => setHeat(on), heatOn: () => editor.heatOn });
  const panels: [string, { root: HTMLElement }][] = [["Table", table], ["3D / Mapping", world], ["Log", log], ["Performance", perf]];
  const setHeat = (on: boolean) => { editor.setHeat(on); document.getElementById("heat")!.classList.toggle("on", on); patchPrefs({ heat: on }); };
  document.getElementById("heat")!.onclick = () => setHeat(!editor.heatOn);
  const themeSel = document.getElementById("theme") as HTMLSelectElement, modeBtn = document.getElementById("mode")!;
  const syncTheme = () => { themeSel.value = appTheme().id; modeBtn.querySelector(".lbl")!.textContent = appMode()[0].toUpperCase() + appMode().slice(1); };
  themeSel.onchange = () => setAppTheme(themeSel.value);
  modeBtn.onclick = () => setAppMode(nextMode(appMode()));
  onAppTheme(syncTheme); syncTheme();
  if (prefs.heat) setHeat(true);
  const tabs = document.getElementById("tabs")!, dock = document.getElementById("dock")!;
  let active = 0;
  const show = (i: number) => { active = i; profiler.enabled = i === 3; patchPrefs({ tab: i }); dock.replaceChildren(panels[i][1].root); [...tabs.children].forEach((b, k) => { b.classList.toggle("on", k === i); b.setAttribute("aria-current", k === i ? "page" : "false"); }); };
  const TAB_INFO = ["Virtual table: click a piece, then a square, or seat a player.", "3D board and projection-mapping preview.", "Live event and narration log.", "Frame timeline, flamegraph and per-node cost. Open it to start capturing."];
  panels.forEach(([name], i) => { const b = document.createElement("button"); b.innerHTML = `${icon(["table", "world", "log", "perf"][i])}<span>${name}</span><kbd>${i + 1}</kbd>`; b.dataset.tip = name; b.dataset.tipBody = TAB_INFO[i]; b.onclick = () => go({ page: PAGES[i] }); tabs.append(b); });
  show(prefs.tab !== undefined && prefs.tab >= 0 && prefs.tab < panels.length ? prefs.tab : 0);

  table.seatCb = (seated) => { for (const n of graph.nodes.values()) if (n.type === "sim.person") n.params.seated = seated; };
  let soundOn = false;
  const doSound = () => { startAudio(graph); soundOn = true; patchPrefs({ sound: true }); document.getElementById("audio")!.querySelector(".lbl")!.textContent = "Sound on"; refreshNext(true); };
  document.getElementById("audio")!.onclick = doSound;
  for (const [id, name] of [["setup", "setup"], ["audio", "sound"], ["export", "export"]]) document.querySelector(`#${id} .ic-slot`)!.outerHTML = icon(name);
  document.getElementById("reset")!.onclick = () => { addBackup("Before reset", graph.toJSON(), loadSetup(), false); localStorage.removeItem(KEY); clearSetup(); clearPrefs(); location.reload(); };
  const doExport = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify({ app: "chess-experience", graph: graph.toJSON(), setup: loadSetup() }, null, 2)], { type: "application/json" })); a.download = "chess-experience-workflow.json"; a.click(); };
  document.getElementById("export")!.onclick = doExport;

  // ---- undo / redo, backups, crash recovery
  const loadState = (g: GraphJSON) => { graph.load(g); editor.rebuild(); save(); syncUndo(); };
  const stepState = (g: GraphJSON) => { graph.restore(g); editor.rebuild(); save(); dirty = true; syncUndo(); }; // in place: nothing restarts
  const undo = () => { const s = edits.undo(); if (s) stepState(s); };
  const redo = () => { const s = edits.redo(); if (s) stepState(s); };
  document.getElementById("undo")!.onclick = undo;
  document.getElementById("redo")!.onclick = redo;
  window.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || wiz) return;
    if ((e.target as HTMLElement | null)?.closest?.("input:not([type=range]):not([type=checkbox]),textarea,select,[contenteditable]")) return;
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); redo(); }
  });
  /** Replace the workflow (and optionally the setup) from a backup or file. Undoable, and backs up what you had first. */
  const restore = (g: GraphJSON, s: SetupConfig | null, why: string) => {
    addBackup(why, graph.toJSON(), loadSetup(), true);
    if (s) saveSetup(s);
    patchPrefs({ draft: null });
    loadState(g);
    edits.record(graph.toJSON(), Date.now(), "restore" + Math.random());
    syncUndo();
  };
  const importFile = (f: File) => { void f.text().then((t) => { const p = parseImport(t); if (p) restore(p.graph, p.setup, "Before import"); else notify("That file is not a workflow export.", [], "warn"); }); };
  const panel = () => openBackupPanel({
    list: listBackups,
    restore: (b) => restore(b.graph, b.setup, "Before restore"),
    remove: (b) => deleteBackup(b.id),
    backupNow: () => { addBackup("Manual backup", graph.toJSON(), loadSetup(), false); },
    exportFile: doExport,
    importFile,
  });
  document.getElementById("backups")!.onclick = panel;
  installContextMenus(); registerContextMenu(document.body, appMenu);
  document.getElementById("workflows")!.onclick = () => openWorkflowPanel({ registry, current: () => graph.toJSON(), apply: restore, openFile: importFile });
  window.addEventListener("pagehide", () => { if (dirty) addBackup("On exit", graph.toJSON(), loadSetup(), true); closeSession(); });
  if (prefs.sound) {
    const arm = () => { window.removeEventListener("pointerdown", arm, true); window.removeEventListener("keydown", arm, true); if (!soundOn) doSound(); };
    window.addEventListener("pointerdown", arm, true); window.addEventListener("keydown", arm, true);
  }
  if (recovered) notify(`Your saved workflow could not be read, so the backup from ${ago(recovered.t)} was restored.`, [{ label: "Open backups", run: panel }], "warn");
  else if (crashed) { addBackup("Recovered after crash", graph.toJSON(), loadSetup(), true); notify("CE did not close cleanly last time. Everything up to your last edit was autosaved.", [{ label: "Open backups", run: panel }], "warn"); }

  const hud = document.getElementById("hud")!, sub = document.getElementById("sub")!;
  let lastTick = 0, lastHud = 0, lastPost = 0, lastLine = "", lastFrame = 0, frameMs = 16.7, worstMs = 0;
  let lastBackup = 0, lastBeat = 0;
  const step = (now: number) => {
    if (lastFrame) { const d = now - lastFrame; if (d < 1000) { frameMs += (d - frameMs) * 0.1; worstMs = Math.max(worstMs, d); } }
    lastFrame = now;
    profiler.beginFrame(now);
    if (now - lastBeat > 5000) { lastBeat = now; beatSession(); }
    if (now - lastBackup > 300000) { lastBackup = now; if (dirty) { dirty = false; addBackup("Autosave", graph.toJSON(), loadSetup(), true); } }
    if (now - lastTick >= 1000 / 15) { lastTick = now; profiler.span("graph.tick", () => graph.tick(now)); }
    profiler.span("editor", () => editor.frame(now));
    wiz?.frame(now);
    profiler.span(["table", "world", "log", "perf"][active], () => {
      if (active === 0) table.frame(now);
      else if (active === 1) world.frame(now);
      else if (active === 2) log.frame();
      else perf.frame(now);
    });
    if (now - lastPost > 33 && bus.scene) {
      lastPost = now;
      const g = bus.game;
      profiler.span("scene.post", () => world.post({ type: "state", scene: bus.scene, overlay: { game: g ? { last: g.last, lifted: g.lifted, diff: g.diff, status: g.status } : null, director: bus.director, hint: bus.engineHint, clock: bus.clockView } }));
    }
    if (now - lastHud > 250) {
      profiler.begin("hud");
      lastHud = now; worstMs = 0;      const g = bus.game, b = bus.board;
      const tot = [...graph.stats.values()].reduce((a, s) => a + s.ms, 0);
      refreshNext();
      hud.innerHTML = [
        `<span class="chip${chipTone.board(b ? b.fidelity : 0)}" data-tip="Board fidelity" data-tip-body="How sure the fused cameras are about all 64 squares." data-tip-rows="Reading:${b ? Math.round(b.fidelity * 100) : 0}%:${b ? b.fidelity : 0}|Healthy:above 80%">${chipIcons.board(b ? b.fidelity : 0)}board ${b ? Math.round(b.fidelity * 100) : 0}%</span>`,
        `<span class="chip${chipTone.move(g ? g.moveFidelity : 0)}" data-tip="Move confidence" data-tip-body="How sure the tracker is that the last move really happened." data-tip-rows="Reading:${g ? Math.round(g.moveFidelity * 100) : 0}%:${g ? g.moveFidelity : 0}|Healthy:above 80%">${chipIcons.move(g ? g.moveFidelity : 0)}move ${g ? Math.round(g.moveFidelity * 100) : 0}%</span>`,
        `<span class="chip${chipTone.fps(1000 / frameMs)}" data-tip="Frame rate" data-tip-body="How smoothly the page is drawing. Lag spikes mean something is hogging the main thread." data-tip-rows="Average:${frameMs.toFixed(1)} ms|Worst recently:${worstMs.toFixed(0)} ms">${chipIcons.fps(1000 / frameMs)}${Math.round(1000 / frameMs)} fps</span>`,
        `<span class="chip${chipTone.cam(bus.cameras.length)}" data-tip="Cameras" data-tip-body="Cameras currently feeding the workflow." data-tip-rows="Active:${bus.cameras.length}">${chipIcons.cam(bus.cameras.length)}${bus.cameras.length} cam</span>`,
        `<span class="chip" data-tip="Director phase" data-tip-body="What the experience director is doing right now.">${chipIcons.phase(bus.director?.phase ?? "idle")}${bus.director?.phase ?? "idle"}</span>`,
        `<span class="chip${chipTone.tick(tot / 66)}" data-tip="Tick cost" data-tip-body="Total time every node spent on the last graph tick. The graph runs at 15 ticks per second." data-tip-rows="Budget:66 ms|Used:${tot.toFixed(1)} ms:${tot / 66}">${chipIcons.tick(tot / 66)}${tot.toFixed(1)} ms/tick</span>`,
        editChips(),
      ].join("");
      const l = bus.lines[bus.lines.length - 1];
      const text = l ? `${l.name}: ${l.text}` : "";
      if (text !== lastLine) { lastLine = text; sub.textContent = text; sub.className = l ? `A${l.speaker}` : ""; }
      profiler.end();
    }
    profiler.endFrame();
  };
  const start = () => { const loop = (now: number) => { step(now); requestAnimationFrame(loop); }; requestAnimationFrame(loop); };

  // ---- routing: the URL hash always mirrors the page (and setup step) on screen
  const stepIds = STEPS.map((x) => x.id);
  let route: Route = { page: "table" };
  const nextEl = document.getElementById("next")!;
  let nextKey = "";
  const doSuggestion = (s: Suggestion) => { if (s.to) go(s.to); else if (s.action === "sound") doSound(); else if (s.action === "export") doExport(); };
  function refreshNext(force = false) {
    const b = bus.board;
    const list = suggestNext({ route, setupDone: !!loadSetup()?.completed, soundOn, boardFidelity: b ? b.fidelity : 0, cameras: graph.nodes.size ? 1 : 0 });
    const key = list.map((x) => x.id).join("|");
    if (!force && key === nextKey) return;
    nextKey = key;
    nextEl.replaceChildren();
    const lead = document.createElement("span"); lead.className = "next-lead"; lead.innerHTML = `${icon("spark", 14)}<span>Next</span>`; nextEl.append(lead);
    list.forEach((s, i) => {
      const b = document.createElement("button"); b.type = "button"; b.className = `next-card${i === 0 ? " primary" : ""}`; b.title = s.hint;
      b.innerHTML = `<span class="next-ic">${icon(s.icon, 18)}</span><span class="next-tx"><b></b><small></small></span>`;
      b.querySelector("b")!.textContent = s.title; b.querySelector("small")!.textContent = s.hint;
      b.onclick = () => doSuggestion(s);
      nextEl.append(b);
    });
  }
  /** Show `r` without touching the URL. */
  function apply(r: Route) {
    route = r;
    if (r.page === "setup") { openWizard(); if (r.step) wiz?.setStep(r.step); }
    else { if (wiz && loadSetup()?.completed) closeWizard(); show(PAGES.indexOf(r.page)); }
    document.title = routeTitle(r, r.page === "setup" ? STEPS.find((x) => x.id === r.step)?.title : undefined);
    document.body.dataset.page = r.page;
    refreshNext(true);
  }
  /** Navigate: show it and push a history entry so Back works. */
  function go(r: Route, replace = false) {
    if (r.page !== "setup" && !loadSetup()?.completed) r = { page: "setup", step: wiz?.stepId ?? stepIds[loadPrefs().draft?.step ?? 0] ?? stepIds[0] };
    if (sameRoute(r, route) && location.hash === formatRoute(r)) return;
    apply(r);
    const h = formatRoute(r);
    if (location.hash !== h) {
      try { (replace ? history.replaceState : history.pushState).call(history, null, "", h); } catch { location.hash = h; }
    }
  }
  const fromUrl = () => {
    const done = !!loadSetup()?.completed, p = loadPrefs();
    const tab = p.tab !== undefined && p.tab >= 0 && p.tab < PAGES.length ? p.tab : 0;
    go(location.hash ? parseRoute(location.hash, stepIds) : done ? { page: PAGES[tab] } : { page: "setup", step: stepIds[p.draft?.step ?? 0] ?? stepIds[0] }, true);
  };
  const onUrl = () => { const r = parseRoute(location.hash, stepIds); if (!sameRoute(r, route)) go(r, true); };
  window.addEventListener("popstate", onUrl);
  window.addEventListener("hashchange", onUrl);
  window.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement | null;
    if (e.ctrlKey || e.metaKey || e.altKey || wiz || (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName))) return;
    const i = ["1", "2", "3", "4"].indexOf(e.key);
    if (i >= 0) { e.preventDefault(); go({ page: PAGES[i] }); }
    else if (e.key === ",") { e.preventDefault(); go({ page: "setup", step: stepIds[0] }); }
  });

  // ---- guided setup (first run, or reopened from the top bar)
  const sfx = new Sfx(), audio = new AudioEngine();
  let wiz: SetupWizard | null = null;
  /** Auto-save: rebuild the workflow behind the dialog whenever the setup changes, so edits show up live. */
  let liveTimer: ReturnType<typeof setTimeout> | undefined, liveKey = JSON.stringify(setup ?? null);
  const liveApply = (c: SetupConfig) => {
    const k = JSON.stringify(c);
    if (k === liveKey) return;
    liveKey = k;
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => {
      if (!wiz) return;
      const snap = structuredClone(c);
      saveSetup({ ...snap, completed: loadSetup()?.completed ?? false });
      buildGraphFromConfig(graph, snap); editor.rebuild(); persist(); // an undo step, so a setup change can be taken back
    }, 250);
  };
  const openWizard = () => {
    if (wiz) return;
    const draft = loadPrefs().draft;
    const cfg = structuredClone(draft?.cfg ?? loadSetup() ?? defaultSetup());
    wiz = new SetupWizard(cfg, {
      onProgress: (c, step) => { patchPrefs({ draft: { cfg: c, step } }); liveApply(c); },
      listCameras, openCamera, detectEnv, sfx, speak: speakLine,
      thunder: () => { audio.start(); audio.play({ do: "thunder", strength: 0.8 }); },
      onFinish: (done: SetupConfig) => { patchPrefs({ draft: null }); addBackup("Before setup", graph.toJSON(), loadSetup(), true); saveSetup(done); buildGraphFromConfig(graph, done); editor.rebuild(); persist(); closeWizard(); go({ page: "table" }); },
      onStep: (id) => { if (!wiz || (route.page === "setup" && route.step === id)) return; go({ page: "setup", step: id }); },
      canCancel: () => !!loadSetup()?.completed,
      onCancel: () => { if (loadSetup()?.completed) { patchPrefs({ draft: null }); closeWizard(); go({ page: "table" }); } },
    }, draft?.step ?? 0);
    wiz.mount(document.body);
  };
  const closeWizard = () => { wiz?.destroy(); wiz = null; };
  document.getElementById("home")!.onclick = (e) => { e.preventDefault(); go({ page: PAGES[0] }); };
  document.getElementById("setup")!.onclick = () => go({ page: "setup", step: wiz?.stepId ?? stepIds[0] });
  fromUrl();

  return { graph, editor, go, route: () => route, step, start, openWizard, wizard: () => wiz };
}
