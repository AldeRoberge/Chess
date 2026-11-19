import { calibrationRuntime } from "../vision/calibration";
import { bus, pushLog } from "../core/bus";
import type { ExperienceEvent } from "../core/events";
import type { NodeSpec, Plugin } from "../core/types";
import { Director, type DirectorOut, type PointerSample, type Seat } from "../experience/director";
import { ScenarioRunner, SCENARIOS, scenarioById } from "../sim/scenarios";
import { virtualTable } from "../sim/virtualTable";

interface DirState { dir: Director; out: DirectorOut | null }
const director: NodeSpec<DirState> = {
  type: "experience.director", title: "Experience Director", category: "Experience",
  inputs: [{ id: "seats", type: "seat" }, { id: "pointers", type: "pointer" }, { id: "events", type: "event" }],
  outputs: [{ id: "director", type: "any" }, { id: "events", type: "event" }],
  params: [
    { id: "dwellMs", kind: "number", label: "Hover to select (ms)", min: 500, max: 4000, step: 100, value: 1500 },
    { id: "introMs", kind: "number", label: "Intro (ms)", min: 1000, max: 20000, step: 500, value: 6000 },
    { id: "outroMs", kind: "number", label: "Outro (ms)", min: 1000, max: 30000, step: 500, value: 8000 },
    { id: "preset", kind: "select", label: "Opponent", options: ["menu", "engine", "human"], value: "menu" },
    { id: "presetElo", kind: "number", label: "Preset Elo", min: 500, max: 2800, step: 50, value: 1000 },
  ],
  init: () => ({ dir: new Director(), out: null }),
  process({ seats, pointers, events }, { params, state, now, setFidelity, span }) {
    const c = state.dir.cfg;
    c.dwellMs = Number(params.dwellMs); c.introMs = Number(params.introMs); c.outroMs = Number(params.outroMs);
    c.preset = params.preset as "menu"; c.presetElo = Number(params.presetElo);
    state.out = span("director step", () => state.dir.step(now, (seats as Seat[]) ?? [], (pointers as PointerSample[]) ?? [], (events as ExperienceEvent[]) ?? []));
    bus.director = state.out;
    pushLog(bus.events, state.out.events);
    setFidelity(null);
    return { director: state.out, events: state.out.events };
  },
};

/** Fake person: sits at the white side and uses the mouse (set from the UI) as a hand. */
const simPerson: NodeSpec = {
  type: "sim.person", title: "Virtual Player", category: "Tracking",
  inputs: [],
  outputs: [{ id: "seats", type: "seat" }, { id: "pointers", type: "pointer" }],
  params: [{ id: "seated", kind: "bool", label: "Seated", value: false }],
  process(_i, { params, now }) {
    virtualTable.seated = !!params.seated;
    virtualTable.tick(now);
    const seats: Seat[] = params.seated ? [{ id: "sim", x: 4, y: 10.2, angle: 0 }] : [];
    const pointers: PointerSample[] = virtualTable.pointer ? [{ id: "mouse", ...virtualTable.pointer, down: virtualTable.pointerDown }] : [];
    return { seats, pointers };
  },
};

interface ScenState { runner: ScenarioRunner | null; id: string }
/** Plays a scripted game on the virtual table: the "fake players" for end-to-end tuning. */
const scenario: NodeSpec<ScenState> = {
  type: "sim.scenario", title: "Scenario Player", category: "Tracking",
  inputs: [], outputs: [{ id: "events", type: "event" }, { id: "actions", type: "action" }],
  params: [
    { id: "scenario", kind: "select", label: "Game", options: SCENARIOS.map((s) => s.id), value: SCENARIOS[0].id },
    { id: "play", kind: "bool", label: "Play", value: false },
    { id: "pauseMs", kind: "number", label: "Pause between moves (ms)", min: 500, max: 8000, step: 100, value: 2500 },
  ],
  init: () => ({ runner: null, id: "" }),
  process(_i, { params, state, now, setFidelity }) {
    if (calibrationRuntime.active) return { events: [], actions: [] };
    const events: ExperienceEvent[] = [];
    if (!params.play) { state.runner = null; setFidelity(null); return { events, actions: [] }; }
    if (!state.runner || state.id !== params.scenario) {
      state.id = String(params.scenario);
      state.runner = new ScenarioRunner(virtualTable, scenarioById(state.id)!, Number(params.pauseMs));
      virtualTable.reset();
      events.push({ type: "scenario-start", t: now, data: { id: state.id } });
    }
    state.runner.pauseMs = Number(params.pauseMs);
    state.runner.setHeld(bus.scenarioPaused, now);
    const actions = state.runner.step(now); // handed to the AI players, who carry them out on the table
    setFidelity(state.runner.index / state.runner.scenario.moves.length);
    if (state.runner.done && !virtualTable.busy) { params.play = false; events.push({ type: "scenario-end", t: now, data: { id: state.id } }); }
    return { events, actions };
  },
};

export const experiencePlugin: Plugin = { id: "experience", name: "Experience", register: (r) => { r.register(director); r.register(simPerson); r.register(scenario); } };
