import { Chess } from "chess.js";
import type { RemoteState } from "./protocol";

export interface GuideMove { from: string; to: string; code: string }

export function guideMoves(state: RemoteState | null): GuideMove[] {
  if (!state) return [];
  if (state.setupMoves?.length) return state.setupMoves.slice(0, 3);
  const move = state.hint ?? state.last;
  if (!move) return [];
  const game = new Chess(state.fen), pc = game.get((state.hint ? move.from : move.to) as never);
  return pc ? [{ ...move, code: pc.color + pc.type }] : [];
}

/** A persistent overlay so fresh phone polls never restart the animation. */
export function createMoveGuide(base: string) {
  const layer = document.createElement("div"); layer.className = "rm-guide"; layer.setAttribute("aria-hidden", "true");
  let key = "";
  return {
    el: layer,
    update(moves: GuideMove[], flipped: boolean, set: string) {
      const next = JSON.stringify([moves, flipped, set]); if (next === key) return;
      key = next; layer.replaceChildren();
      const xy = (sq: string) => {
        const x = "abcdefgh".indexOf(sq[0]), y = 8 - Number(sq[1]);
        return flipped ? [7 - x, 7 - y] : [x, y];
      };
      moves.forEach((move, i) => {
        if (!/^[a-h][1-8]$/.test(move.from) || !/^[a-h][1-8]$/.test(move.to) || !/^[wb][prnbqk]$/.test(move.code)) return;
        const [x, y] = xy(move.from), [tx, ty] = xy(move.to);
        const line = document.createElementNS("http://www.w3.org/2000/svg", "svg"); line.setAttribute("viewBox", "0 0 800 800");
        const dx = tx - x, dy = ty - y, angle = Math.atan2(dy, dx) * 180 / Math.PI;
        for (const t of [0.25, 0.5, 0.75]) {
          const arrow = document.createElementNS(line.namespaceURI, "path"); arrow.setAttribute("d", "M -9 -10 L 3 0 L -9 10");
          arrow.setAttribute("transform", `translate(${(x + 0.5 + dx * t) * 100} ${(y + 0.5 + dy * t) * 100}) rotate(${angle})`);
          line.append(arrow);
        }
        layer.append(line);
        for (const ghost of [true, false]) {
          const image = document.createElement("img"); image.src = `${base}pieces/${set}/${move.code}.svg`; image.alt = "";
          image.className = ghost ? "rm-guide-ghost" : "rm-guide-piece";
          image.style.left = `${(ghost ? tx : x) * 12.5}%`; image.style.top = `${(ghost ? ty : y) * 12.5}%`;
          image.style.setProperty("--dx", `${dx * 100}%`); image.style.setProperty("--dy", `${dy * 100}%`);
          image.style.animationDelay = `${i * -0.3}s`; layer.append(image);
        }
      });
    },
  };
}
