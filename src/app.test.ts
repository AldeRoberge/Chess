import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bus } from "./core/bus";
import { buildGraphFromConfig, defaultSetup, loadSetup, saveSetup } from "./setup/config";
import { Graph } from "./core/graph";
import { createRegistry } from "./plugins";
import { initialSceneState } from "./scene/types";
import { virtualTable } from "./sim/virtualTable";

vi.mock("./world/view", () => ({ WorldView: class { showFrusta = true; showProjection = true; renders = 0; constructor() {} setMapping() {} render() { this.renders++; } } }));
vi.mock("./setup/devices", () => ({ listCameras: vi.fn(async () => []), openCamera: vi.fn(async () => ({ getTracks: () => [] })) }));
vi.mock("./setup/system", async (orig) => ({ ...(await orig<typeof import("./setup/system")>()), detectEnv: vi.fn(async () => ({ mediaDevices: true, webgl: true, audio: true, speech: true, worker: true, stockfish: true, gamepad: true })) }));
const speak = vi.hoisted(() => vi.fn());
vi.mock("./plugins/narration", async (orig) => ({ ...(await orig<typeof import("./plugins/narration")>()), speakLine: speak }));

import { boot } from "./app";
import { addBackup, listBackups } from "./setup/backups";
import { patchPrefs } from "./setup/prefs";

class FakeAC { static made: FakeAC[] = []; currentTime = 0; state = "running"; sampleRate = 100; destination = {}; constructor() { FakeAC.made.push(this); } resume() { return Promise.resolve(); } createBuffer(_c: number, n: number) { const d = new Float32Array(n); return { getChannelData: () => d }; }
  createBufferSource() { return mk(); } createBiquadFilter() { return mk(); } createOscillator() { return mk(); } createGain() { return mk(); } }
const mk = () => ({ connect(n: any) { return n; }, start() {}, stop() {}, gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} }, frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, Q: { value: 0 } });
class Chan { sent: any[] = []; static all: Chan[] = []; onmessage: any; constructor() { Chan.all.push(this); } postMessage(m: any) { this.sent.push(m); } }

let root: HTMLElement;
beforeEach(() => {
  history.replaceState(null, "", "#"); document.body.innerHTML = '<div id="app"></div>'; root = document.getElementById("app")!; localStorage.clear(); Chan.all = []; FakeAC.made = []; speak.mockClear();
  vi.stubGlobal("BroadcastChannel", Chan); vi.stubGlobal("AudioContext", FakeAC); virtualTable.reset(); virtualTable.seated = false;
  Object.assign(bus, { game: null, director: null, board: null, engineHint: null, scene: null, lines: [], events: [], cameras: [], poses: [], scenarioPaused: false });
  (Element.prototype as any).setPointerCapture = vi.fn();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
/** A first-time user who is mid-setup (a saved draft): they get the guided wizard instead of the instant bot game. */
const midSetup = () => patchPrefs({ draft: { cfg: defaultSetup(), step: 0 } });
const finishSetup = () => { const s = defaultSetup(); s.completed = true; saveSetup(s); };

describe("first launch", () => {
  it("drops a brand-new user straight into a game against the bot", () => {
    localStorage.clear();
    const app = boot(root);
    expect(app.wizard()).toBeNull(); expect(document.querySelector(".halo")).toBeFalsy();
    expect(loadSetup()?.completed).toBe(true); expect(loadSetup()?.opponent.mode).toBe("engine");
    expect([...app.graph.nodes.values()].some((n) => n.type === "game.engine")).toBe(true);
  });
  beforeEach(midSetup);
  it("shows the Halo setup wizard on top of a working demo patch", () => {
    const app = boot(root);
    expect(document.querySelector(".halo")).toBeTruthy(); expect(app.wizard()).toBeTruthy(); expect(app.graph.nodes.size).toBeGreaterThan(10);
    expect(root.querySelectorAll("#tabs button")).toHaveLength(4);
    app.openWizard(); expect(document.querySelectorAll(".halo")).toHaveLength(1); // opening twice does not stack
  });
  it("finishing the wizard saves the setup, rebuilds the patch from it and removes the overlay", () => {
    const app = boot(root); const w = app.wizard()!;
    w.cfg.cameras = w.cfg.cameras.slice(0, 1); w.cfg.scene = "cavern"; (w as any).deps.onFinish({ ...w.cfg, completed: true });
    expect(app.wizard()).toBeNull(); expect(document.querySelector(".halo")).toBeNull();
    expect(loadSetup()).toMatchObject({ completed: true, scene: "cavern" }); expect([...app.graph.nodes.values()].filter((n) => n.type === "source.synthetic")).toHaveLength(1);
    expect(localStorage.getItem("cx.graph.v1")).toBeTruthy();
  });
  it("cancelling is not allowed until a setup has been completed once", () => {
    const app = boot(root); (app.wizard() as any).deps.onCancel(); expect(app.wizard()).toBeTruthy();
    finishSetup(); (app.wizard() as any).deps.onCancel(); expect(app.wizard()).toBeNull();
  });
  it("wires the wizard's test buttons to real speech and thunder", () => {
    const app = boot(root); const d = (app.wizard() as any).deps;
    d.speak("Bonjour", "A", 0.5); expect(speak).toHaveBeenCalledWith("Bonjour", "A", 0.5);
    d.thunder(); expect(FakeAC.made).toHaveLength(1);
    expect(typeof d.sfx.play).toBe("function"); expect(typeof d.listCameras).toBe("function");
  });
});

describe("returning launch", () => {
  it("skips the wizard once setup is complete and opens it from the Settings button", () => {
    finishSetup(); const app = boot(root);
    expect(app.wizard()).toBeNull(); expect(document.querySelector(".halo")).toBeNull();
    root.querySelector<HTMLElement>("#settings")!.click(); expect(app.wizard()).toBeTruthy();
  });
  it("restores the saved patch (user edits survive), and falls back to the setup-built one when the save is corrupt", () => {
    finishSetup(); const g = new Graph(createRegistry()); buildGraphFromConfig(g, defaultSetup()); const extra = g.addNode("narration.narrator", 5, 5); localStorage.setItem("cx.graph.v1", JSON.stringify(g.toJSON()));
    expect(boot(root).graph.nodes.has(extra.id)).toBe(true);
    history.replaceState(null, "", "#"); document.body.innerHTML = '<div id="app"></div>'; root = document.getElementById("app")!; localStorage.setItem("cx.graph.v1", "{{{");
    expect(boot(root).graph.nodes.size).toBeGreaterThan(10);
  });
  it("falls back to defaults when storage is unreadable", () => { finishSetup(); vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); }); expect(boot(root).graph.nodes.size).toBeGreaterThan(10); });
  it("survives storage that refuses writes", () => {
    finishSetup(); const app = boot(root); vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
    app.editor.onChange(); // autosave fails quietly
  });
});

describe("running", () => {
  const quiet = (app: ReturnType<typeof boot>) => { for (const id of [...app.graph.nodes.keys()]) app.graph.removeNode(id); app.editor.rebuild(); return app; }; // an empty patch leaves the bus to the test
  const frames = (app: ReturnType<typeof boot>, from: number, n: number, dt = 70) => { for (let i = 0; i < n; i++) app.step(from + i * dt); };
  it("ticks the graph at ~15 Hz, updates the HUD and the subtitle", () => {
    finishSetup(); const app = boot(root); frames(app, 1000, 30);
    // Healthy chips sit under ⋯, the rest on the bar: the readings are there either way.
    const readings = () => root.querySelector("#hud")!.textContent + root.querySelector("#hudmenu")!.textContent;
    expect(bus.game).toBeTruthy(); for (const re of [/board \d+%/, /move \d+%/, /2 cam/, /idle/, /ms\/tick/]) expect(readings()).toMatch(re);
    bus.lines = [{ speaker: "B", name: "Margot", text: "Quel coup !", t: 0, priority: 1 }]; frames(app, 5000, 6, 70); expect(root.querySelector("#sub")!.textContent).toBe("Margot: Quel coup !"); expect(root.querySelector("#sub")!.className).toBe("AB");
    bus.lines = []; frames(app, 9000, 6); expect(root.querySelector("#sub")!.textContent).toBe(""); expect(root.querySelector("#sub")!.className).toBe("");
  });
  it("shows red fidelity chips on the bar while the fidelity is low and green ones when high", () => {
    // Tone classes come from chipTone: g green, y yellow, o orange, r red. Healthy chips move under ⋯.
    finishSetup(); const app = quiet(boot(root)); app.step(1000);
    const fidelity = '[data-tip="Board fidelity"],[data-tip="Move confidence"]';
    bus.board = { fidelity: 0.2 } as any; bus.game = { moveFidelity: 0.2, history: [] } as any; frames(app, 2000, 5); expect(root.querySelectorAll(`#hud .chip.r:is(${fidelity})`).length).toBe(2);
    bus.board = { fidelity: 0.95 } as any; bus.game = { moveFidelity: 0.95, history: [] } as any; frames(app, 4000, 5); expect(root.querySelectorAll(`.chip.g:is(${fidelity})`).length).toBe(2);
  });
  it("moves healthy readings under ⋯ and keeps only the ones that need attention on the bar", () => {
    finishSetup(); const app = quiet(boot(root));
    bus.board = { fidelity: 0.95 } as any; bus.game = { moveFidelity: 0.95, history: [] } as any; bus.cameras = [{ id: "A", online: true, quality: 0.9, reliability: 0.9 }];
    frames(app, 1000, 5);
    const more = root.querySelector<HTMLButtonElement>("#hudmore")!, menu = root.querySelector<HTMLElement>("#hudmenu")!;
    expect(root.querySelector("#hud")!.textContent).not.toMatch(/cam|board/); expect(menu.textContent).toMatch(/board 95%.*move 95%.*1 cam/);
    expect(more.hidden).toBe(false); more.click(); expect(menu.hidden).toBe(false); expect(more.getAttribute("aria-expanded")).toBe("true");
    document.body.click(); expect(menu.hidden).toBe(true);
    bus.board = { fidelity: 0.1 } as any; frames(app, 2000, 5); expect(root.querySelector("#hud")!.textContent).toMatch(/board 10%/);
  });
  it("undo and redo chips on the bar are clickable, also after the bar has been redrawn", () => {
    finishSetup(); const app = boot(root); const before = app.graph.nodes.size;
    (app.editor as any).removeNode([...app.graph.nodes.keys()][0]); app.step(1000); // redraw the bar in between
    const undoChip = root.querySelector<HTMLButtonElement>("#hudundo")!, redoChip = root.querySelector<HTMLButtonElement>("#hudredo")!;
    expect(undoChip.disabled).toBe(false); undoChip.click(); expect(app.graph.nodes.size).toBe(before); app.step(1100);
    expect(redoChip.disabled).toBe(false); redoChip.click(); expect(app.graph.nodes.size).toBe(before - 1);
  });
  it("Pause holds a playing scenario, is only offered while one plays, and resumes", () => {
    finishSetup(); const app = quiet(boot(root)); const pause = root.querySelector<HTMLButtonElement>("#scenpause")!;
    app.step(1000); expect(pause.disabled).toBe(true);
    const node = app.graph.addNode("sim.scenario", 0, 0, { scenario: "scholars-mate", play: true }); app.editor.rebuild(); app.step(1400); // the bar refreshes at most every 250 ms
    expect(pause.disabled).toBe(false); expect(pause.textContent).toContain("Pause");
    pause.click(); expect(bus.scenarioPaused).toBe(true); expect(pause.textContent).toContain("Resume"); expect(pause.classList.contains("on")).toBe(true);
    pause.click(); expect(bus.scenarioPaused).toBe(false);
    pause.click(); node.params.play = false; app.step(1700); expect(pause.disabled).toBe(true); expect(bus.scenarioPaused).toBe(false);
  });
  it("clicking the table while two AI players play pauses and asks; Take control swaps the AI player for a Desktop Controller", () => {
    finishSetup(); const app = quiet(boot(root));
    const cv = root.querySelector<HTMLCanvasElement>(".table-cv")!;
    cv.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); expect(document.querySelector(".notice")).toBeNull(); // nothing is playing: a normal click
    const sc = app.graph.addNode("sim.scenario", 0, 0, { scenario: "scholars-mate", play: true }), wd = app.graph.addNode("world.virtual"), pw = app.graph.addNode("sim.player", 0, 0, { color: "w" }), pb = app.graph.addNode("sim.player", 0, 0, { color: "b" });
    app.graph.connect({ node: pw.id, port: "player" }, { node: wd.id, port: "white" }); app.graph.connect({ node: pb.id, port: "player" }, { node: wd.id, port: "black" }); app.editor.rebuild(); app.step(1400);
    cv.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(bus.scenarioPaused).toBe(true); expect(document.querySelector(".notice")!.textContent).toContain("take control");
    document.querySelector<HTMLButtonElement>(".notice .ghost")!.click(); expect(bus.scenarioPaused).toBe(false); // dismissed: the game carries on
    cv.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    const take = [...document.querySelectorAll<HTMLButtonElement>(".notice button")].find((b) => b.textContent!.startsWith("Take control"))!; take.click();
    const ctl = [...app.graph.nodes.values()].find((n) => n.type === "sim.desktop")!;
    expect(ctl.params.color).toBe("w"); expect([...app.graph.nodes.values()].filter((n) => n.type === "sim.player").map((n) => n.params.color)).toEqual(["b"]);
    expect(app.graph.edges.some((e) => e.from.node === ctl.id && e.to.port === "white")).toBe(true);
    expect(sc.params.play).toBe(false); expect(bus.scenarioPaused).toBe(false);
  });
  it("renders the active tab's panel only (table, 3D, log) and broadcasts the scene to projector windows", () => {
    finishSetup(); const app = quiet(boot(root)); const tabs = [...root.querySelectorAll<HTMLElement>("#tabs button")];
    app.step(1000); expect(root.querySelector("#dock .table")).toBeTruthy(); tabs[1].click(); expect(root.querySelector("#dock .world")).toBeTruthy(); app.step(1100); tabs[2].click(); expect(root.querySelector("#dock .log")).toBeTruthy(); app.step(1200);
    bus.scene = initialSceneState(); bus.game = { last: null, lifted: undefined, diff: [], status: "synced" } as any; app.step(2000); app.step(2050);
    const sent = Chan.all.flatMap((c) => c.sent).filter((m) => m.type === "state"); expect(sent.length).toBeGreaterThanOrEqual(1); expect(sent[0].overlay.game).toMatchObject({ status: "synced" });
    bus.game = null; app.step(3000); expect(Chan.all.flatMap((c) => c.sent).filter((m) => m.type === "state").at(-1).overlay.game).toBeNull();
  });
  it("the Sit/stand control seats the virtual player in the patch", () => {
    finishSetup(); const app = boot(root); const p = [...app.graph.nodes.values()].find((n) => n.type === "sim.person")!;
    root.querySelector<HTMLButtonElement>("#dock button")!.click(); expect(p.params.seated).toBe(true);
  });
  it("start() drives the app from requestAnimationFrame", () => {
    finishSetup(); const app = boot(root); const q: ((t: number) => void)[] = []; vi.stubGlobal("requestAnimationFrame", (cb: any) => { q.push(cb); return q.length; });
    app.start(); q.shift()!(1000); q.shift()!(1100); expect(q).toHaveLength(1); expect(bus.game).toBeTruthy();
  });
  it("animates the wizard while it is open", () => { midSetup(); const app = boot(root); const spy = vi.spyOn(app.wizard()!, "frame"); app.step(1000); expect(spy).toHaveBeenCalledWith(1000); });
});

describe("top-bar buttons", () => {
  it("unlocks audio on the sound button", () => { finishSetup(); boot(root); root.querySelector<HTMLElement>("#audio")!.click(); expect(FakeAC.made).toHaveLength(1); expect(root.querySelector("#audio")!.textContent).toBe("Sound on"); });
  it("exports the patch as JSON", () => {
    finishSetup(); boot(root); const url = vi.fn(() => "blob:x"); vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: url })); const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    root.querySelector<HTMLElement>("#export")!.click(); expect(url).toHaveBeenCalled(); expect(click).toHaveBeenCalled();
  });
  it("reset forgets the saved patch and setup, then reloads", () => {
    finishSetup(); localStorage.setItem("cx.graph.v1", "{}"); boot(root); const reload = vi.fn(); vi.stubGlobal("location", { reload, search: "" });
    root.querySelector<HTMLElement>("#reset")!.click(); expect(localStorage.getItem("cx.graph.v1")).not.toBeNull(); expect(reload).not.toHaveBeenCalled();
    [...document.querySelectorAll<HTMLButtonElement>(".notice button")].find((b) => b.textContent === "Reset workflow")!.click();
    expect(localStorage.getItem("cx.graph.v1")).toBeNull(); expect(loadSetup()).toBeNull(); expect(reload).toHaveBeenCalled();
  });
});

describe("navigation", () => {
  it("mirrors pages and setup steps in the URL hash, and honours it on load", () => {
    finishSetup(); const app = boot(root);
    expect(location.hash).toBe("#/table");
    root.querySelectorAll<HTMLElement>("#tabs button")[2].click(); expect(location.hash).toBe("#/log"); expect(app.route()).toEqual({ page: "log" });
    root.querySelector<HTMLElement>("#settings")!.click(); expect(location.hash).toBe("#/settings/briefing"); expect(app.wizard()).toBeTruthy();
    app.wizard()!.handle("next"); expect(location.hash).toBe("#/settings/cameras");
    app.go({ page: "world" }); expect(app.wizard()).toBeNull(); expect(location.hash).toBe("#/world");
  });
  it("opens straight at a deep link and runs suggestions", () => {
    finishSetup(); history.replaceState(null, "", "#/settings/board"); const app = boot(root);
    expect(app.wizard()!.stepId).toBe("board");
    app.go({ page: "table" }); root.querySelector<HTMLElement>(".next-card")!.click();
    expect(location.hash).toMatch(/^#\/(settings|world)/);
  });
  it("keeps first-time users in setup whatever the URL says", () => {
    midSetup();
    history.replaceState(null, "", "#/log"); const app = boot(root);
    expect(app.route().page).toBe("settings"); expect(location.hash).toBe("#/settings/briefing");
  });
});

describe("history, backups and recovery", () => {
  const key = (k: string, ctrl = true, shift = false) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, ctrlKey: ctrl, shiftKey: shift, bubbles: true }));
  const nudge = (app: ReturnType<typeof boot>) => (app.editor as any).removeNode([...app.graph.nodes.keys()][0]);
  it("Ctrl+Z / Ctrl+Y undo and redo an edit, and the buttons reflect it", () => {
    finishSetup(); const app = boot(root);
    const undoB = document.getElementById("undo") as HTMLButtonElement, redoB = document.getElementById("redo") as HTMLButtonElement;
    expect(undoB.disabled).toBe(true);
    const before = app.graph.nodes.size;
    nudge(app);
    expect(app.graph.nodes.size).toBe(before - 1); expect(undoB.disabled).toBe(false);
    key("z"); expect(app.graph.nodes.size).toBe(before); expect(redoB.disabled).toBe(false);
    key("y"); expect(app.graph.nodes.size).toBe(before - 1);
    key("z"); key("z", true, true); expect(app.graph.nodes.size).toBe(before - 1);
    key("z", false); expect(app.graph.nodes.size).toBe(before - 1);
    undoB.click(); redoB.click(); expect(app.graph.nodes.size).toBe(before - 1);
  });
  it("undoing a node move or a wire change happens in place: no node is torn down and restarted", () => {
    finishSetup(); const app = boot(root); const [id] = [...app.graph.nodes.keys()], node = app.graph.nodes.get(id)!, state = app.graph.states.get(id);
    const x0 = node.x; node.x += 300; (app.editor as any).onChange(); expect(node.x).toBe(x0 + 300);
    key("z"); expect(app.graph.nodes.get(id)).toBe(node); expect(app.graph.states.get(id)).toBe(state); expect(node.x).toBe(x0);
    key("y"); expect(app.graph.states.get(id)).toBe(state); expect(node.x).toBe(x0 + 300);
  });
  it("bypass survives a reload", () => {
    finishSetup(); const a = boot(root); const id = [...a.graph.nodes.keys()][0];
    a.graph.nodes.get(id)!.bypass = true; (a.editor as any).onChange();
    const b = boot(root); expect(b.graph.nodes.get(id)!.bypass).toBe(true);
  });
  it("restores the newest backup when the saved patch is unreadable", () => {
    finishSetup(); const a = boot(root); const n = a.graph.nodes.size;
    addBackup("test", a.graph.toJSON(), null, false);
    localStorage.setItem("cx.graph.v1", "{broken");
    const b = boot(root); expect(b.graph.nodes.size).toBe(n);
    expect(document.querySelector(".notice")!.textContent).toContain("could not be read");
    expect(localStorage.getItem("cx.graph.corrupt.v1")).toBe("{broken");
  });
  it("falls back to the default patch when the save and every backup are bad", () => {
    finishSetup(); localStorage.setItem("cx.graph.v1", JSON.stringify({ nodes: [{ id: "x", type: "no.such", x: 0, y: 0, params: {} }], edges: [] }));
    const b = boot(root); expect(b.graph.nodes.size).toBeGreaterThan(5);
    expect(document.querySelector(".notice")).toBeNull();
  });
  it("tells you after a crash and offers the backups panel; restore is undoable", () => {
    finishSetup(); localStorage.setItem("cx.session.v1", JSON.stringify({ open: true, beat: 1 }));
    const app = boot(root);
    const note = document.querySelector(".notice")!; expect(note.textContent).toContain("did not close cleanly");
    (note.querySelector("button") as HTMLButtonElement).click();
    expect(document.querySelector(".bk-row b")!.textContent).toBe("Recovered after crash");
    const n = app.graph.nodes.size; nudge(app);
    (document.querySelector(".bk-row button") as HTMLButtonElement).click();
    expect(app.graph.nodes.size).toBe(n); expect(document.querySelector(".bk")).toBeNull();
    key("z"); expect(app.graph.nodes.size).toBe(n - 1);
  });
  it("backups panel: back up now, delete, import, export, Escape", async () => {
    finishSetup(); const app = boot(root);
    (document.getElementById("backups") as HTMLButtonElement).click();
    expect(document.querySelector(".bk-empty")).toBeTruthy();
    const btns = () => [...document.querySelectorAll<HTMLButtonElement>(".bk-bar button")];
    btns()[0].click(); expect(document.querySelectorAll(".bk-row")).toHaveLength(1);
    (document.querySelector(".bk-row button:last-child") as HTMLButtonElement).click(); expect(document.querySelector(".bk-empty")).toBeTruthy();
    (URL as any).createObjectURL = vi.fn(() => "blob:x"); const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    btns()[2].click(); expect(click).toHaveBeenCalled();
    const input = document.querySelector<HTMLInputElement>(".bk input")!;
    Object.defineProperty(input, "files", { value: [new File([JSON.stringify({ nodes: [], edges: [] })], "p.json")] });
    input.dispatchEvent(new Event("change")); await new Promise((r) => setTimeout(r, 30));
    expect(app.graph.nodes.size).toBe(0);
    (document.getElementById("backups") as HTMLButtonElement).click();
    const bad = document.querySelector<HTMLInputElement>(".bk input")!; Object.defineProperty(bad, "files", { value: [new File(["nope"], "b.json")] });
    bad.dispatchEvent(new Event("change")); await new Promise((r) => setTimeout(r, 30));
    expect(document.querySelector(".notice")!.textContent).toContain("not a Chess Experience file");
    (document.getElementById("backups") as HTMLButtonElement).click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); expect(document.querySelector(".bk")).toBeNull();
    (document.getElementById("backups") as HTMLButtonElement).click();
    (document.querySelector(".bk") as HTMLElement).click(); expect(document.querySelector(".bk")).toBeNull();
  });
  it("saves a backup on a timer and on exit, and marks a clean exit", () => {
    finishSetup(); const app = boot(root);
    nudge(app); app.step(400000); expect(listBackups()[0].reason).toBe("Autosave");
    nudge(app); window.dispatchEvent(new Event("pagehide")); expect(listBackups()[0].reason).toBe("On exit");
    expect(JSON.parse(localStorage.getItem("cx.session.v1")!).open).toBe(false);
  });
  it("re-arms sound on the first gesture when it was on last time", () => {
    finishSetup(); localStorage.setItem("cx.prefs.v1", JSON.stringify({ sound: true }));
    boot(root); window.dispatchEvent(new Event("pointerdown"));
    expect(document.querySelector("#audio .lbl")!.textContent).toBe("Sound on");
  });
});

describe("workflows", () => {
  it("the Workflows button loads a demo into the live patch, and Ctrl+Z brings the old one back", () => {
    finishSetup(); const app = boot(root); const before = app.graph.nodes.size;
    (document.getElementById("workflows") as HTMLButtonElement).click();
    expect(document.querySelectorAll(".wf-row")).toHaveLength(6);
    (document.querySelector(".wf-row button") as HTMLButtonElement).click();
    expect(app.graph.nodes.size).toBe(11); expect(listBackups()[0].reason).toContain("Before workflow");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true })); expect(app.graph.nodes.size).toBe(before);
  });
  it("Open workflow file goes through the same import path", async () => {
    finishSetup(); const app = boot(root);
    (document.getElementById("workflows") as HTMLButtonElement).click();
    const input = document.querySelector<HTMLInputElement>(".bk input[type=file]")!;
    Object.defineProperty(input, "files", { value: [new File([JSON.stringify({ graph: { nodes: [], edges: [] } })], "w.json")] });
    input.dispatchEvent(new Event("change")); await new Promise((r) => setTimeout(r, 30));
    expect(app.graph.nodes.size).toBe(0);
  });
});

describe("resizable inspector", () => {
  const mainEl = () => document.querySelector("main") as HTMLElement;
  const ptr = (el: Element, type: string, x = 0) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x }));
  it("dragging the handle sets the width, clamps it, remembers it, and double-click resets", () => {
    finishSetup(); boot(root); const h = document.getElementById("resize")!;
    Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true });
    ptr(h, "pointerdown"); expect(document.body.classList.contains("resizing")).toBe(true);
    ptr(h, "pointermove", 700); ptr(h, "pointerup", 700);
    expect(mainEl().style.getPropertyValue("--aside-w")).toBe("500px"); expect(document.body.classList.contains("resizing")).toBe(false);
    expect(JSON.parse(localStorage.getItem("cx.prefs.v1")!).asideW).toBe(500);
    ptr(h, "pointerdown"); ptr(h, "pointermove", 1190); ptr(h, "pointercancel");
    expect(mainEl().style.getPropertyValue("--aside-w")).toBe("280px");
    ptr(h, "pointerdown"); ptr(h, "pointermove", 10); ptr(h, "pointerup");
    expect(mainEl().style.getPropertyValue("--aside-w")).toBe("840px");
    h.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); expect(mainEl().style.getPropertyValue("--aside-w")).toBe("");
    expect(JSON.parse(localStorage.getItem("cx.prefs.v1")!).asideW).toBeUndefined();
  });
  it("restores the saved width on launch, supports arrow keys, ignores other keys and right-clicks", () => {
    finishSetup(); localStorage.setItem("cx.prefs.v1", JSON.stringify({ asideW: 460 })); boot(root);
    expect(mainEl().style.getPropertyValue("--aside-w")).toBe("460px");
    const h = document.getElementById("resize")!;
    h.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })); expect(mainEl().style.getPropertyValue("--aside-w")).toBe("280px");
    h.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); h.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    h.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 2 })); expect(document.body.classList.contains("resizing")).toBe(false);
  });
});

describe("phone remote", () => {
  it("explains it is not running when the page has no relay (a static build)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    const app = boot(root); finishSetup(); root.querySelector<HTMLElement>("#phone")!.click(); expect(document.querySelector(".notice-title")!.textContent).toBe("Phone remote"); // still probing
    app.step(0); await new Promise((r) => setTimeout(r, 10));
    root.querySelector<HTMLElement>("#phone")!.click(); expect(document.querySelector(".notice-title")!.textContent).toBe("Phone remote is not running");
  });
  it("shows the address and join code, and plays a phone's move on the virtual table", async () => {
    const posted: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("host/info")) return { ok: true, json: async () => ({ code: "4321", urls: ["http://10.0.0.5:5173/#/remote?code=4321"], clients: 1 }) };
      if (url.endsWith("host/state")) { posted.push(JSON.parse(String(init!.body))); return { ok: true, json: async () => ({ clients: 1, code: "4321", commands: posted.length === 2 ? [{ type: "move", from: "e2", to: "e4" }] : [] }) }; }
      return { ok: true, json: async () => ({}) };
    }));
    const copy = vi.fn(async () => {}); Object.defineProperty(navigator, "clipboard", { value: { writeText: copy }, configurable: true });
    const app = boot(root); finishSetup(); app.step(0); await new Promise((r) => setTimeout(r, 10));
    root.querySelector<HTMLElement>("#phone")!.click();
    expect(document.querySelector(".notice-title")!.textContent).toBe("Watch and play from a phone"); expect(document.querySelector(".notice-msg")!.textContent).toContain("4321"); expect(document.querySelector(".notice-details")!.textContent).toContain("10.0.0.5");
    [...document.querySelectorAll<HTMLElement>(".notice button")].find((b) => b.textContent === "Copy address")!.click(); expect(copy).toHaveBeenCalledWith("http://10.0.0.5:5173/#/remote?code=4321");
    bus.game = { fen: virtualTable.game.fen(), turn: "w", ply: 0, over: false, status: "synced", history: [], fidelity: 1, last: null } as never;
    for (let i = 0; i < 3; i++) { app.step(1000 * (i + 2)); await new Promise((r) => setTimeout(r, 10)); }
    expect(virtualTable.busy).toBe(true); expect(posted.length).toBeGreaterThanOrEqual(2);
  });
  it("tells the player to connect to Wi-Fi when this computer has no address", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ code: "1", urls: [], clients: 0 }) })));
    const app = boot(root); finishSetup(); app.step(0); await new Promise((r) => setTimeout(r, 10));
    root.querySelector<HTMLElement>("#phone")!.click(); expect(document.querySelector(".notice-details")!.textContent).toContain("Connect this computer to Wi-Fi"); expect(document.querySelector(".notice-msg")!.textContent).toContain("No phone is connected yet");
  });
});
