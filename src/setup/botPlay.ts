import { Graph } from "../core/graph";
import { organize } from "../core/groups";
import type { GraphJSON, Registry } from "../core/types";
import { buildGraphFromConfig, defaultSetup, virtualCamera, webcamSetup, type SetupConfig } from "./config";

export type Start = "me-white" | "me-black" | "random";
export type Presence = "simulated" | "webcams";
export interface BotPlayOptions { start: Start; presence: Presence; elo: number }

/** The colour the bot plays; "random" flips a coin (injectable for tests). */
export function botColor(start: Start, rnd: () => number = Math.random): "w" | "b" {
  if (start === "me-white") return "b";
  if (start === "me-black") return "w";
  return rnd() < 0.5 ? "w" : "b";
}

/**
 * One-click game against Stockfish: the usual patch with a fixed bot opponent, the human seated at once.
 * Simulated: virtual cameras, the bot's virtual hand moves its own pieces. Webcams: your cameras watch the real board,
 * the bot only announces its move (chevrons show which physical piece to move) and people tracking supplies your presence.
 */
export function buildBotPlay(registry: Registry, o: BotPlayOptions, base: SetupConfig | null = null, rnd: () => number = Math.random): { graph: GraphJSON; setup: SetupConfig; bot: "w" | "b" } {
  const bot = botColor(o.start, rnd), d = defaultSetup(), b = base ?? d;
  const webcams = o.presence === "webcams";
  const cams = webcams ? (b.cameras.some((c) => c.kind === "webcam") ? b.cameras.filter((c) => c.kind === "webcam") : [webcamSetup("", "Webcam", "A")]) : [virtualCamera("A"), virtualCamera("B")];
  const setup: SetupConfig = { ...b, completed: true, cameras: cams, opponent: { mode: "engine", elo: o.elo }, tracking: { pose: webcams }, demo: { autoplay: false, scenario: b.demo.scenario } };
  const g = new Graph(registry);
  buildGraphFromConfig(g, setup);
  for (const n of g.nodes.values()) {
    if (n.type === "game.engine") { n.params.color = bot; n.params.virtualHand = !webcams; }
    if (n.type === "sim.person") n.params.seated = true;
    if (n.type === "experience.director") n.params.introMs = 1000; // shortest the intro slider allows; the 6s kiosk intro is too long for a bot game
    if (n.type === "narration.narrator") n.params.setupChatter = false; // you press Play often: skip the seat / opponent / intro lines
    if (n.type === "narration.narrator" || n.type === "narration.ai" || n.type === "narration.speech") n.params.language = "en"; // the chrome is English
  }
  const graph = g.toJSON();
  organize(graph); // role bands with titled sections, same as the Organize button: the raw build coordinates overlap
  return { graph, setup, bot };
}
