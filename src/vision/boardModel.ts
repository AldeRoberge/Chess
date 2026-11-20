import { BoardCnn, type BoardCnnJson } from "./boardCnn";
import { BoardSampler } from "./sampler";

/** Loads the trained whole-board reader (split into its own chunk) and hands it to every BoardSampler. */
export async function loadBoardCnn(): Promise<BoardCnn> {
  if (BoardSampler.boardNet) return BoardSampler.boardNet;
  const json = (await import("./boardCnn.weights.json")).default as unknown as BoardCnnJson;
  return (BoardSampler.boardNet = new BoardCnn(json));
}
