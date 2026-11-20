import type { BoardBelief, GrayFrame, Pt } from "./types";

/**
 * Keeps real camera pictures for training the square classifier (ml/README: `npm run dev` then play).
 * A picture is sent to the dev server only when the tracker's confirmed position and what this camera sees agree on all 64
 * squares (piece or not, and colour), the board is settled with no hand over it, and the position is new for this camera
 * (or a minute old, for lighting variety). So the label is the game's own legal position, never a guess, and nothing is sent in a production build.
 */
const last = new Map<string, { placement: string; at: number }>();
const MIN_GAP_MS = 4000, SAME_POSITION_MS = 60000, MIN_FIDELITY = 0.9, MIN_CONF = 0.8;

/** FEN piece placement -> per square (0 = a8): 0 empty, 1 white, 2 black. */
export function placementOf(fen: string): number[] | null {
  const out: number[] = [];
  for (const ch of fen.split(" ")[0]) {
    if (ch === "/") continue;
    if (ch >= "1" && ch <= "8") for (let i = 0; i < Number(ch); i++) out.push(0);
    else out.push(ch === ch.toUpperCase() ? 1 : 2);
  }
  return out.length === 64 ? out : null;
}

/** True when the belief matches the position on every square with enough confidence to be a label. */
export function agrees(board: BoardBelief, truth: number[]): boolean {
  if (!board.settled || board.handOver || board.fidelity < MIN_FIDELITY) return false;
  for (let sq = 0; sq < 64; sq++) {
    if (board.conf[sq] < MIN_CONF || (board.occ[sq] > 0.5) !== (truth[sq] !== 0)) return false;
    if (truth[sq] !== 0 && (board.white[sq] > 0.5) !== (truth[sq] === 1)) return false;
  }
  return true;
}

function base64(bytes: Uint8ClampedArray): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function collectFrame(o: { cam: string; frame: GrayFrame; corners: Pt[]; fen: string | undefined; board: BoardBelief | null }, now = Date.now()): boolean {
  if (!import.meta.env.DEV || !o.fen || !o.board || o.corners.length !== 4) return false;
  const truth = placementOf(o.fen);
  if (!truth || !agrees(o.board, truth)) return false;
  const placement = o.fen.split(" ")[0], prev = last.get(o.cam);
  if (prev && (now - prev.at < MIN_GAP_MS || (prev.placement === placement && now - prev.at < SAME_POSITION_MS))) return false;
  last.set(o.cam, { placement, at: now });
  void fetch("/__collect", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ cam: o.cam, fen: placement, width: o.frame.width, height: o.frame.height, corners: o.corners, data: base64(o.frame.data) }),
  }).catch(() => {});
  return true;
}
