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
import { startFxAudio } from "./plugins/fx";
import { AudioEngine } from "./scene/audio";
import { mixer, type Bus, type MixState } from "./scene/mixer";
import { speakLine } from "./plugins/narration";
import { buildGraphFromConfig, clearSetup, defaultSetup, loadSetup, saveSetup, withDefaults, type SetupConfig } from "./setup/config";
import { listCameras, openCamera } from "./setup/devices";
import { detectEnv } from "./setup/system";
import { Sfx } from "./ui/sfx";
import { SetupWizard } from "./ui/wizard";
import { NodeEditor } from "./ui/editor";
import { editorTips } from "./ui/editorTips";
import { installTooltips } from "./ui/tooltip";
import { clearPrefs, loadPrefs, patchPrefs } from "./setup/prefs";
import { History } from "./core/history";
import { addBackup, ago, beatSession, closeSession, deleteBackup, listBackups, openSession, type Backup } from "./setup/backups";
import { CE_EXTENSION, ceFileName, parseCe, serializeCe } from "./setup/ceFile";
import { notify, openBackupPanel } from "./ui/recovery";
import { virtualTable } from "./sim/virtualTable";
import { RemoteHost, applyRemoteMove, playMode, snapshot } from "./remote/host";
import type { GrayFrame } from "./vision/types";
import { openAiWizard, openWorkflowPanel } from "./ui/workflows";
import { openPlayNow } from "./ui/playNow";
import { buildBotPlay } from "./setup/botPlay";
import { KNIGHT_SVG } from "./ui/brandIcon";
import { LogPanel, TablePanel, WorldPanel } from "./ui/panels";
import { PerfPanel } from "./ui/perfPanel";
import { profiler } from "./core/profiler";
import "./ui/perf.css";
import type { GraphJSON } from "./core/types";
import { STEPS } from "./ui/wizardSteps";
import { icon, withIcon } from "./ui/icons";
import { BUILD, buildBadge, ciBadge, latestCi, type CiRun } from "./setup/buildInfo";
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
  let setup = loadSetup();
  if (!graph.nodes.size) {
    if (!setup && !loadPrefs().draft) {
      // First run: skip the guided setup and sit the player down against Stockfish (simulated, mouse, White). Setup stays reachable from the top bar.
      const r = buildBotPlay(registry, { start: "me-white", presence: "simulated", elo: 1200 }, null);
      graph.load(r.graph); saveSetup(r.setup); setup = r.setup;
    } else buildGraphFromConfig(graph, setup ?? defaultSetup());
  }
  const save = (json: GraphJSON = graph.toJSON()) => { try { localStorage.setItem(KEY, JSON.stringify(json)); } catch { /* quota */ } };
  const edits = new History<GraphJSON>(graph.toJSON());
  let dirty = false;
  const sig = () => `${graph.nodes.size}:${graph.edges.length}:${graph.groups.length}`;
  /** Undo / redo chips on the bar: static buttons, repainted only when their numbers change, so a click is never lost to a redraw. */
  let histKey = "";
  const syncHistChips = () => {
    const key = `${edits.undoCount}|${edits.redoCount}`;
    if (key === histKey) return;
    histKey = key;
    for (const [id, n, on, kind] of [["hudundo", edits.undoCount, edits.canUndo, "undo"], ["hudredo", edits.redoCount, edits.canRedo, "redo"]] as const) {
      const b = document.getElementById(id) as HTMLButtonElement | null;
      if (!b) continue;
      b.innerHTML = `${kind === "undo" ? chipIcons.undo(n) : chipIcons.redo(n)}${n}`;
      b.disabled = !on; b.classList.toggle("on", on);
      b.dataset.tipRows = kind === "undo" ? `Undo steps:${n}|Limit:100` : `Redo steps:${n}`;
      b.dataset.tipBody = kind === "undo" ? "Steps you can go back (Ctrl+Z). Oldest are dropped after 100." : "Steps you undid and can bring back (Ctrl+Y). Any new edit clears them.";
    }
  };
  const syncUndo = () => { for (const [id, ok] of [["undo", edits.canUndo], ["redo", edits.canRedo]] as const) { const b = document.getElementById(id) as HTMLButtonElement | null; if (b) b.disabled = !ok; } syncHistChips(); };
  const kb = (chars: number) => chars < 1024 * 100 ? `${(chars / 1024).toFixed(1)} KB` : chars < 1024 * 1024 * 10 ? `${(chars / 1048576).toFixed(2)} MB` : `${(chars / 1048576).toFixed(1)} MB`;
  /** Top-bar chips: action count, undo / redo depth, workflow size, history memory, browser storage and heap. */
  let stored = 0, storedAt = 0;
  /** Each chip with its health tone (" g", " y", " o", " r" or "" when it has none). */
  type Hud = { html: string; tone: string };
  const editChips = (): Hud[] => {
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const t = Date.now();
    if (t - storedAt > 2000) { storedAt = t; stored = 0; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; stored += k.length + (localStorage.getItem(k)?.length ?? 0); } } catch { /* storage unavailable */ } }
    const out: Hud[] = [
      { tone: "", html: `<span class="chip" data-tip="Actions" data-tip-body="Edits to the workflow this session. A drag counts once." data-tip-rows="Recorded:${edits.actions}|Nodes:${graph.nodes.size}|Wires:${graph.edges.length}">${chipIcons.actions(edits.actions)}${edits.actions} actions</span>` },
      { tone: chipTone.workflow(edits.patchChars / 1024), html: `<span class="chip${chipTone.workflow(edits.patchChars / 1024)}" data-tip="Workflow size" data-tip-body="Size of the node graph as saved JSON." data-tip-rows="Workflow:${kb(edits.patchChars)}|Nodes:${graph.nodes.size}|Wires:${graph.edges.length}|Unsaved backup:${dirty ? "yes" : "no"}">${chipIcons.workflow(edits.patchChars / 1024)}workflow ${kb(edits.patchChars)}</span>` },
      { tone: chipTone.hist(edits.chars / 1024), html: `<span class="chip${chipTone.hist(edits.chars / 1024)}" data-tip="History memory" data-tip-body="Memory held by every undo and redo snapshot." data-tip-rows="Snapshots:${edits.undoCount + edits.redoCount + 1}|Total:${kb(edits.chars)}">${chipIcons.hist(edits.chars / 1024)}hist ${kb(edits.chars)}</span>` },
      { tone: chipTone.store(stored / 5242880), html: `<span class="chip${chipTone.store(stored / 5242880)}" data-tip="Browser storage" data-tip-body="Everything this site keeps in localStorage: workflow, settings, backups, preferences. Browsers allow about 5 MB." data-tip-rows="Used:${kb(stored)}|Typical limit:5 MB:${stored / 5242880}">${chipIcons.store(stored / 5242880)}store ${kb(stored)}</span>` },
    ];
    if (mem) out.push({ tone: chipTone.heap(mem.usedJSHeapSize / 1048576), html: `<span class="chip${chipTone.heap(mem.usedJSHeapSize / 1048576)}" data-tip="JS heap" data-tip-body="Memory used by the page's JavaScript (Chromium only).">${chipIcons.heap(mem.usedJSHeapSize / 1048576)}heap ${(mem.usedJSHeapSize / 1048576).toFixed(0)} MB</span>` });
    return out;
  };
  /** Every edit: autosave, remember an undo step, mark the workflow as changed since the last backup. */
  const persist = () => { const json = graph.toJSON(); save(json); dirty = true; edits.record(json, Date.now(), sig()); syncUndo(); }; // one snapshot shared by autosave and undo

  const app = root;
  app.innerHTML = `
    <header>
      <a class="brand" id="home" href="#/table" aria-label="Chess XP home" data-tip="Chess XP" data-tip-body="Back to the start page.">${KNIGHT_SVG}<span>Chess XP</span></a>
      <nav class="rtabs" role="tablist" aria-label="Ribbon">
        <button role="tab" class="on" data-rtab="home" aria-selected="true">${icon("home", 16)}<span>Home</span></button>
        <button role="tab" data-rtab="view" aria-selected="false">${icon("eye", 16)}<span>View</span></button>
        <button role="tab" data-rtab="tools" aria-selected="false">${icon("tools", 16)}<span>Tools</span></button>
        <div class="spacer"></div>
        <div class="chips" id="hud"></div>
        <div class="chips" id="buildchips"></div>
        <button id="scenpause" class="scen-pause" type="button" disabled aria-label="Pause scenario" data-tip="Pause scenario" data-tip-body="Holds the scenario player between moves while a game is replaying. Press again to resume.">${icon("pause", 16)}<span class="lbl">Pause</span></button>
        <div class="chips" id="hist">
          <button id="hudundo" class="chip" type="button" disabled aria-label="Undo" data-act="undo" data-tip="Undo" data-tip-keys="Ctrl,Z" data-tip-body="Step back through your edits to the workflow."></button>
          <button id="hudredo" class="chip" type="button" disabled aria-label="Redo" data-act="redo" data-tip="Redo" data-tip-keys="Ctrl,Y" data-tip-body="Bring back an edit you undid."></button>
        </div>
        <div class="rdrop hud-more">
          <button id="hudmore" class="chip" type="button" aria-haspopup="menu" aria-expanded="false" aria-label="More stats" data-tip="More stats" data-tip-body="Healthy readings (green) are kept here. Anything that needs attention stays on the bar."><span>⋯</span></button>
          <div class="rmenu hud-menu" id="hudmenu" role="menu" hidden></div>
        </div>
      </nav>
      <div class="ribbon" role="tabpanel">
        <div class="rpane on" data-rpane="home">
          <div class="rgroup"><div class="rbtns">
            <button id="openfile" class="rb" data-tip="Open" data-tip-keys="Ctrl,O" data-tip-body="Load a workflow file you saved earlier. The current one is backed up first.">${icon("open", 22)}<span>Open</span></button>
            <button id="export" class="rb" data-tip="Save" data-tip-keys="Ctrl,S" data-tip-body="Download the workflow as a JSON file you can keep or share. Lights up when there are changes since the last backup.">${icon("save", 22)}<span>Save</span></button>
          </div><div class="rlabel">File</div></div>
          <div class="rgroup"><div class="rbtns">
            <button id="playnow" class="rb" data-tip="Play now against bot" data-tip-body="Start a game against Stockfish right away. Choose who starts, and whether you are simulated (mouse) or real (webcams).">${icon("film", 22)}<span>Play bot</span></button>
            <button id="workflows" class="rb" data-tip="Demos" data-tip-body="Load a ready-made demo workflow. The current one is backed up first.">${icon("film", 22)}<span>Demos</span></button>
            <button id="aiwiz" class="rb" data-tip="Build with AI" data-tip-body="Describe what you want and a model drafts the workflow. You review it before anything changes.">${icon("wand", 22)}<span>Build with AI</span></button>
            <button id="settings" class="rb" data-tip="Settings" data-tip-body="Cameras, projector, narration, and players.">${icon("setup", 22)}<span>Settings</span></button>
            <button id="phone" class="rb" data-tip="Phone remote" data-tip-body="Watch the moves, see the camera and play from a phone on the same Wi-Fi.">${icon("people", 22)}<span>Phone</span></button>
          </div><div class="rlabel">Start</div></div>
          <div class="rgroup"><div class="rbtns">
            <button id="undo" class="rb" disabled aria-label="Undo" data-tip="Undo" data-tip-keys="Ctrl,Z" data-tip-body="Step back through your edits to the workflow.">${icon("undo", 22)}<span>Undo</span></button>
            <button id="redo" class="rb" disabled aria-label="Redo" data-tip="Redo" data-tip-keys="Ctrl,Y" data-tip-body="Bring back an edit you undid.">${icon("redo", 22)}<span>Redo</span></button>
            <button id="organize" class="rb" data-tip="Organize" data-tip-body="Lay the workflow out in bands: input, analysis, game, output. Undo with Ctrl+Z.">${icon("grid", 22)}<span>Organize</span></button>
            <button id="addsec" class="rb" data-tip="New section" data-tip-body="Wrap the selected nodes (or the middle of the view) in a titled, coloured frame.">${icon("frame", 22)}<span>Section</span></button>
          </div><div class="rlabel">Edit</div></div>
          <div class="rgroup rgroup-sel" id="selgroup"><div class="rbtns">
            <button id="seldup" class="rb" disabled data-tip="Duplicate" data-tip-body="Copy the selected nodes next to themselves, with the same settings.">${icon("duplicate", 22)}<span>Duplicate</span></button>
            <button id="selbypass" class="rb" disabled data-tip="Bypass" data-tip-body="Skip the selected nodes without deleting them. Click again to turn them back on.">${icon("bypass", 22)}<span>Bypass</span></button>
            <button id="seldel" class="rb" disabled data-tip="Delete" data-tip-tag="destructive" data-tip-color="#ff7070" data-tip-body="Remove the selected nodes and their wires.">${icon("trash", 22)}<span>Delete</span></button>
          </div><div class="rlabel" id="sellabel">Select nodes</div></div>
          <div class="rgroup"><div class="rbtns">
            <button id="backups" class="rb" data-tip="Restore points" data-tip-body="Earlier versions of your workflow, crash recovery, import and export.">${icon("layers", 22)}<span>Restore</span></button>
            <button id="backupnow" class="rb" data-tip="Backup now" data-tip-body="Keep a restore point of the workflow as it is right now.">${icon("plus", 22)}<span>Backup now</span></button>
            <div class="rdrop"><button id="more" class="rb" aria-haspopup="menu" aria-expanded="false" data-tip="More" data-tip-body="Reset the workflow to the default."><span class="ic-slot"></span><span>More ▾</span></button>
              <div class="rmenu" role="menu" hidden>
                <button id="reset" role="menuitem" data-tip="Reset workflow" data-tip-tag="destructive" data-tip-color="#ff7070" data-tip-body="Discards your saved node layout and settings, then reloads the page."><span class="ic-slot"></span>Reset workflow</button>
              </div></div>
          </div><div class="rlabel">Backups</div></div>
        </div>
        <div class="rpane" data-rpane="view">
          <div class="rgroup"><div class="rbtns">
            <button id="heat" class="rb" data-tip="Node timings" data-tip-body="Show each node's cost on the workflow: a share bar, a sparkline of recent ticks, and avg / p95 / max milliseconds.">${icon("gauge", 22)}<span>Timings</span></button>
          </div><div class="rlabel">Graph</div></div>
          <div class="rgroup"><div class="rbtns">
            <select id="theme" aria-label="Theme" data-tip="Theme" data-tip-body="Pick the look of the whole app.">${APP_THEMES.map((t) => `<option value="${t.id}">${t.name}</option>`).join("")}</select>
            <button id="mode" class="rb" data-tip="Light / dark" data-tip-body="Cycle dark, light, or follow the system.">${icon("contrast", 22)}<span class="lbl"></span></button>
          </div><div class="rlabel">Theme</div></div>
        </div>
        <div class="rpane" data-rpane="tools">
          <div class="rgroup"><div class="rbtns">
            <button id="audio" class="rb" data-tip="Sound" data-tip-body="Browsers keep audio locked until you click. The first click starts the engine; after that it mutes and unmutes."><span class="ic-slot"></span><span class="lbl">Enable sound</span></button>
            <button id="mixer" class="rb" data-tip="Mixer" data-tip-body="Levels for master, ambience, sound effects, music and narrators, plus mute."><span class="ic-slot"></span><span class="lbl">Mixer</span></button>
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

  const tips = installTooltips().add(editorTips(graph));
  // ---- ribbon: tab headers switch panes; "File" dropdown closes on outside click / Escape
  for (const t of app.querySelectorAll<HTMLElement>("[data-rtab]")) t.onclick = () => {
    for (const o of app.querySelectorAll<HTMLElement>("[data-rtab]")) { const on = o === t; o.classList.toggle("on", on); o.setAttribute("aria-selected", String(on)); }
    for (const p of app.querySelectorAll<HTMLElement>("[data-rpane]")) p.classList.toggle("on", p.dataset.rpane === t.dataset.rtab);
  };
  const moreBtn = document.getElementById("more")!, moreMenu = moreBtn.parentElement!.querySelector<HTMLElement>(".rmenu")!;
  const setMenu = (open: boolean) => { moreMenu.hidden = !open; moreBtn.setAttribute("aria-expanded", String(open)); };
  moreBtn.onclick = (e) => { e.stopPropagation(); setMenu(moreMenu.hidden === true); };
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
  if (prefs.view) editor.setView(prefs.view);
  let viewTimer: ReturnType<typeof setTimeout> | undefined;
  editor.onView = () => { clearTimeout(viewTimer); viewTimer = setTimeout(() => patchPrefs({ view: editor.getView() }), 400); };
  document.getElementById("graph")!.append(editor.root);
  const tools = document.createElement("div"); tools.className = "ne-tools";
  const tool = (label: string, ic: string, tip: string, body: string, fn: () => void) => { const b = document.createElement("button"); b.type = "button"; b.textContent = label; withIcon(b, ic, 15); b.dataset.tip = tip; b.dataset.tipBody = body; b.onclick = fn; tools.append(b); return b; };
  tool("Section", "plus", "Add section", "Wrap the selected nodes (or the middle of the view) in a titled, coloured frame. Drag its title to move everything inside.", () => editor.addGroup());
  tool("Organize", "grid", "Organize into sections", "Lay the workflow out in bands: demo & input, analysis, game & experience, output (sound & narration). Undo with Ctrl+Z.", () => editor.organize());
  document.getElementById("graph")!.append(tools);

  const table = new TablePanel(); tips.add(table.tips);
  const world = new WorldPanel(graph), log = new LogPanel(); tips.add(log.tips);
  const perf = new PerfPanel(graph, { reveal: (id) => editor.reveal(id), setHeat: (on) => setHeat(on), heatOn: () => editor.heatOn });
  tips.add(perf.tips);
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
  const show = (i: number) => { active = i; profiler.enabled = i === 3; patchPrefs({ tab: i }); dock.replaceChildren(panels[i][1].root); [...tabs.children].forEach((b, k) => { b.classList.toggle("on", k === i); if (k === i) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); }); };
  const TAB_INFO = ["Virtual table: click a piece, then a square, or seat a player.", "3D board and projection-mapping preview.", "Live event and narration log.", "Frame timeline, flamegraph and per-node cost. Open it to start capturing."];
  panels.forEach(([name], i) => { const b = document.createElement("button"); b.innerHTML = `${icon(["table", "world", "log", "perf"][i])}<span>${name}</span><kbd>${i + 1}</kbd>`; b.dataset.tip = name; b.dataset.tipBody = TAB_INFO[i]; b.onclick = () => go({ page: PAGES[i] }); tabs.append(b); });
  show(prefs.tab !== undefined && prefs.tab >= 0 && prefs.tab < panels.length ? prefs.tab : 0);

  table.seatCb = (seated) => { for (const n of graph.nodes.values()) if (n.type === "sim.person") n.params.seated = seated; };
  let soundOn = false;
  const soundLabel = () => { document.getElementById("audio")!.querySelector(".lbl")!.textContent = soundOn && !mixer.get().muted ? "Sound on" : "Sound off"; };
  const doSound = () => { if (!soundOn) { startAudio(graph); startFxAudio(graph); soundOn = true; } mixer.setMuted(false); patchPrefs({ sound: true }); soundLabel(); refreshNext(true); };
  const toggleSound = () => { if (!soundOn) { doSound(); return; } const muted = mixer.toggleMuted(); patchPrefs({ sound: !muted }); soundLabel(); refreshNext(true); };
  document.getElementById("audio")!.onclick = toggleSound;

  // mixer popover: one slider per bus, plus a mute-all switch. Opens under its button; closes on an outside click.
  const MIX_ROWS: [("master" | Bus), string][] = [["master", "Master"], ["ambience", "Ambience"], ["sfx", "Sound effects"], ["music", "Music"], ["narration", "Narrators"]];
  const mixBtn = document.getElementById("mixer")!;
  const mixPanel = document.createElement("div");
  mixPanel.hidden = true; mixPanel.setAttribute("role", "dialog"); mixPanel.setAttribute("aria-label", "Mixer");
  mixPanel.style.cssText = "position:fixed;z-index:1000;min-width:240px;padding:10px 12px;display:grid;gap:8px;background:var(--panel,#1b1f27);color:var(--text,inherit);border:1px solid var(--border,#3a4150);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.35);font-size:12px";
  mixPanel.innerHTML = MIX_ROWS.map(([k, l]) => `<label style="display:grid;grid-template-columns:110px 1fr 40px;gap:8px;align-items:center"><span>${l}</span><input type="range" min="0" max="100" step="1" data-bus="${k}"><output style="text-align:right"></output></label>`).join("")
    + `<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="mixmute"><span>Mute all</span></label>`;
  document.body.append(mixPanel);
  const syncMix = (s: Readonly<MixState>) => {
    for (const [k] of MIX_ROWS) {
      const inp = mixPanel.querySelector<HTMLInputElement>(`[data-bus="${k}"]`)!, pct = Math.round(s[k] * 100);
      inp.value = String(pct); inp.nextElementSibling!.textContent = `${pct}%`;
    }
    mixPanel.querySelector<HTMLInputElement>("#mixmute")!.checked = s.muted;
    soundLabel();
  };
  for (const inp of mixPanel.querySelectorAll<HTMLInputElement>("input[data-bus]")) inp.oninput = () => mixer.set(inp.dataset.bus as "master" | Bus, Number(inp.value) / 100);
  mixPanel.querySelector<HTMLInputElement>("#mixmute")!.onchange = (e) => { const m = (e.target as HTMLInputElement).checked; if (!m && !soundOn) doSound(); else { mixer.setMuted(m); patchPrefs({ sound: !m }); } soundLabel(); };
  mixer.subscribe(syncMix); syncMix(mixer.get());
  mixBtn.onclick = () => {
    mixPanel.hidden = !mixPanel.hidden;
    const r = mixBtn.getBoundingClientRect(); mixPanel.style.left = `${r.left}px`; mixPanel.style.top = `${r.bottom + 6}px`;
  };
  document.addEventListener("pointerdown", (e) => { if (!mixPanel.hidden && !mixPanel.contains(e.target as Node) && e.target !== mixBtn) mixPanel.hidden = true; });
  // top-right build chips: how old this build is, its commit, and the latest CI run on main (links to it)
  const buildChips = document.getElementById("buildchips")!;
  let ci: CiRun | null | undefined;
  const drawBuild = () => {
    buildChips.replaceChildren();
    for (const v of [buildBadge(BUILD, ci), ciBadge(ci)]) {
      const chip = document.createElement(v.href ? "a" : "span");
      chip.className = `chip ${v.tone}`.trim(); chip.textContent = v.text;
      chip.dataset.tip = v.href ? "Latest CI run" : "Build"; chip.dataset.tipBody = v.tip;
      if (v.href) { const a = chip as HTMLAnchorElement; a.href = v.href; a.target = "_blank"; a.rel = "noopener noreferrer"; }
      buildChips.append(chip);
    }
  };
  const askCi = () => { void latestCi().then((r) => { ci = r; drawBuild(); }); };
  drawBuild(); askCi();
  setInterval(drawBuild, 30_000); setInterval(askCi, 300_000);
  for (const [id, name] of [["audio", "sound"], ["mixer", "wave"], ["more", "sliders"], ["reset", "refresh"]]) document.querySelector(`#${id} .ic-slot`)!.outerHTML = icon(name, 22);
  document.getElementById("reset")!.onclick = () => notify("This clears the saved workflow, setup and preferences, then reloads the page.", [{ label: "Reset workflow", run: () => { addBackup("Before reset", graph.toJSON(), loadSetup(), false); localStorage.removeItem(KEY); clearSetup(); clearPrefs(); location.reload(); } }], "warn", { title: "Reset this workflow?" });
  const doExport = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([serializeCe(graph.toJSON(), loadSetup())], { type: "application/json" })); a.download = ceFileName(); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
  document.getElementById("export")!.onclick = doExport;

  // ---- undo / redo, backups, crash recovery
  const loadState = (g: GraphJSON) => { graph.load(g); editor.rebuild(); save(); syncUndo(); };
  const stepState = (g: GraphJSON) => { graph.restore(g); editor.rebuild(); save(); dirty = true; syncUndo(); }; // in place: nothing restarts
  const undo = () => { const s = edits.undo(); if (s) stepState(s); };
  const redo = () => { const s = edits.redo(); if (s) stepState(s); };
  document.getElementById("undo")!.onclick = undo;
  document.getElementById("redo")!.onclick = redo;
  document.getElementById("hudundo")!.onclick = undo;
  document.getElementById("hudredo")!.onclick = redo;
  window.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || wiz) return;
    if ((e.target as HTMLElement | null)?.closest?.("input:not([type=range]):not([type=checkbox]),textarea,select,[contenteditable]")) return;
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); redo(); }
    else if (k === "s") { e.preventDefault(); doExport(); }
    else if (k === "o") { e.preventDefault(); openInput.click(); }
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
  const importFile = (f: File) => { void f.text().then((t) => { const p = parseCe(t); if (p.ok) restore(p.graph, p.setup, "Before import"); else notify(p.error, [], "warn", { title: "Couldn't import file", details: [`File: ${f.name}`, "Chess Experience files are .json files exported from this app (Backups → Export file).", "Your current workflow was not changed."] }); }); };
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
  // ---- ribbon actions: File, Start, Edit, Selection, Backups. Their state follows the editor's selection.
  const wfApi = { registry, current: () => graph.toJSON(), apply: restore, openFile: importFile };
  const openInput = document.createElement("input"); openInput.type = "file"; openInput.accept = `${CE_EXTENSION},application/json,.json`; openInput.hidden = true;
  openInput.onchange = () => { const f = openInput.files?.[0]; openInput.value = ""; if (f) importFile(f); };
  document.body.append(openInput);
  document.getElementById("openfile")!.onclick = () => openInput.click();
  document.getElementById("workflows")!.onclick = () => openWorkflowPanel(wfApi);
  document.getElementById("playnow")!.onclick = () => openPlayNow(wfApi, () => go({ page: "table" }));
  document.getElementById("aiwiz")!.onclick = () => openAiWizard(wfApi);
  document.getElementById("backupnow")!.onclick = () => { addBackup("Manual backup", graph.toJSON(), loadSetup(), false); };
  document.getElementById("addsec")!.onclick = () => editor.addGroup();
  document.getElementById("organize")!.onclick = () => editor.organize();
  document.getElementById("seldup")!.onclick = () => { for (const id of editor.selection()) editor.duplicate(id); };
  document.getElementById("selbypass")!.onclick = () => { for (const id of editor.selection()) editor.toggleBypass(id); syncRibbon(); };
  document.getElementById("seldel")!.onclick = () => { for (const id of editor.selection()) editor.removeNode(id); };
  /** Enable and label the selection actions for what is selected; light the Save dot while there are unsaved changes. */
  function syncRibbon() {
    const sel = editor.selection(), n = sel.length, btn = (id: string) => document.getElementById(id) as HTMLButtonElement;
    for (const id of ["seldup", "selbypass", "seldel"]) btn(id).disabled = n === 0;
    btn("selbypass").classList.toggle("on", n > 0 && sel.every((id) => !!graph.nodes.get(id)?.bypass));
    document.getElementById("sellabel")!.textContent = n ? `${n} selected` : "Select nodes";
    document.getElementById("selgroup")!.classList.toggle("idle", n === 0);
    btn("export").classList.toggle("attn", dirty);
  }
  editor.onSelect = () => syncRibbon();
  editor.onChange = () => { persist(); syncRibbon(); };
  syncRibbon();
  window.addEventListener("pagehide", () => { if (dirty) addBackup("On exit", graph.toJSON(), loadSetup(), true); closeSession(); });
  if (prefs.sound !== false) { // a first visit has no preference yet: the first click or key should turn sound on
    const arm = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("#audio,#mixer,#mixmute")) return; // those controls toggle sound themselves; arming here would mute them again
      window.removeEventListener("pointerdown", arm, true); window.removeEventListener("keydown", arm, true);
      if (!soundOn) doSound();
    };
    window.addEventListener("pointerdown", arm, true); window.addEventListener("keydown", arm, true);
  }
  if (recovered) notify(`Your saved workflow could not be read, so the backup from ${ago(recovered.t)} was restored.`, [{ label: "Open backups", run: panel }], "warn", { title: "Saved workflow restored from backup", details: ["The autosaved copy was unreadable, so the most recent backup was loaded instead.", "Edits made after that backup may be missing."] });
  else if (crashed) { addBackup("Recovered after crash", graph.toJSON(), loadSetup(), true); notify("CE did not close cleanly last time. Everything up to your last edit was autosaved.", [{ label: "Open backups", run: panel }], "warn", { title: "Recovered after unexpected exit", details: ["A recovery backup was just created from your last autosave.", "Open backups if something looks wrong."] }); }

  const hud = document.getElementById("hud")!, sub = document.getElementById("sub")!;
  // ---- top bar: healthy readings live under ⋯; the Pause button holds a running scenario
  const hudMore = document.getElementById("hudmore") as HTMLButtonElement, hudMenu = document.getElementById("hudmenu")!;
  const setHudMenu = (open: boolean) => { hudMenu.hidden = !open; hudMore.setAttribute("aria-expanded", String(open)); };
  hudMore.onclick = (e) => { e.stopPropagation(); setHudMenu(hudMenu.hidden === true); };
  document.addEventListener("click", () => setHudMenu(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setHudMenu(false); });
  const scenPause = document.getElementById("scenpause") as HTMLButtonElement;
  /** A scenario is "playing" while any Scenario Player node has Play on. Pause is only offered then. */
  const scenarioPlaying = () => [...graph.nodes.values()].some((n) => n.type === "sim.scenario" && !!n.params.play);
  const syncScenarioPause = () => {
    const playing = scenarioPlaying();
    if (!playing) bus.scenarioPaused = false;
    scenPause.disabled = !playing;
    scenPause.classList.toggle("on", bus.scenarioPaused);
    const label = scenPause.querySelector(".lbl")!;
    const text = bus.scenarioPaused ? "Resume" : "Pause";
    if (label.textContent !== text) { label.textContent = text; scenPause.querySelector(".ic")!.outerHTML = icon(bus.scenarioPaused ? "play" : "pause", 16); }
  };
  scenPause.onclick = () => { bus.scenarioPaused = !bus.scenarioPaused; syncScenarioPause(); };
  // ---- clicking the table while two AI players are playing: pause, ask, then swap the AI player for a Desktop Controller
  const takeControl = (color: "w" | "b") => {
    const old = [...graph.nodes.values()].find((n) => n.type === "sim.player" && n.params.color === color);
    const targets = old ? graph.edges.filter((e) => e.from.node === old.id).map((e) => ({ ...e.to })) : [];
    const ctl = graph.addNode("sim.desktop", old?.x ?? 330, old?.y ?? 1620, { color });
    if (old) graph.removeNode(old.id);
    for (const to of targets) graph.connect({ node: ctl.id, port: "player" }, to);
    for (const n of graph.nodes.values()) if (n.type === "sim.scenario") n.params.play = false; // the mouse owns the game now: the script no longer feeds moves
    bus.scenarioPaused = false; syncScenarioPause();
    editor.rebuild(); persist();
  };
  table.takeover = () => {
    if (!scenarioPlaying()) return false;
    if (!bus.scenarioPaused) { bus.scenarioPaused = true; syncScenarioPause(); }
    if (document.querySelector(".notice")) return true; // already asking
    const color = virtualTable.game.turn() as "w" | "b", name = color === "w" ? "White" : "Black";
    notify(`Two AI players are playing and the game is paused. Replace the ${name} AI player with a Desktop Controller so you play ${name} with the mouse?`, [{ label: `Take control of ${name}`, run: () => takeControl(color) }], "info", {
      title: "Do you want to take control?",
      details: ["The scenario stops; the other AI player will not move on its own.", "Undo (Ctrl+Z) puts the AI player back."],
      onDismiss: () => { bus.scenarioPaused = false; syncScenarioPause(); },
    });
    return true;
  };
  let lastTick = 0, lastHud = 0, lastPost = 0, lastLine = "", lastFrame = 0, frameMs = 16.7, worstMs = 0;
  let lastBackup = 0, lastBeat = 0;
  let hudBarHtml = "", hudMenuHtml = "";
  // ---- phone remote: publishes the game to the relay in the dev server and plays the moves a phone sends
  const camFrames = () => [...graph.nodes.values()].flatMap((n) => {
    if (n.type !== "vision.boardReader") return [];
    const f = registry.get(n.type)?.frameOf?.(graph.states.get(n.id)) as GrayFrame | null | undefined;
    const cam = (graph.states.get(n.id) as { sampler?: { cam?: string } } | undefined)?.sampler?.cam;
    return f && cam ? [{ id: cam, frame: f }] : [];
  });
  const virtualBoard = () => {
    const on = (t: string) => [...graph.nodes.values()].some((n) => n.type === t && n.params.online !== false);
    return on("source.synthetic") && !camFrames().some((c) => [...graph.nodes.values()].some((n) => n.type === "source.webcam" && n.params.online !== false && graph.states.get(n.id)?.frame));
  };
  const remote = new RemoteHost({
    base: `${(import.meta as any).env?.BASE_URL ?? "/"}remote/`,
    build: (framed, notice, now) => snapshot(bus, { now, virtualBoard: virtualBoard(), framed, notice }),
    frames: camFrames,
    command: (c, now) => applyRemoteMove(c, { mode: playMode(bus, virtualBoard()), fen: bus.game?.fen ?? virtualTable.game.fen(), bus, table: virtualTable, now: now, botTurn: !!bus.botColor && bus.botColor === bus.game?.turn }),
  });
  document.getElementById("phone")!.onclick = () => {
    if (remote.available === false) notify("Phone access is built into the dev server. Start the app with npm run dev (or start-chess), then open it on this computer as localhost.", [], "warn", { title: "Phone remote is not running" });
    else if (remote.available === null) notify("Still checking for the phone connection. Try again in a second.", [], "info", { title: "Phone remote" });
    else notify(`On a phone using the same Wi-Fi, open the address below and enter the join code ${remote.code} if asked. ${remote.clients ? `${remote.clients} phone${remote.clients === 1 ? " is" : "s are"} connected now.` : "No phone is connected yet."}`,
      [{ label: "Copy address", run: () => { void navigator.clipboard?.writeText(remote.urls[0] ?? "").catch(() => {}); } }], "info",
      { title: "Watch and play from a phone", details: remote.urls.length ? remote.urls : ["No network address found. Connect this computer to Wi-Fi, then open this window again."] });
  };
  const step = (now: number) => {
    remote.tick(now);
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
      profiler.span("scene.post", () => world.post({ type: "state", scene: bus.scene, overlay: { game: g ? { last: g.last, lifted: g.lifted, diff: g.diff, status: g.status } : null, director: bus.director, hint: bus.engineHint, clock: bus.clockView, pieces: bus.pieceView, outline: bus.outline, reconcile: bus.reconcile }, fx: bus.fxSpawns.splice(0) }));
    }
    if (now - lastHud > 250) {
      profiler.begin("hud");
      lastHud = now; worstMs = 0;      const g = bus.game, b = bus.board;
      const tot = [...graph.stats.values()].reduce((a, s) => a + s.ms, 0);
      refreshNext();
      const boardPending = !b || b.settled === false || !!b.handOver; // missing, still warming up, or a hand over the board: not a failed calibration
      const boardT = boardPending ? "" : chipTone.board(b.fidelity), moveT = chipTone.move(g ? g.moveFidelity : 0), fpsT = chipTone.fps(1000 / frameMs), camT = chipTone.cam(bus.cameras.length), tickT = chipTone.tick(tot / 66);
      const boardPct = boardPending ? "…" : `${Math.round(b.fidelity * 100)}%`;
      const items: Hud[] = [
        { tone: boardT, html: `<span class="chip${boardT}" data-tip="Board fidelity" data-tip-body="${boardPending ? "The board reading is still settling, or a hand is covering it." : "How sure the fused cameras are about all 64 squares."}" data-tip-rows="Reading:${boardPct}:${b ? b.fidelity : 0}|Healthy:above 80%">${chipIcons.board(b ? b.fidelity : 0)}board ${boardPct}</span>` },
        { tone: moveT, html: `<span class="chip${moveT}" data-tip="Move confidence" data-tip-body="How sure the tracker is that the last move really happened." data-tip-rows="Reading:${g ? Math.round(g.moveFidelity * 100) : 0}%:${g ? g.moveFidelity : 0}|Healthy:above 80%">${chipIcons.move(g ? g.moveFidelity : 0)}move ${g ? Math.round(g.moveFidelity * 100) : 0}%</span>` },
        { tone: fpsT, html: `<span class="chip${fpsT}" data-tip="Frame rate" data-tip-body="How smoothly the page is drawing. Lag spikes mean something is hogging the main thread." data-tip-rows="Average:${frameMs.toFixed(1)} ms|Worst recently:${worstMs.toFixed(0)} ms">${chipIcons.fps(1000 / frameMs)}${Math.round(1000 / frameMs)} fps</span>` },
        { tone: camT, html: `<span class="chip${camT}" data-tip="Cameras" data-tip-body="Cameras currently feeding the workflow." data-tip-rows="Active:${bus.cameras.length}">${chipIcons.cam(bus.cameras.length)}${bus.cameras.length} cam</span>` },
        { tone: "", html: `<span class="chip" data-tip="Director phase" data-tip-body="What the experience director is doing right now.">${chipIcons.phase(bus.director?.phase ?? "idle")}${bus.director?.phase ?? "idle"}</span>` },
        { tone: tickT, html: `<span class="chip${tickT}" data-tip="Tick cost" data-tip-body="Total time every node spent on the last graph tick. The graph runs at 15 ticks per second." data-tip-rows="Budget:66 ms|Used:${tot.toFixed(1)} ms:${tot / 66}">${chipIcons.tick(tot / 66)}${tot.toFixed(1)} ms/tick</span>` },
        ...editChips(),
      ];
      // Yellow, orange or red readings stay on the bar; healthy ones (green or no tone) move under ⋯.
      const needsAttention = (c: Hud) => /[yor]/.test(c.tone);
      const quiet = items.filter((c) => !needsAttention(c));
      // Rewrite only when the markup changed: replacing it every 250 ms would rebuild the chips under the pointer and drop their tooltips.
      const barHtml = items.filter(needsAttention).map((c) => c.html).join(""), menuHtml = quiet.map((c) => c.html).join("");
      if (barHtml !== hudBarHtml) { hudBarHtml = barHtml; hud.innerHTML = barHtml; }
      if (menuHtml !== hudMenuHtml) { hudMenuHtml = menuHtml; hudMenu.innerHTML = menuHtml; hudMenu.append(buildChips); }
      hudMore.disabled = quiet.length === 0; // stays in place, just grayed out, so nothing shifts
      if (!quiet.length) setHudMenu(false);
      syncHistChips(); syncScenarioPause();
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
    const boardPending = !b || b.settled === false || !!b.handOver;
    const list = suggestNext({ route, setupDone: !!loadSetup()?.completed, soundOn: soundOn && !mixer.get().muted, boardFidelity: b && !boardPending ? b.fidelity : boardPending ? 1 : 0, boardPending, cameras: graph.nodes.size ? 1 : 0 });
    // Keyed on everything rendered, so an unchanged bar is never rebuilt (rebuilding replays the cards' entry animation).
    const key = list.map((x) => `${x.id}\u0001${x.title}\u0001${x.hint}\u0001${x.icon}`).join("\u0002");
    if (key === nextKey) return;
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
    if (r.page === "settings") { openWizard(); if (r.step) wiz?.setStep(r.step); }
    else { if (wiz && loadSetup()?.completed) closeWizard(); show(PAGES.indexOf(r.page)); }
    document.title = routeTitle(r, r.page === "settings" ? STEPS.find((x) => x.id === r.step)?.title : undefined);
    document.body.dataset.page = r.page;
    refreshNext(true);
  }
  /** Navigate: show it and push a history entry so Back works. */
  function go(r: Route, replace = false) {
    if (r.page !== "settings" && !loadSetup()?.completed) r = { page: "settings", step: wiz?.stepId ?? stepIds[loadPrefs().draft?.step ?? 0] ?? stepIds[0] };
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
    go(location.hash ? parseRoute(location.hash, stepIds) : done ? { page: PAGES[tab] } : { page: "settings", step: stepIds[p.draft?.step ?? 0] ?? stepIds[0] }, true);
  };
  const onUrl = () => { const r = parseRoute(location.hash, stepIds); if (!sameRoute(r, route)) go(r, true); };
  window.addEventListener("popstate", onUrl);
  window.addEventListener("hashchange", onUrl);
  window.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement | null;
    if (e.ctrlKey || e.metaKey || e.altKey || wiz || (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName))) return;
    const i = ["1", "2", "3", "4"].indexOf(e.key);
    if (i >= 0) { e.preventDefault(); go({ page: PAGES[i] }); }
    else if (e.key === ",") { e.preventDefault(); go({ page: "settings", step: stepIds[0] }); }
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
    const cfg = withDefaults(structuredClone(draft?.cfg ?? loadSetup() ?? defaultSetup()));
    wiz = new SetupWizard(cfg, {
      onProgress: (c, step) => { patchPrefs({ draft: { cfg: c, step } }); liveApply(c); },
      listCameras, openCamera, detectEnv, sfx, speak: speakLine,
      thunder: () => { audio.start(); audio.play({ do: "thunder", strength: 0.8 }); },
      onFinish: (done: SetupConfig) => { patchPrefs({ draft: null }); addBackup("Before setup", graph.toJSON(), loadSetup(), true); saveSetup(done); buildGraphFromConfig(graph, done); editor.rebuild(); persist(); closeWizard(); go({ page: "table" }); },
      onStep: (id) => { if (!wiz || (route.page === "settings" && route.step === id)) return; go({ page: "settings", step: id }); },
      canCancel: () => !!loadSetup()?.completed,
      onCancel: () => { if (loadSetup()?.completed) { patchPrefs({ draft: null }); closeWizard(); go({ page: "table" }); } },
    }, draft?.step ?? 0);
    wiz.mount(document.body);
  };
  const closeWizard = () => { wiz?.destroy(); wiz = null; };
  document.getElementById("home")!.onclick = (e) => { e.preventDefault(); go({ page: PAGES[0] }); };
  document.getElementById("settings")!.onclick = () => go({ page: "settings", step: wiz?.stepId ?? stepIds[0] });
  fromUrl();

  return { graph, editor, go, route: () => route, step, start, openWizard, wizard: () => wiz };
}
