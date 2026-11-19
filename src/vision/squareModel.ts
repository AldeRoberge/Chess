import { BoardSampler } from "./sampler";
import { SquareCnn, type CnnJson } from "./squareCnn";

/** Loads the trained square classifier (about 300 KB, split into its own chunk) and hands it to every BoardSampler. */
export async function loadSquareCnn(): Promise<SquareCnn> {
  if (BoardSampler.cnn) return BoardSampler.cnn;
  const json = (await import("./squareCnn.weights.json")).default as unknown as CnnJson;
  return (BoardSampler.cnn = new SquareCnn(json));
}
