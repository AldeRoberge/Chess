import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_CAMERAS, defaultSetup, validateSetup, virtualCamera, webcamSetup, type SetupConfig } from "../setup/config";
import type { Env } from "../setup/system";
import { virtualTable } from "../sim/virtualTable";
import { tick } from "../test/helpers";
import { fmtCorners } from "../plugins/shared";
import { FRAME_H, FRAME_W, RIGS, rigCorners } from "../sim/rigs";
import { SetupWizard, type WizardDeps } from "./wizard";
import { STEPS, sceneStateFor } from "./wizardSteps";

const env: Env = { mediaDevices: true, webgl: true, audio: true, speech: false, worker: true, stockfish: false, gamepad: true };
function deps(over: Partial<WizardDeps> = {}) {
  const stream = { getTracks: () => [{ stop: vi.fn() }] };
  const d = { listCameras: vi.fn(async () => [{ deviceId: "d1", label: "Cam One" }, { deviceId: "d2", label: "Cam Two" }]), openCamera: vi.fn(async () => stream as any), detectEnv: vi.fn(async () => env), sfx: { play: vi.fn() }, speak: vi.fn(), thunder: vi.fn(), onFinish: vi.fn(), onCancel: vi.fn(), stream, ...over };
  return d;
}
const make = (cfg: SetupConfig = defaultSetup(), over: Partial<WizardDeps> = {}) => { const d = deps(over), w = new SetupWizard(cfg, d); return { w, d: d as any }; };
const labels = (w: SetupWizard) => [...w.root.querySelectorAll(".halo-item")].map((li) => li.querySelector(".halo-label")!.textContent);
// a row's shown value: a choice shows its selected option, everything else its value text
const values = (w: SetupWizard) => [...w.root.querySelectorAll(".halo-item")].map((li) => li.querySelector("select")?.selectedOptions[0]?.textContent ?? li.querySelector(".halo-value")?.textContent ?? "");
const press = (w: SetupWizard, ...keys: string[]) => keys.forEach((k) => w.handle(k as any));
const go = (w: SetupWizard, step: number) => { w.step = step; w.zone = "pane"; w.focus = 0; (w as any).enterStep(); (w as any).render(); };
const focused = (w: SetupWizard) => w.root.querySelector(".halo-item.sel .halo-label")?.textContent;
const select = (w: SetupWizard, label: string) => { const i = (w as any).focusables().findIndex((f: any) => f.it.label === label); expect(i, `item ${label}`).toBeGreaterThanOrEqual(0); w.focus = i; w.zone = "pane"; (w as any).renderList(); };
const V = (s: string) => `◂ ${s} ▸`; // how sliders and choices show their value

beforeEach(() => { virtualTable.reset(); document.body.innerHTML = ""; });
afterEach(() => { vi.restoreAllMocks(); });

describe("wizard shell", () => {
  it("builds the Halo-style layout: logo, eight steps, pane, key hints; mounts and unmounts cleanly", () => {
    const { w } = make(); w.mount(document.body);
    expect(document.querySelector(".halo-progress")!.textContent).toBe("Step 1 of 11"); expect(w.root.querySelectorAll(".halo-step")).toHaveLength(11); expect(w.root.querySelector(".halo-keys")!.textContent).toContain("Esc / B");
    expect(w.root.querySelector(".halo-step.cur")!.textContent).toContain("System check"); expect(w.root.querySelector("h2")!.textContent).toBe("System check");
    w.destroy(); expect(document.querySelector(".halo")).toBeNull();
  });
  it("listens to the keyboard while mounted: arrows move through the steps, Enter dives in, Escape backs out; ignores unmapped keys", () => {
    const { w, d } = make(); w.mount(document.body);
    const key = (k: string, target: EventTarget = window) => { const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }); target.dispatchEvent(e); return e; };
    expect(key("ArrowDown").defaultPrevented).toBe(true); expect(w.step).toBe(1);
    expect(key("q").defaultPrevented).toBe(false);
    key("Enter"); expect(w.zone).toBe("pane");
    key("Escape"); expect(w.zone).toBe("steps"); key("Escape"); expect(d.onCancel).toHaveBeenCalled();
    w.destroy(); key("ArrowDown"); expect(w.step).toBe(1);
  });
  it("lets text inputs keep their keystrokes, blurring on Enter/Escape", () => {
    const { w } = make(); w.mount(document.body); go(w, 8);
    const input = w.root.querySelector("input")!, blur = vi.spyOn(input, "blur"), step = w.step;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true })); expect(w.step).toBe(step); expect(blur).not.toHaveBeenCalled();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); expect(blur).toHaveBeenCalledTimes(2);
  });
  it("clicking a step jumps to it", () => {
    const { w, d } = make(); (w.root.querySelectorAll(".halo-step")[3] as HTMLElement).click();
    expect(w.step).toBe(3); expect(w.root.querySelector(".halo-progress")!.textContent).toBe("Step 4 of 11"); expect(w.zone).toBe("steps"); expect(d.sfx.play).toHaveBeenCalledWith("tick");
  });
  it("steps list: up/down/next/prev move and clamp (with a 'deny' blip at the ends)", () => {
    const { w, d } = make(); press(w, "up"); expect(w.step).toBe(0); expect(d.sfx.play).toHaveBeenLastCalledWith("deny");
    press(w, "down", "down", "next"); expect(w.step).toBe(3); press(w, "prev"); expect(w.step).toBe(2);
    for (let i = 0; i < 11; i++) press(w, "next"); expect(w.step).toBe(STEPS.length - 1);
  });
  it("left and other keys do nothing in the steps list", () => { const { w } = make(); press(w, "left"); expect(w.step).toBe(0); expect(w.zone).toBe("steps"); });
  it("select/right enters the pane when it has focusable items, otherwise denies", () => {
    const { w, d } = make(); press(w, "down"); press(w, "right"); expect(w.zone).toBe("pane"); expect(d.sfx.play).toHaveBeenLastCalledWith("ok"); press(w, "back"); expect(w.zone).toBe("steps");
    const cfg = defaultSetup(); cfg.cameras = []; const m = make(cfg); m.w.step = 2; (m.w as any).enterStep(); (m.w as any).render(); press(m.w, "select"); expect(m.d.sfx.play).toHaveBeenLastCalledWith("deny"); expect(m.w.zone).toBe("steps");
  });
  it("a cancel without a handler is harmless", () => { const w = new SetupWizard(defaultSetup(), { ...deps(), onCancel: undefined }); expect(() => press(w, "back")).not.toThrow(); });
  it("pane: up/down wrap, left on an action leaves the pane, left/right on values adjust them, and a blocked adjust denies", () => {
    const { w, d } = make(); go(w, 4); // narration
    expect(focused(w)).toBe("Slot 1 · Calls the action"); press(w, "up"); expect(focused(w)).toBe("Volume"); press(w, "down"); expect(focused(w)).toBe("Slot 1 · Calls the action");
    press(w, "right"); expect(w.cfg.narrator.nameA).toBe("Margot"); expect(d.sfx.play).toHaveBeenLastCalledWith("tick");
    select(w, "Test slot 1"); press(w, "left"); expect(w.zone).toBe("steps"); // action: left leaves
    go(w, 7); select(w, "Opponent for each game"); (w as any).renderList(); press(w, "select"); expect(w.cfg.opponent.mode).toBe("engine");
    go(w, 3); select(w, "Rain"); w.cfg.rain = 1; press(w, "right"); expect(d.sfx.play).toHaveBeenLastCalledWith("deny"); // slider at max
  });
  it("mouse: hovering selects an item (with a blip), clicking activates it", () => {
    const { w, d } = make(); go(w, 4); w.zone = "steps";
    const rows = w.root.querySelectorAll<HTMLElement>(".halo-item"); rows[8].dispatchEvent(new MouseEvent("mouseenter")); expect(w.zone).toBe("pane"); expect(w.focus).toBe(8); expect(d.sfx.play).toHaveBeenLastCalledWith("tick");
    const before = d.sfx.play.mock.calls.length; w.root.querySelectorAll<HTMLElement>(".halo-item")[8].dispatchEvent(new MouseEvent("mouseenter")); expect(d.sfx.play.mock.calls.length).toBe(before); // already focused
    w.root.querySelectorAll<HTMLElement>(".halo-item")[8].click(); expect(w.cfg.narrator.speak).toBe(false);
  });
  it("gamepad input drives the same actions through frame()", () => {
    const { w } = make(); vi.stubGlobal("navigator", { ...navigator, getGamepads: () => [{ connected: true, buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: i === 13 })), axes: [0, 0] }] });
    w.frame(0); expect(w.step).toBe(1); vi.unstubAllGlobals();
  });
});

describe("briefing step", () => {
  it("runs the system check automatically on entry and shows each result", async () => {
    const { w, d } = make(); go(w, 0); await tick(); expect(d.detectEnv).toHaveBeenCalled();
    expect(labels(w)).toContain("Re-run system check"); expect(labels(w)).not.toContain("Continue to cameras");
    const rows = [...w.root.querySelectorAll(".sys-row")]; expect(rows.length).toBeGreaterThan(5);
    expect(rows.some((r) => r.classList.contains("ok"))).toBe(true); expect(rows.some((r) => r.classList.contains("warn"))).toBe(true);
  });
});

describe("cameras step", () => {
  it("lists the configured cameras with online toggles and remove buttons", () => {
    const { w } = make(); go(w, 1);
    expect(labels(w).slice(0, 2)).toEqual(["A · Virtual camera A", "B · Virtual camera B"]); expect(w.root.querySelectorAll(".halo-trash")).toHaveLength(2); expect(values(w)[0]).toBe("Disable");
    press(w, "select"); expect(w.cfg.cameras[0].online).toBe(false); expect(values(w)[0]).toBe("Enable");
    expect(w.root.querySelector(".halo-hint")!.textContent).toContain("Virtual camera");
    w.cfg.cameras.push(webcamSetup("x", "Real", "C")); (w as any).render(); select(w, "C · Real"); (w as any).renderList(); expect(w.root.querySelector(".halo-hint")!.textContent).toBe("Physical webcam");
  });
  it("removes a camera and resets the calibration selection", () => {
    const { w } = make(); go(w, 1); w.state.boardCam = 1; w.root.querySelector<HTMLButtonElement>('.halo-trash[aria-label="Remove camera A"]')!.click();
    expect(w.cfg.cameras.map((c) => c.id)).toEqual(["B"]); expect(w.state.boardCam).toBe(0);
  });
  it("scans for webcams (showing a scanning state), then offers to add each one not yet configured", async () => {
    const { w, d } = make(); go(w, 1); select(w, "Scan for webcams"); press(w, "select");
    expect(labels(w)).toContain("Scanning…"); await tick(); expect(d.listCameras).toHaveBeenCalled();
    expect(labels(w)).toEqual(expect.arrayContaining(["Add webcam · Cam One", "Add webcam · Cam Two"]));
    select(w, "Add webcam · Cam One"); press(w, "select");
    expect(w.cfg.cameras.at(-1)).toMatchObject({ kind: "webcam", deviceId: "d1", label: "Cam One", id: "C" }); expect(labels(w)).not.toContain("Add webcam · Cam One");
  });
  it("a failing scan clears the scanning state (and propagates nothing to the UI)", async () => {
    const { w } = make(defaultSetup(), { listCameras: vi.fn(async () => { throw new Error("denied"); }) }); go(w, 1);
    const p = (w as any).scan(); await expect(p).rejects.toThrow("denied"); expect(w.state.scanning).toBe(false);
  });
  it("adds virtual cameras on the first free rig and disables 'add' at four cameras", () => {
    const { w } = make(); go(w, 1); select(w, "Add virtual camera"); press(w, "select");
    expect(w.cfg.cameras.at(-1)).toMatchObject({ kind: "virtual", rig: "C", id: "C" });
    select(w, "Add virtual camera"); press(w, "select"); expect(w.cfg.cameras).toHaveLength(4); expect(w.cfg.cameras.at(-1)!.rig).toBe("A"); // all rigs taken: reuse
    const add = [...w.root.querySelectorAll(".halo-item")].find((li) => li.textContent!.includes("Add virtual"))!; expect(add.classList.contains("disabled")).toBe(true);
    select(w, "Add virtual camera"); press(w, "select"); expect(w.cfg.cameras).toHaveLength(4);
  });
  it("disables 'add webcam' at the camera limit", async () => {
    const { w } = make(); w.cfg.cameras.push(webcamSetup("a", "a", "C"), webcamSetup("b", "b", "D")); go(w, 1); select(w, "Scan for webcams"); press(w, "select"); await tick();
    select(w, "Add webcam · Cam One"); press(w, "select"); expect(w.cfg.cameras).toHaveLength(4);
  });
  it("a disabled add explains why on hover instead of failing silently", () => {
    const { w } = make(); for (let i = 0; i < 4; i++) w.cfg.cameras.push(virtualCamera("A", "X" + i));
    go(w, 1);
    const add = [...w.root.querySelectorAll<HTMLElement>(".halo-item")].find((li) => li.textContent!.includes("Add virtual"))!;
    expect(add.classList.contains("disabled")).toBe(true);
    expect(add.dataset.tip).toBe("Unavailable"); expect(add.dataset.tipBody).toContain(`All ${MAX_CAMERAS} camera slots are used`);
  });
});

/** The camera tabs on the board step. */
const tab = (w: SetupWizard, i: number) => w.root.querySelectorAll<HTMLButtonElement>(".cam-tab")[i];
/** The list row with this label, on the board step. */
const row = (w: SetupWizard, label: string) => [...w.root.querySelectorAll<HTMLElement>(".halo-item")].find((li) => li.querySelector(".halo-label")!.textContent === label)!;
/** The mock canvas keeps no pixels: make its read-back return the picture last put on it (what the board reads before the overlay). */
const keepPixels = (w: SetupWizard) => {
  const ctx = w.root.querySelector<HTMLCanvasElement>(".halo-canvas")!.getContext("2d")! as any;
  let last: ImageData | null = null;
  const put = ctx.putImageData.bind(ctx);
  ctx.putImageData = (img: ImageData, x: number, y: number) => { last = img; put(img, x, y); };
  ctx.getImageData = () => last ?? ctx.createImageData(FRAME_W, FRAME_H);
};

describe("board step", () => {
  it("shows an informational placeholder when there are no cameras", () => { const cfg = defaultSetup(); cfg.cameras = []; const { w } = make(cfg); go(w, 2); expect(labels(w)).toEqual(["No cameras"]); });
  it("edits channel, trust and each corner slider; reset restores the rig's corners; picking another camera's tab switches the rows", () => {
    const { w } = make(); w.mount(document.body); go(w, 2);
    // the camera is picked on the tabs above the list; corners start folded: one row for the section, summarising the count
    expect(labels(w)).toEqual(["Channel", "Trust", "Field of view", "Corners"]);
    expect(values(w)[3]).toBe("4 corners");
    select(w, "Channel"); press(w, "right"); expect(w.cfg.cameras[0].channel).toBe("red"); expect(values(w)[0]).toContain("Red");
    press(w, "left", "left"); expect(w.cfg.cameras[0].channel).toBe("blue"); press(w, "right"); expect(values(w)[0]).toContain("Gray");
    select(w, "Trust"); press(w, "right"); expect(w.cfg.cameras[0].trust).toBeCloseTo(1.1);
    select(w, "Field of view"); press(w, "right"); expect(w.cfg.cameras[0].fov).toBe(43); expect(values(w)[2]).toBe(V("43°")); expect(w.root.querySelector(".halo-hint")!.textContent).toContain("place the camera");
    // opening the section lists reset, then each corner with its own x and y
    select(w, "Corners"); press(w, "select");
    expect(labels(w).slice(3, 7)).toEqual(["Corners", "Reset corners", "a8", "Across (x)"]); expect(labels(w)).toHaveLength(4 + 1 + 4 * 3);
    const before = w.cfg.cameras[0].corners; select(w, "Across (x)"); press(w, "right"); expect(w.cfg.cameras[0].corners).not.toBe(before);
    w.focus = 13; w.zone = "pane"; (w as any).renderList(); expect(focused(w)).toBe("Down (y)"); press(w, "left"); // h1, y
    select(w, "Reset corners"); press(w, "select"); expect(w.cfg.cameras[0].corners).toBe(fmtCorners(rigCorners(RIGS.A)));
    tab(w, 1).click(); expect(w.state.boardCam).toBe(1); expect(tab(w, 1).textContent).toContain("B · Virtual camera B");
    w.cfg.cameras[1].corners = "garbage"; (w as any).renderList(); select(w, "Across (x)"); press(w, "right"); // recovers from unparsable corners
    expect(w.cfg.cameras[1].corners.split(";")).toHaveLength(4);
  });
  it("has no Camera arrows: one tab per camera, named, with the selected one marked", () => {
    const { w } = make(); go(w, 2);
    expect(labels(w)).not.toContain("Camera");
    const tabs = () => [...w.root.querySelectorAll<HTMLButtonElement>(".cam-tab")];
    expect(tabs().map((t) => t.querySelector(".cam-tab-name")!.textContent)).toEqual(["A · Virtual camera A", "B · Virtual camera B"]);
    expect(w.root.querySelector(".cam-tabs")!.getAttribute("role")).toBe("tablist");
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true"); expect(tabs()[1].getAttribute("aria-selected")).toBe("false");
    tabs()[1].click(); expect(w.state.boardCam).toBe(1); expect(tab(w, 1).getAttribute("aria-selected")).toBe("true"); expect(tabs()[0].getAttribute("aria-selected")).toBe("false");
    tab(w, 1).click(); expect(w.state.boardCam).toBe(1); // already selected: nothing changes
    expect(w.root.querySelector(".halo-canvas")).toBeTruthy(); // the picture sits under the tabs
  });
  it("arrow keys on a focused tab pick the neighbouring camera and wrap round", () => {
    const { w } = make(); w.mount(document.body); go(w, 2);
    const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
    key(tab(w, 0), "ArrowRight"); expect(w.state.boardCam).toBe(1);
    key(tab(w, 1), "ArrowRight"); expect(w.state.boardCam).toBe(0);
    key(tab(w, 0), "ArrowLeft"); expect(w.state.boardCam).toBe(1);
    key(tab(w, 1), "ArrowDown"); expect(w.state.boardCam).toBe(1); // only left and right move between tabs
    w.destroy();
  });
  it("tab status: configured, ready, auto-detected placement, and performing badly when the squares do not stand out", () => {
    const { w } = make(); go(w, 2); keepPixels(w); const status = (i: number) => tab(w, i).querySelector(".cam-tab-status")!.textContent;
    expect(status(0)).toBe("Ready"); expect(tab(w, 0).classList.contains("ok")).toBe(true);
    expect(tab(w, 0).querySelector('[aria-label="Configured: yes"]')).toBeTruthy(); expect(tab(w, 0).querySelector('[aria-label="Placement auto-detected: no"]')).toBeTruthy();
    w.cfg.cameras[0].autoFields = ["fov"]; w.cfg.cameras[0].online = false; (w as any).render();
    expect(status(0)).toBe("Offline"); expect(tab(w, 0).classList.contains("warn")).toBe(true);
    w.cfg.cameras[0].online = true; w.cfg.cameras[0].autoFields = ["fov"]; (w as any).render(); expect(status(0)).toBe("Ready · placement auto");
    // corners all on one pixel: every square reads the same, so the board does not stand out at all
    w.cfg.cameras[1].corners = "5,5;5,5;5,5;5,5"; tab(w, 1).click(); w.frame(1000); (w as any).render();
    expect(status(1)).toBe("Performing badly"); expect(tab(w, 1).classList.contains("fail")).toBe(true); expect(tab(w, 1).querySelector('[aria-label="Performing badly: yes"]')).toBeTruthy();
    w.cfg.cameras[1].corners = fmtCorners(rigCorners(RIGS.B)); w.frame(2000); (w as any).render(); expect(status(1)).toBe("Ready");
  });
  it("a webcam without a picture shows No signal, and its auto detect for channel and trust is disabled", () => {
    const cfg = defaultSetup(); cfg.cameras = [webcamSetup("d1", "Cam One", "A")];
    const { w } = make(cfg); w.mount(document.body); go(w, 2); w.frame(1000); (w as any).render();
    expect(tab(w, 0).querySelector(".cam-tab-status")!.textContent).toBe("No signal"); expect(tab(w, 0).classList.contains("fail")).toBe(true);
    expect(row(w, "Channel").querySelector<HTMLButtonElement>(".halo-auto")!.disabled).toBe(true);
    expect(row(w, "Trust").querySelector<HTMLButtonElement>(".halo-auto")!.disabled).toBe(true);
    expect(row(w, "Field of view").querySelector<HTMLButtonElement>(".halo-auto")!.disabled).toBe(false); // from the corners: no picture needed
    row(w, "Trust").querySelector<HTMLButtonElement>(".halo-auto")!.click(); expect(w.cfg.cameras[0].autoFields ?? []).not.toContain("trust"); // disabled: nothing happens
  });
  it("auto detect fills the field of view from the board corners and channel and trust from the picture; a hand edit clears its flag", () => {
    const { w } = make(); w.mount(document.body); go(w, 2); keepPixels(w);
    // the lens angle is read back from the corners of the rig's board (whole-pixel corners: within a couple of degrees)
    row(w, "Field of view").querySelector<HTMLButtonElement>(".halo-auto")!.click();
    expect(Math.abs(w.cfg.cameras[0].fov - RIGS.A.fovY)).toBeLessThanOrEqual(2); expect(w.cfg.cameras[0].autoFields).toEqual(["fov"]);
    expect(w.state.autoMsg).toContain("Field of view set to"); expect(w.root.querySelector(".halo-hint")!.textContent).toContain("Field of view set to");
    expect(tab(w, 0).querySelector('[aria-label="Placement auto-detected: yes"]')).toBeTruthy();
    // channel and trust need the picture: draw it, then the buttons are live
    w.frame(1000); (w as any).render();
    row(w, "Channel").querySelector<HTMLButtonElement>(".halo-auto")!.click(); expect(w.cfg.cameras[0].channel).toBe("luma"); expect(w.cfg.cameras[0].autoFields).toContain("channel");
    row(w, "Trust").querySelector<HTMLButtonElement>(".halo-auto")!.click(); expect(w.cfg.cameras[0].trust).toBeGreaterThanOrEqual(0); expect(w.cfg.cameras[0].trust).toBeLessThanOrEqual(2); expect(w.cfg.cameras[0].autoFields).toContain("trust");
    expect(w.state.autoMsg).toContain("Trust set to");
    // setting trust by hand takes it off the auto-detected list
    select(w, "Trust"); press(w, "right"); expect(w.cfg.cameras[0].autoFields).not.toContain("trust"); expect(w.cfg.cameras[0].autoFields).toContain("fov");
    // the Enter key on a focused auto button presses it natively, not through the wizard
    const btn = row(w, "Field of view").querySelector<HTMLButtonElement>(".halo-auto")!, enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    btn.dispatchEvent(enter); expect(enter.defaultPrevented).toBe(false);
  });
});

describe("board preview and corner dragging", () => {
  const stubRect = (cv: HTMLCanvasElement) => vi.spyOn(cv, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 480, height: 360, right: 480, bottom: 360, x: 0, y: 0, toJSON() {} });
  const ptr = (cv: HTMLCanvasElement, type: string, x: number, y: number) => cv.dispatchEvent(Object.assign(new Event(type, { bubbles: true }), { clientX: x, clientY: y }));
  it("draws the virtual camera's 3D view (cached until the scene changes) with draggable corner handles", () => {
    const { w } = make(); w.mount(document.body); go(w, 2);
    const cv = w.root.querySelector<HTMLCanvasElement>(".halo-canvas")!, put = vi.spyOn(cv.getContext("2d")!, "putImageData");
    w.frame(0); w.frame(16); expect(put).toHaveBeenCalledTimes(2); expect((w as any).picker).toBeTruthy();
    virtualTable.hand = { x: 3, y: 3 }; w.frame(32); expect(put).toHaveBeenCalledTimes(3);
    const rect = stubRect(cv), c = w.cfg.cameras[0]; const start = (w as any).picker.corners[0];
    ptr(cv, "pointerdown", start.x, start.y); ptr(cv, "pointermove", start.x + 30, start.y + 20); ptr(cv, "pointerup", 0, 0); expect(c.corners).not.toBe(fmtCorners(rigCorners(RIGS.A)));
    expect(rect).toHaveBeenCalled();
  });
  it("ignores pointer events with no picker, moves without a grab, and a zero-size canvas rect", () => {
    const { w } = make(); go(w, 2); const cv = w.root.querySelector<HTMLCanvasElement>(".halo-canvas")!;
    ptr(cv, "pointerdown", 1, 1); ptr(cv, "pointerup", 0, 0); // no picker yet
    w.frame(0); const rect = vi.spyOn(cv, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} });
    ptr(cv, "pointermove", 5, 5); ptr(cv, "pointerdown", 5, 5); ptr(cv, "pointermove", 6, 6); expect(rect).toHaveBeenCalled();
    ptr(cv, "pointerup", 0, 0);
  });
  it("shows a webcam's live video, or NO SIGNAL until it opens; stops the stream when leaving or switching away", async () => {
    const cfg = defaultSetup(); cfg.cameras = [webcamSetup("d1", "Cam One", "A"), webcamSetup("d2", "Cam Two", "B")];
    const { w, d } = make(cfg); vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined); go(w, 2);
    const ctx = w.root.querySelector<HTMLCanvasElement>(".halo-canvas")!.getContext("2d")!, text = vi.spyOn(ctx, "fillText"), draw = vi.spyOn(ctx, "drawImage");
    w.frame(0); expect(text).toHaveBeenCalledWith("No signal", expect.any(Number), expect.any(Number));
    await tick(); expect(d.openCamera).toHaveBeenCalledWith("d1"); w.frame(16); expect(draw).toHaveBeenCalled();
    const stop = vi.fn(); (w as any).stream = { getTracks: () => [{ stop }] }; tab(w, 1).click(); expect(stop).toHaveBeenCalled(); expect((w as any).streamFor).toBe("d2");
    go(w, 0); go(w, 2); (w as any).stopStream();
  });
  it("keeps an already-open stream for the same device, discards a stream that arrives for a camera no longer selected, and survives open failures", async () => {
    const cfg = defaultSetup(); cfg.cameras = [webcamSetup("d1", "Cam One", "A"), webcamSetup("d2", "Cam Two", "B")];
    const { w, d } = make(cfg); vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined); go(w, 2); await tick();
    d.openCamera.mockClear(); (w as any).ensureVideo(); expect(d.openCamera).not.toHaveBeenCalled();
    const stopLate = vi.fn(); let resolve!: (s: any) => void; d.openCamera.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    w.state.boardCam = 1; (w as any).ensureVideo(); w.state.boardCam = 0; (w as any).streamFor = "elsewhere"; resolve({ getTracks: () => [{ stop: stopLate }] }); await tick(); expect(stopLate).toHaveBeenCalled();
    d.openCamera.mockRejectedValueOnce(new Error("busy")); w.state.boardCam = 1; (w as any).ensureVideo(); await tick(); expect((w as any).stream).toBeNull();
  });
  it("leaves the preview alone when the camera's corners are unparsable", () => {
    const { w } = make(); go(w, 2); w.cfg.cameras[0].corners = "bad"; expect(() => w.frame(0)).not.toThrow(); expect((w as any).picker).toBeNull();
  });
  it("re-uses the picker while dragging and refreshes it when idle", () => {
    const { w } = make(); go(w, 2); w.frame(0); const p1 = (w as any).picker; w.frame(16); expect((w as any).picker).not.toBe(p1);
    (w as any).picker.active = 1; const p2 = (w as any).picker; w.frame(32); expect((w as any).picker).toBe(p2);
  });
  it("any preview-less step simply ignores frame()", () => { const { w } = make(); go(w, 7); expect(() => w.frame(0)).not.toThrow(); });
});

describe("scenes step", () => {
  it("lists the scenes and applies rain / snow / hour, keeping the live preview in sync, and tests thunder", () => {
    const { w, d } = make(); go(w, 3);
    expect(labels(w)).toEqual(["Scene", "Rain", "Snow", "Time of day", "Test thunder"]); expect(values(w)[0]).toContain("Auto");
    press(w, "right"); expect(w.cfg.scene).toBe("cavern"); expect(w.state.scenePreview.scene).toBe("cavern");
    select(w, "Rain"); press(w, "right"); expect(w.cfg.rain).toBe(-0.9); expect(values(w)[1]).toBe(V("Scene default")); w.cfg.rain = 0; (w as any).renderList(); press(w, "right"); expect(values(w)[1]).toBe(V("10%"));
    select(w, "Snow"); w.cfg.snow = 0.7; (w as any).renderList(); press(w, "right"); expect(w.state.scenePreview.snow).toBe(0.8);
    select(w, "Time of day"); press(w, "right"); expect(w.cfg.hour).toBe(0); expect(values(w)[3]).toBe(V("0:00")); expect(w.state.scenePreview.timeOfDay).toBe(0);
    select(w, "Test thunder"); press(w, "select"); expect(d.thunder).toHaveBeenCalled();
    w.frame(0); w.frame(50);
  });
  it("auto uses the winter forest for the preview, and a fresh preview is built per step", () => {
    expect(sceneStateFor(defaultSetup()).scene).toBe("winter-forest");
    const c = defaultSetup(); c.scene = "fire-watchtower"; c.rain = 0.2; c.snow = 0.3; c.hour = 2; expect(sceneStateFor(c)).toMatchObject({ scene: "fire-watchtower", rain: 0.2, snow: 0.3, timeOfDay: 2 });
  });
});

describe("narration, opponent, room, launch steps", () => {
  it("narration: commentator slots (name, swap, remove, add), volume, and the test line", () => {
    const { w, d } = make(); go(w, 4);
    select(w, "Slot 1 · Calls the action"); press(w, "right"); expect(w.cfg.narrator.nameA).toBe("Margot"); w.cfg.narrator.nameA = "Jean"; (w as any).renderList();
    select(w, "Move slot 1 down"); press(w, "select"); expect([w.cfg.narrator.nameA, w.cfg.narrator.nameB]).toEqual(["Margot", "Jean"]);
    select(w, "Remove slot 1"); press(w, "select"); expect(w.cfg.narrator.voices).toBe(1); expect(w.cfg.narrator.nameA).toBe("Jean");
    select(w, "Remove slot 1"); press(w, "select"); expect(w.cfg.narrator.voices).toBe(1);
    select(w, "Add commentator · slot 2 (adds colour and reactions)"); press(w, "select"); expect(w.cfg.narrator.voices).toBe(2); expect(w.cfg.narrator.nameB).not.toBe(w.cfg.narrator.nameA);
    select(w, "Volume"); press(w, "left"); expect(w.cfg.narrator.volume).toBeCloseTo(0.8);
    select(w, "Test slot 1"); press(w, "select"); expect(d.speak).toHaveBeenLastCalledWith("Un joueur rejoint la partie.", "A", 0.8);
  });
  it("theme step sets the app look and mode live, and warns when Dark Reader is active", () => {
    const { w } = make(); go(w, STEPS.findIndex((s) => s.id === "theme")); expect(w.stepId).toBe("theme");
    select(w, "Theme"); press(w, "right"); expect(document.documentElement.dataset.theme).not.toBe("classic");
    select(w, "Mode"); press(w, "right"); expect(["dark", "light"]).toContain(document.documentElement.dataset.mode);
    expect(w.root.textContent).not.toContain("Dark Reader");
    document.documentElement.setAttribute("data-darkreader-mode", "dynamic"); (w as any).renderList(); expect(w.root.textContent).toContain("Dark Reader is active");
    document.documentElement.removeAttribute("data-darkreader-mode");
  });
  it("opponent: who decides and which Elo", () => {
    const { w } = make(); go(w, 7);
    press(w, "right"); expect(w.cfg.opponent.mode).toBe("engine"); press(w, "right"); expect(w.cfg.opponent.mode).toBe("human");
    select(w, "Computer strength"); press(w, "right"); expect(w.cfg.opponent.elo).toBe(1050); press(w, "left", "left"); expect(w.cfg.opponent.elo).toBe(950);
    expect(w.root.querySelector(".elo-visual .elo-read")!.textContent).toContain("950 Elo"); // the chart follows the slider's value
    expect(w.root.querySelector(".halo-hint")!.textContent).not.toBe("");
  });
  it("room: projector count, DMX toggle, and a text field for the bridge URL (Enter focuses it)", () => {
    const { w, d } = make(); go(w, 8);
    press(w, "right"); expect(w.cfg.projectors.count).toBe(1);
    select(w, "People tracking"); press(w, "select"); expect(w.cfg.tracking.pose).toBe(true); expect(w.root.querySelector(".halo-hint")!.textContent).toContain("Replaces the virtual player");
    select(w, "DMX lighting"); press(w, "select"); expect(w.cfg.projectors.dmx).toBe(true);
    select(w, "DMX bridge URL"); const input = w.root.querySelector("li.sel input") as HTMLInputElement, focus = vi.spyOn(input, "focus");
    press(w, "select"); expect(focus).toHaveBeenCalled();
    input.value = "ws://10.0.0.5:8787"; input.dispatchEvent(new Event("change")); expect(w.cfg.projectors.dmxUrl).toBe("ws://10.0.0.5:8787"); expect(d.sfx.play).toHaveBeenLastCalledWith("ok");
    input.click(); // does not bubble into the row's click handler
    const other = w.root.querySelectorAll(".halo-item")[0] as HTMLElement; other.click();
    select(w, "Projectors"); press(w, "select"); // Enter on a slider does nothing
    (w as any).editText(); // no selected text row: harmless
  });
  it("launch: shows validation notices, demo options, and launches only when valid", () => {
    const { w, d } = make(); go(w, STEPS.length - 1);
    expect(labels(w)).toEqual(["Cameras", "Autoplay demo game", "Demo game", "Launch experience"]); expect(values(w)[0]).toBe("2 online / 2");
    select(w, "Autoplay demo game"); press(w, "select"); expect(w.cfg.demo.autoplay).toBe(true);
    select(w, "Demo game"); press(w, "right"); expect(w.cfg.demo.scenario).toBe("opera-game");
    select(w, "Launch experience"); press(w, "select");
    expect(d.sfx.play).toHaveBeenCalledWith("launch"); expect(d.onFinish).toHaveBeenCalledTimes(1);
    const done = d.onFinish.mock.calls[0][0] as SetupConfig; expect(done.completed).toBe(true); expect(done.demo.autoplay).toBe(true); expect(w.cfg.completed).toBe(false); // the wizard's own config is untouched
  });
  it("refuses to launch with errors, listing them; warns about a single camera", () => {
    const cfg = defaultSetup(); cfg.cameras.forEach((c) => (c.online = false));
    const { w, d } = make(cfg); go(w, STEPS.length - 1);
    expect(labels(w)[0]).toBe("Error"); expect(values(w)[0]).toContain("No camera is online"); expect(w.root.querySelector(".halo-item.fail")).toBeTruthy();
    select(w, "Launch experience"); press(w, "select"); expect(d.onFinish).not.toHaveBeenCalled(); expect(validateSetup(w.cfg).length).toBeGreaterThan(0);
    w.cfg.cameras[0].online = true; (w as any).render(); expect(labels(w)[0]).toBe("Notice"); expect(w.root.querySelector(".halo-item.warn")).toBeTruthy();
  });
  it("shrinks focus when removing a camera leaves fewer rows (Delete key on the focused camera)", () => {
    const { w } = make(); go(w, 1); w.focus = 1; (w as any).key(new KeyboardEvent("keydown", { key: "Delete" }));
    expect(w.cfg.cameras).toHaveLength(1); expect(w.focus).toBeLessThan((w as any).focusables().length);
  });
});
