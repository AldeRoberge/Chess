import { ViewCnn, type ViewCnnJson } from "./viewCnn";

let loaded: ViewCnn | null = null;
/** Loads the trained masked-view reader (split into its own chunk). */
export async function loadViewCnn(): Promise<ViewCnn> {
  if (loaded) return loaded;
  // import.meta.glob (unlike a plain import) builds even before `ml/train_view.py` has written the weights file.
  const files = import.meta.glob("./viewCnn.weights.json");
  const load = files["./viewCnn.weights.json"];
  if (!load) throw new Error("viewCnn.weights.json not found: run ml/train_view.py");
  const json = ((await load()) as { default: unknown }).default as ViewCnnJson;
  return (loaded = new ViewCnn(json));
}
