import { PAGE_TITLES, PAGES } from "../ui/route";
import { STEPS, settingSearchEntries } from "../ui/wizardSteps";
import { defaultSetup } from "../setup/config";
import { PARAM_DOCS } from "../ui/paramDocs";
import type { AssistantHost } from "./host";

export interface UIControl {
  id: string | null;
  kind: string;
  label: string;
  section: string;
  visible: boolean;
  disabled: boolean;
  description?: string;
  shortcut?: string;
  value?: string | boolean;
  options?: { value: string; label: string }[];
}
export interface UIContext {
  mode: "simple" | "nodes";
  focus: string | null;
  dialogs: string[];
  controls: UIControl[];
  text: string[];
}
const clean = (s: string | null | undefined, max = 240) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const excluded = (e: Element) => !!e.closest(".as, .as-keybox, script, style");
const label = (e: HTMLElement) => clean(e.getAttribute("aria-label") || e.dataset.tip || e.getAttribute("title") || (e instanceof HTMLInputElement ? e.labels?.[0]?.textContent || e.placeholder || e.name : e.textContent));

/** Semantic inventory, including hidden ribbon commands. Never read text/password field values. */
export function readUI(doc: Document, roots: ParentNode[] = []): UIContext {
  const query = (selector: string) => [...new Set([doc, ...roots].flatMap(root => [...root.querySelectorAll<HTMLElement>(selector)]))];
  const visible = (e: HTMLElement) => {
    if (!e.isConnected) return false;
    if (e.closest("[hidden], [aria-hidden=true], [inert]")) return false;
    for (let p: HTMLElement | null = e; p; p = p.parentElement) {
      const style = doc.defaultView?.getComputedStyle(p);
      if (style?.display === "none" || style?.visibility === "hidden") return false;
    }
    return true;
  };
  const controls = query("button, select, input, textarea, [role=button], [role=menuitem], .halo-item, a[href]").filter(e => !excluded(e)).map(e => {
    const field = e instanceof HTMLInputElement || e instanceof HTMLSelectElement || e instanceof HTMLTextAreaElement;
    const secret = /key|token|secret|password/i.test(`${e.id} ${e.getAttribute("name")} ${label(e)}`) || e.getAttribute("type") === "password";
    const section = e.closest<HTMLElement>(".halo-pane, .rpane, .panel, [role=dialog], .rmenu, .ne-node");
    return {
      id: e.id || null, kind: e.getAttribute("role") || (e instanceof HTMLInputElement ? e.type : e.tagName.toLowerCase()), label: label(e),
      section: clean(section?.querySelector("h2, h3, .ne-title")?.textContent || section?.dataset.rpane || section?.className || "App"),
      visible: visible(e), disabled: e.matches(":disabled, [aria-disabled=true], .disabled"),
      ...(e.dataset.tipBody ? { description: clean(e.dataset.tipBody, 500) } : {}),
      ...(e.dataset.tipKeys ? { shortcut: clean(e.dataset.tipKeys) } : {}),
      ...(secret ? {} : e instanceof HTMLSelectElement ? { value: e.value, options: [...e.options].map(o => ({ value: o.value, label: clean(o.text) })) }
        : e instanceof HTMLInputElement && /^(checkbox|radio)$/.test(e.type) ? { value: e.checked }
        : e.getAttribute("aria-pressed") ? { value: e.getAttribute("aria-pressed") === "true" }
        : field ? {} : {}),
    };
  });
  const text = query("h1,h2,h3,p,.halo-hint,.halo-value,.sys-note,[role=status],[role=alert]")
    .filter(e => !excluded(e) && visible(e)).map(e => clean(e.textContent, 400)).filter(Boolean);
  return {
    mode: doc.body.classList.contains("simple") ? "simple" : "nodes",
    focus: doc.activeElement instanceof HTMLElement && doc.activeElement !== doc.body && doc.activeElement !== doc.documentElement && !excluded(doc.activeElement) ? label(doc.activeElement) || null : null,
    dialogs: [...doc.querySelectorAll<HTMLElement>("[role=dialog],dialog[open],.halo")].filter(visible).map(e => clean(e.getAttribute("aria-label") || e.querySelector("h2,h3")?.textContent || "Dialog")),
    controls, text: [...new Set(text)],
  };
}

/** Product knowledge complements the live DOM: detached pages still have discoverable features. */
export const APP_FEATURES = [
  { path: "Game", about: "Live board, side to move, last move, legal moves, clocks, engine opponent, human play, rematch and bot reconciliation. Tracked physical board and virtual table may differ.", tools: ["get_game", "analyze_game", "get_move_history", "table_play", "table_reset", "table_seat"], how: "Click a piece then its destination. Physical moves are accepted by the tracker after stable camera readings. Player names are only known when explicitly available; colors are not identities." },
  { path: "Workflow / nodes", about: "Sources → vision → game → experience / narration / scenes → outputs. Inspect each node's typed ports, parameters, errors and connections.", tools: ["get_workflow", "get_node", "list_node_types", "add_node", "duplicate_nodes", "remove_nodes", "move_nodes", "connect_nodes", "disconnect_nodes", "set_node_param", "set_bypass", "reveal_node"], how: "View > Show nodes. Select nodes and choose Duplicate in the ribbon, or right-click a node > Duplicate. Drag an output port to a compatible input port to connect. Each input accepts one wire. Delete/Backspace removes selected nodes when the editor has focus. Undo Ctrl+Z; redo Ctrl+Y. Duplicate copies settings; wires are optional through the assistant." },
  { path: "World / projection", about: "3D room, camera frusta, surface scanning, projector alignment, warping, planes, piece and clock projections. Use node catalog for projection/output parameters; inspect World UI for mapping controls.", tools: ["navigate", "get_ui", "list_node_types", "get_node", "set_node_param"] },
  { path: "Log", about: "Recent move, capture, check, mate, illegal-position, player-seat, director and narration events, in time order.", tools: ["get_events", "get_state", "navigate"] },
  { path: "Performance", about: "Frame timeline, flamegraph and node timings. Open Performance to capture; graph heat/timings show costly nodes. Render quality, frame rate, antialiasing and shadows can be changed.", tools: ["navigate", "get_ui", "get_view_settings", "set_view_settings"] },
  { path: "Appearance", about: "App theme and light/dark/system mode, board and piece styles, board flip, coordinates, legal moves, engine hints, last-move highlight, camera frusta, render quality.", tools: ["get_view_settings", "set_view_settings", "navigate", "get_ui"] },
  { path: "Sound / narration", about: "Enable sound with a user gesture, mute/unmute, Mixer levels for ambience/effects/music/narrators; commentator slots and AI/voice engines live in Settings.", tools: ["app_action", "get_state", "update_setup", "navigate", "get_ui"] },
  { path: "Files / backups", about: "Open saved workflow Ctrl+O; export Ctrl+S; restore points and crash recovery; create a backup before experiments. Full workflow replacement is backed up and undoable.", tools: ["app_action", "undo", "redo", "apply_workflow"] },
  { path: "Phone remote", about: "Phone button opens pairing so a phone can watch moves, camera and play. Inspect the actual connection UI for status; never invent a pairing URL.", tools: ["get_ui", "navigate"] },
  { path: "Assistant", about: "Chat and speech, Stop, queued messages, tool results and undo cards, approval for full replacement, setup guide. Reads live state before every tool step. Cannot see raw camera images or private API keys.", tools: ["get_app_map", "get_ui", "diagnose", "ask_user", "wait_for_event"] },
];

export function appMap(h: AssistantHost) {
  return {
    pages: [...PAGES.map(page => ({ path: PAGE_TITLES[page], route: { page } })), { path: "Settings", route: { page: "settings" } }],
    features: [...APP_FEATURES, ...STEPS.map(s => ({ path: `Settings / ${s.title}`, about: s.blurb, route: { page: "settings", step: s.id } }))],
    settings_controls: settingSearchEntries(h.setup() ?? defaultSetup()).map(e => ({ path: `${e.location} / ${e.label}`, about: e.text, route: { page: "settings", step: e.step } })),
    node_types: h.registry.all().map(n => ({ path: `Nodes / ${n.category} / ${n.title}`, type: n.type, about: n.desc, inputs: n.inputs, outputs: n.outputs })),
    parameter_help: Object.entries(PARAM_DOCS).filter(([id]) => !/key|token|secret|password/i.test(id)).map(([id, about]) => ({ path: `Parameters / ${id}`, about })),
  };
}
