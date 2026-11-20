import { defaultSetup, hasErrors, validateSetup } from "../../setup/config";
import { clamp, draftToGraph, parseDraft, type Draft } from "../../workflows/ai";
import { problems } from "../snapshot";
import { editCameras, patchSetup, type PatchResult } from "../setupPatch";
import type { AssistantHost } from "../host";
import { paramInfo } from "./inspect";
import { SECRET, obj, str, type ToolGroup } from "./shared";

/** Applies a patch to the setup unless it would leave the setup with errors it did not have before. Exported for tests. */
export function commitSetup(h: AssistantHost, res: PatchResult, why: string) {
  const base = h.setup() ?? defaultSetup();
  if (!res.applied.length) return { applied: [], rejected: res.rejected, note: "Nothing was changed." };
  const after = validateSetup(res.setup);
  if (!hasErrors(validateSetup(base)) && hasErrors(after)) return { applied: [], rejected: res.rejected, blocked_by: after.filter((i) => i.level === "error"), note: "Not applied: it would leave the setup with errors." };
  h.applySetup({ ...res.setup, completed: base.completed || res.setup.completed }, why);
  return { applied: res.applied, rejected: res.rejected, problems_now: problems(h), note: "Applied and the workflow was rebuilt. Ctrl+Z undoes it." };
}

/** Tools that change the setup or the workflow. All undoable; replacing the whole workflow asks first. */
export const configureTools: ToolGroup = (h) => {
  const base = () => h.setup() ?? defaultSetup();
  return [
    { name: "update_setup", risk: "write", undoable: true, label: { doing: "Changing the setup", done: "Changed the setup" }, description: "Change setup settings with a nested patch. Allowed: scene (auto|cavern|winter-forest|fire-watchtower|christmas-forest), rain/snow (-1..1, -1 = scene default), hour (-1..24), narrator{voices 1|2, nameA, nameB, speak, volume 0..1}, ai{engine builtin|openai, model}, voice{engine browser|elevenlabs, voiceIdA, voiceIdB}, opponent{mode menu|engine|human, elo}, projectors{count 0..4, dmx, dmxUrl}, tracking{pose}, demo{autoplay, scenario}. Never keys. Rebuilds the workflow; undoable.",
      parameters: obj({ changes: { type: "object", description: 'e.g. {"scene":"cavern","narrator":{"voices":1}}' } }, ["changes"]),
      run: (a) => commitSetup(h, patchSetup(base(), a.changes ?? {}), "Before assistant change") },

    { name: "camera", risk: "write", undoable: true, label: { doing: "Changing cameras", done: "Changed cameras" }, description: "Add, update or remove a camera in the setup. update.set keys: online, channel (luma|red|green|blue), trust 0..2, fov 10..120, label, corners (\"x,y;x,y;x,y;x,y\" = a8;h8;h1;a1 in 480x360 px). New webcams start offline until a device is chosen in Setup. Rebuilds the workflow; undoable.",
      parameters: obj({ action: str("what to do", { enum: ["add", "update", "remove"] }), id: str("camera id for update/remove, e.g. A"), kind: str("add: virtual or webcam", { enum: ["virtual", "webcam"] }), rig: str("add virtual: A, B or C"), label: str("add webcam: a name"), set: { type: "object", description: "update: the fields to change" } }, ["action"]),
      run: (a) => commitSetup(h, a.action === "add" ? editCameras(base(), { action: "add", kind: a.kind === "webcam" ? "webcam" : "virtual", rig: a.rig, label: a.label }) : a.action === "remove" ? editCameras(base(), { action: "remove", id: a.id }) : editCameras(base(), { action: "update", id: a.id, set: a.set ?? {} }), `Before assistant camera ${a.action}`) },

    { name: "set_node_param", risk: "write", undoable: true, label: { doing: "Setting a parameter", done: "Set a parameter" }, description: "Set one parameter of one workflow node, clamped to its allowed range or options. Use get_node first to see what is allowed. Secrets are refused.",
      parameters: obj({ node_id: str("node id"), param: str("parameter id"), value: { description: "number, boolean or string", type: ["number", "boolean", "string"] } }, ["node_id", "param", "value"]),
      run: (a) => {
        const n = h.graph().nodes.find((x) => x.id === a.node_id); if (!n) throw new Error(`No node "${a.node_id}".`);
        if (SECRET.test(a.param)) throw new Error("Secrets are never set through chat.");
        const def = h.registry.get(n.type)?.params?.find((p) => p.id === a.param);
        if (def?.kind === "text" && def.secret) throw new Error("Secrets are never set through chat.");
        if (!def || def.kind === "separator") throw new Error(`${n.type} has no parameter "${a.param}". Allowed: ${paramInfo(h.registry, n.type).map((p) => p.id).join(", ")}.`);
        const v = clamp(def, a.value); if (v === undefined) throw new Error(`"${a.value}" is not valid for ${a.param}: ${JSON.stringify(paramInfo(h.registry, n.type).find((p) => p.id === a.param))}`);
        const was = n.params[a.param]; h.setParam(n.id, a.param, v);
        return { node: n.id, param: a.param, was, now: v, clamped: v !== a.value, problems_now: problems(h) };
      } },

    { name: "set_bypass", risk: "write", undoable: true, label: { doing: "Switching a node", done: "Switched a node" }, description: "Turn a node off (bypass: it is skipped, not deleted) or back on.",
      parameters: obj({ node_id: str("node id"), bypass: { type: "boolean" } }, ["node_id", "bypass"]),
      run: (a) => { if (!h.setBypass(a.node_id, !!a.bypass)) throw new Error(`No node "${a.node_id}".`); return { node: a.node_id, bypass: !!a.bypass }; } },

    { name: "apply_workflow", risk: "danger", undoable: true, label: { doing: "Replacing the workflow", done: "Replaced the workflow" }, description: "Replace the WHOLE workflow with one you design. Pass the draft: {name, summary, nodes:[{id,type,params}], edges:[{from:'node.outPort',to:'node.inPort'}]}. Use list_node_types for valid types and ports; prefer update_setup for ordinary changes. The person is asked to approve; the old one is backed up.",
      parameters: obj({ draft: { type: "object", description: "the workflow draft" } }, ["draft"]),
      describe: (a) => `Replace the whole workflow with "${a?.draft?.name ?? "a new workflow"}" (${a?.draft?.nodes?.length ?? 0} nodes). The current one is backed up and Ctrl+Z restores it.`,
      run: (a) => {
        const d: Draft | null = typeof a.draft === "string" ? parseDraft(a.draft) : a.draft;
        const b = draftToGraph(h.registry, d ?? {});
        if (!b.graph.nodes.length) throw new Error(`No usable nodes in the draft. ${b.warnings.slice(0, 5).join(" ")}`);
        h.applyGraph(b.graph, `Before assistant workflow: ${b.name}`);
        return { applied: b.name, nodes: b.graph.nodes.length, wires: b.graph.edges.length, left_out: b.warnings.slice(0, 8), problems_now: problems(h) };
      } },
  ];
};
