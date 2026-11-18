import { describe, expect, it } from "vitest";
import { Director, layoutMenu } from "./director";

const seat = { id: "s1", x: 4, y: 10, angle: 0 };
function run(d: Director, from: number, to: number, seats: any[], ptr: any[]) {
  const ev: any[] = []; let last: any;
  for (let t = from; t <= to; t += 100) { last = d.step(t, seats, ptr, []); ev.push(...last.events); }
  return { ev, last };
}

describe("Director", () => {
  it("seat -> intro -> menu, then hover dwell picks Stockfish 1500", () => {
    const d = new Director();
    let r = run(d, 0, 6500, [seat], []);
    expect(r.ev.map((e) => e.type)).toContain("seat");
    expect(r.last.phase).toBe("menu");
    const btn = layoutMenu(seat, d.cfg.elos).find((b) => b.id === "elo1500")!;
    r = run(d, 6600, 6600 + 1700, [seat], [{ id: "h", x: btn.x, y: btn.y }]);
    const mode = r.ev.find((e) => e.type === "mode");
    expect(mode?.data).toMatchObject({ mode: "engine", elo: 1500 });
    expect(r.last.phase).toBe("game");
  });
  it("a hand that only passes over a button does not select it", () => {
    const d = new Director();
    run(d, 0, 6500, [seat], []);
    const btn = layoutMenu(seat, d.cfg.elos)[0];
    run(d, 6600, 7400, [seat], [{ id: "h", x: btn.x, y: btn.y }]);
    const r = run(d, 7500, 9000, [seat], []);
    expect(r.last.phase).toBe("menu");
  });
  it("menu is mirrored for a player sitting on the opposite side", () => {
    const a = layoutMenu({ id: "a", x: 4, y: 10, angle: 0 }, [500, 1000]);
    const b = layoutMenu({ id: "b", x: 4, y: -2, angle: 180 }, [500, 1000]);
    expect(a[0].x).toBeLessThan(a[1].x);
    expect(b[0].x).toBeGreaterThan(b[1].x);
  });
});
