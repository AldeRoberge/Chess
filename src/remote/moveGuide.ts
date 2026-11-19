import { Chess } from "chess.js";
import type { RemoteState } from "./protocol";
import { drawChevrons } from "../world/chevrons";

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
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 800; canvas.className = "rm-guide-lines";
  const ctx = canvas.getContext("2d");
  let routes: { a: { x: number; y: number }; b: { x: number; y: number } }[] = [];
  let frame = 0, lastFrame = -Infinity;
  const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const paint = (now: number) => {
    if (ctx && now - lastFrame >= 1000 / 30) {
      lastFrame = now; ctx.clearRect(0, 0, 800, 800);
      for (const route of routes) drawChevrons(ctx, route.a, route.b, 100, reduceMotion() ? 0 : now / 1000);
    }
    if (routes.length && !reduceMotion()) frame = requestAnimationFrame(paint);
  };
  let key = "";
  return {
    el: layer,
    stop() { cancelAnimationFrame(frame); routes = []; },
    update(moves: GuideMove[], flipped: boolean, set: string) {
      const next = JSON.stringify([moves, flipped, set]); if (next === key) return;
      key = next; cancelAnimationFrame(frame); routes = []; layer.replaceChildren();
      if (moves.length) layer.append(canvas);
      const xy = (sq: string) => {
        const x = "abcdefgh".indexOf(sq[0]), y = 8 - Number(sq[1]);
        return flipped ? [7 - x, 7 - y] : [x, y];
      };
      moves.forEach((move, i) => {
        if (!/^[a-h][1-8]$/.test(move.from) || !/^[a-h][1-8]$/.test(move.to) || !/^[wb][prnbqk]$/.test(move.code)) return;
        const [x, y] = xy(move.from), [tx, ty] = xy(move.to);
        const dx = tx - x, dy = ty - y;
        routes.push({ a: { x: (x + 0.5) * 100, y: (y + 0.5) * 100 }, b: { x: (tx + 0.5) * 100, y: (ty + 0.5) * 100 } });
        for (const ghost of [true, false]) {
          const image = document.createElement("img"); image.src = `${base}pieces/${set}/${move.code}.svg`; image.alt = "";
          image.className = ghost ? "rm-guide-ghost" : "rm-guide-piece";
          image.style.left = `${(ghost ? tx : x) * 12.5}%`; image.style.top = `${(ghost ? ty : y) * 12.5}%`;
          image.style.setProperty("--dx", `${dx * 100}%`); image.style.setProperty("--dy", `${dy * 100}%`);
          image.style.animationDelay = `${i * -0.3}s`; layer.append(image);
        }
      });
      lastFrame = -Infinity; paint(performance.now());
    },
  };
}
