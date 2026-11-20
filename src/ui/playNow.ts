import { buildBotPlay, type BotPlayOptions, type Presence, type Start } from "../setup/botPlay";
import { bus } from "../core/bus";
import { virtualTable } from "../sim/virtualTable";
import { loadSetup } from "../setup/config";
import { modal, type WorkflowApi } from "./workflows";
import { BUTTON_ICON, withIcon } from "./icons";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };

/** "Play now against bot": pick who starts, how you are present, the bot's strength, and play immediately. */
export function openPlayNow(api: WorkflowApi, onPlay: () => void = () => {}) {
  const m = modal("Play now against the bot", "Play now against the bot");
  const o: BotPlayOptions = { start: "me-white", presence: "simulated", elo: 1200 };
  const group = <T extends string>(label: string, opts: [T, string][], get: () => T, set: (v: T) => void) => {
    const row = el("div", "wf-field"); row.append(el("span", "", label));
    const bar = el("div", "bk-bar");
    const draw = () => { for (const b of Array.from(bar.children) as HTMLButtonElement[]) b.classList.toggle("primary", b.dataset.v === get()); };
    for (const [v, text] of opts) { const b = withIcon(el("button", "", text), v === "real" ? "camera" : v === "simulated" ? "hand" : "opponent"); b.type = "button"; b.dataset.v = v; b.onclick = () => { set(v); draw(); }; bar.append(b); }
    draw(); row.append(bar); return row;
  };
  const elo = el("input"); elo.type = "range"; elo.min = "500"; elo.max = "2500"; elo.step = "100"; elo.value = String(o.elo);
  const eloLabel = el("span", "", `Bot strength: ${o.elo}`);
  elo.oninput = () => { o.elo = Number(elo.value); eloLabel.textContent = `Bot strength: ${o.elo}`; };
  const eloRow = el("label", "wf-field"); eloRow.append(eloLabel, elo);
  const play = withIcon(el("button", "primary", "Play now"), BUTTON_ICON["Play now"]); play.type = "button";
  play.onclick = () => {
    const r = buildBotPlay(api.registry, o, loadSetup());
    virtualTable.reset(); bus.engineHint = null; // the table outlives the workflow: cameras must learn the start position, not the last game
    api.apply(r.graph, r.setup, "Before playing the bot");
    m.close(); onPlay();
  };
  m.body.append(
    el("p", "bk-note", "Starts a game against Stockfish right away. Your current workflow is backed up first (Ctrl+Z brings it back)."),
    group<Start>("Who starts?", [["me-white", "Me (White)"], ["me-black", "Bot (I play Black)"], ["random", "Random"]], () => o.start, (v) => (o.start = v)),
    group<Presence>("Me at the table", [["simulated", "Simulate me (mouse)"], ["webcams", "Real me (webcams)"]], () => o.presence, (v) => (o.presence = v)),
    eloRow, play);
  play.focus();
  return m;
}
