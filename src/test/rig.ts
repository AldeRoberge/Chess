import { Chess } from "chess.js";
import { bus } from "../core/bus";
import type { ExperienceEvent } from "../core/events";
import { Graph } from "../core/graph";
import { createRegistry } from "../plugins";
import { buildGraphFromConfig, defaultSetup, virtualCamera, type Rig } from "../setup/config";
import { scenarioById } from "../sim/scenarios";
import { virtualTable } from "../sim/virtualTable";

export interface RunOptions {
  cams?: Rig[];
  noise?: number; gain?: number; gradient?: number;
  pauseMs?: number;
  /** take camera #index offline between two simulated times (ms) */
  outages?: { cam: number; from: number; to: number }[];
  maxMs?: number;
  /** false = hands only, no forearms hiding squares */
  forearms?: boolean;
}

export interface RunResult {
  history: string[]; fen: string; events: ExperienceEvent[]; fired: string[]; lines: string[];
  /** ticks at which the tracker's history was NOT a prefix of the true game: must always be zero */
  violations: number; simMs: number; truth: string[]; graph: Graph; finished: boolean;
}

/**
 * Plays a scripted scenario on the virtual table, watched by virtual 3D cameras through the whole
 * shipped patch (readers -> fusion -> stabilizer -> tracker -> narrator / cues). Checks the safety
 * invariant on every tick: a wrong move must never be accepted.
 */
export function runScenario(id: string, o: RunOptions = {}): RunResult {
  const sc = scenarioById(id)!;
  virtualTable.reset(); virtualTable.seated = false; virtualTable.forearms = o.forearms ?? true;
  const cfg = defaultSetup(); cfg.cameras = (o.cams ?? ["A", "B"]).map((r) => virtualCamera(r)); cfg.demo = { autoplay: true, scenario: id }; cfg.opponent = { mode: "human", elo: 1000 };
  const g = new Graph(createRegistry()); buildGraphFromConfig(g, cfg);
  const by = (t: string) => [...g.nodes.values()].filter((n) => n.type === t);
  for (const cam of by("source.synthetic")) Object.assign(cam.params, { noise: o.noise ?? 8, gain: o.gain ?? 1, gradient: o.gradient ?? 0.15 });
  by("sim.scenario")[0].params.pauseMs = o.pauseMs ?? 1500;
  const tracker = by("game.tracker")[0], cues = by("scene.cues")[0];
  const truth = new Chess(); sc.moves.forEach((m) => truth.move(m)); const truthSan = truth.history();

  const events: ExperienceEvent[] = [], fired: string[] = [], lines: string[] = [];
  let violations = 0, now = 1000, history: string[] = [], finished = false;
  const sources = by("source.synthetic");
  const limit = o.maxMs ?? sc.moves.length * 7000 + 8000;
  for (; now < limit; now += 66) {
    for (const out of o.outages ?? []) sources[out.cam].params.online = !(now >= out.from && now < out.to);
    g.tick(now);
    const t = g.outputs.get(tracker.id);
    for (const e of (t?.events as ExperienceEvent[] | undefined) ?? []) events.push(e);
    for (const f of (g.outputs.get(cues.id)?.fired as { action: { do: string } }[] | undefined) ?? []) fired.push(f.action.do);
    history = (t?.game as { history: string[] } | undefined)?.history ?? history;
    if (history.some((m, i) => m !== truthSan[i])) violations++;
    if (history.length === sc.moves.length && !virtualTable.busy) { finished = true; if (now > 0) { for (let k = 0; k < 30; k++, now += 66) g.tick(now); history = (g.outputs.get(tracker.id)?.game as { history: string[] }).history; break; } }
  }
  for (const l of bus.lines) lines.push(l.text);
  return { history, fen: virtualTable.game.fen(), events, fired, lines, violations, simMs: now, truth: truthSan, graph: g, finished };
}
