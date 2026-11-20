import { ViewCnn, type ViewCnnJson } from "./viewCnn";

let loaded: ViewCnn | null = null;
/** Loads the trained masked-view reader (split into its own chunk). */
export async function loadViewCnn(): Promise<ViewCnn> {
  if (loaded) return loaded;
  const json = (await import("./viewCnn.weights.json")).default as unknown as ViewCnnJson;
  return (loaded = new ViewCnn(json));
}
