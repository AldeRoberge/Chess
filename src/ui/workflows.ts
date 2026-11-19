import type { GraphJSON, Registry } from "../core/types";
import type { SetupConfig } from "../setup/config";
import { AiSession, loadAiSettings, saveAiSettings, type Built } from "../workflows/ai";
import { WORKFLOWS } from "../workflows";
import { withSpinner } from "./spinner";
import { BUTTON_ICON, withIcon } from "./icons";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
const btn = (label: string, fn: () => void, cls = "") => { const b = el("button", cls, label); b.type = "button"; b.onclick = fn; return BUTTON_ICON[label] ? withIcon(b, BUTTON_ICON[label]) : b; };

export interface WorkflowApi {
  registry: Registry;
  current(): GraphJSON;
  /** Replace the workflow (and setup when given). The app backs up what you had and makes it undoable. */
  apply(graph: GraphJSON, setup: SetupConfig | null, why: string): void;
  openFile(file: File): void;
  fetchImpl?: typeof fetch;
}

/** Opens a modal shell (same look as Backups). Esc or the backdrop closes it. */
export function modal(title: string, label: string) {
  document.querySelector(".bk")?.remove();
  const root = el("div", "bk"), card = el("div", "bk-card wf"); card.setAttribute("role", "dialog"); card.setAttribute("aria-label", label);
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  const close = () => { root.remove(); document.removeEventListener("keydown", onKey, true); };
  document.addEventListener("keydown", onKey, true);
  root.onclick = (e) => { if (e.target === root) close(); };
  const head = el("div", "bk-head"); head.append(el("h3", "", title), btn("Close", close, "ghost"));
  const body = el("div", "wf-body"); card.append(head, body); root.append(card); document.body.append(root);
  return { close, body, head: head.querySelector("h3")! };
}

/** Demo workflows, "build with AI", and open-from-file. */
export function openWorkflowPanel(api: WorkflowApi) {
  const m = modal("Workflow", "Workflow");
  const file = el("input"); file.type = "file"; file.accept = ".ce.json,application/json,.json"; file.hidden = true;
  file.onchange = () => { const f = file.files?.[0]; if (f) { api.openFile(f); m.close(); } };
  const ai = el("div", "wf-ai");
  const aiText = el("div"); aiText.append(el("b", "", "Build your own with AI"), el("span", "", "Describe what you want and a model drafts the workflow. You review it before anything changes."));
  ai.append(aiText, btn("Start", () => { m.close(); openAiWizard(api); }, "primary"));
  const rows = WORKFLOWS.map((w) => {
    const row = el("div", "bk-row wf-row"), info = el("div", "bk-info");
    info.append(el("b", "", w.name), el("span", "wf-desc", w.description), el("span", "", `${w.graph.nodes.length} nodes · ${w.graph.edges.length} wires`));
    row.append(info, btn("Load", () => { api.apply(w.graph, w.setup, `Before workflow: ${w.name}`); m.close(); }));
    return row;
  });
  const foot = el("div", "bk-bar"); foot.append(btn("Open workflow file…", () => file.click()), file);
  m.body.append(el("p", "bk-note", "Loading a demo replaces the current workflow. It is backed up first, and Ctrl+Z brings it back."), ...rows, ai, foot);
  return m;
}

/** Two steps: describe, then review (with optional revisions) before applying. */
export function openAiWizard(api: WorkflowApi) {
  const m = modal("Build with AI", "AI workflow wizard");
  const saved = loadAiSettings();
  let session: AiSession | null = null;

  const describe = () => {
    m.body.replaceChildren();
    const ask = el("textarea", "wf-text"); ask.rows = 6; ask.placeholder = "e.g. Track my chess board with two cameras, narrate in a calm voice, play rain and thunder when a queen is captured, and let me play against chess.com user MyName.";
    const from = el("select"); from.append(new Option("Start from scratch", "blank"), new Option("Modify my current workflow", "current"));
    const key = el("input"); key.type = "password"; key.placeholder = "OpenAI API key (sk-...)"; key.value = saved.apiKey; key.autocomplete = "off";
    const model = el("input"); model.type = "text"; model.value = saved.model;
    const remember = el("input"); remember.type = "checkbox"; remember.checked = saved.remember;
    const status = el("p", "wf-status"); status.setAttribute("role", "status");
    const go = btn("Generate workflow", async () => {
      if (!ask.value.trim()) { status.textContent = "Describe the workflow you want first."; return; }
      if (!key.value.trim()) { status.textContent = "Enter an OpenAI API key."; return; }
      saveAiSettings({ apiKey: key.value, model: model.value.trim(), remember: remember.checked });
      session = new AiSession(api.registry, { apiKey: key.value, model: model.value.trim() }, from.value === "current" ? api.current() : undefined, api.fetchImpl);
      go.disabled = true; status.replaceChildren(withSpinner("Thinking… this usually takes 5 to 20 seconds.", "pawn", 20));
      try { review(await session.ask(ask.value.trim())); } catch (e) { status.textContent = (e as Error).message; go.disabled = false; }
    }, "primary");
    const field = (label: string, input: HTMLElement) => { const l = el("label", "wf-field"); l.append(el("span", "", label), input); return l; };
    const keep = el("label", "chk"); keep.append(remember, el("span", "", "Remember the key in this browser (stored unencrypted)"));
    m.body.append(
      el("p", "bk-note", "Your description is sent to OpenAI with your own API key, straight from this page. Nothing else leaves your machine: key-like settings in your workflow are never included."),
      field("What should it do?", ask), field("Start", from), field("API key", key), keep, field("Model", model), status, go);
    ask.focus();
  };

  const review = (b: Built) => {
    m.body.replaceChildren();
    const types = new Map<string, number>(); for (const n of b.graph.nodes) types.set(n.type, (types.get(n.type) ?? 0) + 1);
    const list = el("ul", "wf-nodes"); for (const [t, n] of types) list.append(el("li", "", n > 1 ? `${t} ×${n}` : t));
    const tweak = el("textarea", "wf-text"); tweak.rows = 2; tweak.placeholder = "Want a change? e.g. add a second camera, or make the narrator one voice.";
    const status = el("p", "wf-status"); status.setAttribute("role", "status");
    const revise = btn("Revise", async () => {
      if (!tweak.value.trim() || !session) return;
      revise.disabled = true; status.replaceChildren(withSpinner("Revising…", "orbit", 20));
      try { review(await session.ask(tweak.value.trim())); } catch (e) { status.textContent = (e as Error).message; revise.disabled = false; }
    });
    const bar = el("div", "bk-bar"); bar.append(btn("Apply workflow", () => { api.apply(b.graph, null, `Before AI workflow: ${b.name}`); m.close(); }, "primary"), btn("Start over", describe, "ghost"));
    m.body.append(el("h4", "", b.name), el("p", "wf-desc", b.summary), el("p", "bk-note", `${b.graph.nodes.length} nodes · ${b.graph.edges.length} wires`), list);
    if (b.warnings.length) { const w = el("div", "wf-warn"); w.append(el("b", "", `${b.warnings.length} thing${b.warnings.length > 1 ? "s" : ""} the model got wrong were left out`), ...b.warnings.slice(0, 6).map((x) => el("span", "", x))); m.body.append(w); }
    m.body.append(tweak, revise, status, bar, el("p", "bk-note", "Applying backs up your current workflow first, and Ctrl+Z undoes it."));
  };

  describe();
  return m;
}
