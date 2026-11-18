/** A node failure turned into words a person can act on. `detail` keeps the raw technical text for the curious. */
export interface NodeErrorInfo {
  /** One plain sentence: what went wrong. */
  message: string;
  /** What to try next (may be empty). */
  hint: string;
  /** The original error text, for debugging. */
  detail: string;
}

const RULES: { test: RegExp; message: string; hint: string }[] = [
  { test: /NotAllowedError|Permission denied|permission.*(denied|dismissed)/i, message: "The browser blocked access to a camera or microphone.", hint: "Allow it in the address bar, then reload the page." },
  { test: /NotFoundError|Requested device not found|no (camera|device)/i, message: "No matching camera or device was found.", hint: "Plug it in, then press Retry or reload." },
  { test: /NotReadableError|Could not start video source|in use/i, message: "The device is busy or can't be opened.", hint: "Close other apps that use the camera, then retry." },
  { test: /Failed to fetch|NetworkError|Load failed|ERR_(NETWORK|INTERNET|CONNECTION)/i, message: "A file or service couldn't be reached over the network.", hint: "Check your connection or that the server is running." },
  { test: /JSON|Unexpected token|Unexpected end of/i, message: "Some data was in a format this node couldn't read.", hint: "Check the file or text you gave it." },
  { test: /WebAssembly|wasm|model/i, message: "A model or engine this node needs failed to load.", hint: "Reload the page; if it keeps happening, check the model files." },
  { test: /Cannot read propert|undefined is not|null is not|is not (a function|iterable)|of (undefined|null)/i, message: "This node received a value it didn't expect.", hint: "Check that every input is wired to the right port." },
  { test: /out of memory|Array buffer allocation|Invalid (array|typed array) length/i, message: "This node ran out of memory.", hint: "Lower its resolution or size settings." },
  { test: /illegal move|invalid move|Invalid FEN|Invalid fen/i, message: "The chess position or move wasn't valid.", hint: "Check the board or move data feeding this node." },
];

export function describeError(err: unknown): NodeErrorInfo {
  const raw = err instanceof Error ? (err.name && err.name !== "Error" ? `${err.name}: ${err.message}` : err.message) : String(err);
  const detail = raw.replace(/^Error:\s*/, "").trim() || "Unknown error";
  const hit = RULES.find((r) => r.test.test(detail) || (err instanceof Error && r.test.test(err.name)));
  if (hit) return { message: hit.message, hint: hit.hint, detail };
  return { message: `This node stopped with an error: ${detail}`, hint: "Try bypassing it, or check its inputs and settings.", detail };
}
