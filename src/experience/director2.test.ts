import { describe, expect, it } from "vitest";
import type { ExperienceEvent } from "../core/events";
import { Director, defaultDirectorConfig, layoutMenu, type DirectorOut, type PointerSample, type Seat } from "./director";

const seat: Seat = { id: "s", x: 4, y: 10, angle: 0 };
function run(d: Director, from: number, to: number, seats: Seat[], ptr: PointerSample[] = [], game: ExperienceEvent[] = []) {
  const ev: ExperienceEvent[] = []; let last!: DirectorOut;
  for (let t = from; t <= to; t += 100) { last = d.step(t, seats, ptr, t === from ? game : []); ev.push(...last.events); }
  return { ev, last };
}
const phases = (ev: ExperienceEvent[]) => ev.filter((e) => e.type === "phase").map((e) => e.data!.phase);

describe("defaults and menu layout", () => {
  it("documents its timings and Elo ladder", () => {
    expect(defaultDirectorConfig()).toEqual({ dwellMs: 1500, introMs: 6000, outroMs: 8000, leaveMs: 4000, elos: [500, 1000, 1500], preset: "menu", presetElo: 1000 });
  });
  it("lays buttons out in front of the player, rotated for each side of the table", () => {
    const south = layoutMenu({ id: "a", x: 4, y: 10, angle: 0 }, [500, 1000, 1500]);
    expect(south.map((b) => b.id)).toEqual(["elo500", "elo1000", "elo1500", "human"]);
    expect(south[0].y).toBeCloseTo(8.6); expect(south[0].x).toBeLessThan(south[3].x);
    const north = layoutMenu({ id: "b", x: 4, y: -2, angle: 180 }, [500, 1000]);
    expect(north[0].x).toBeGreaterThan(north[2].x);
    const east = layoutMenu({ id: "c", x: 11, y: 4, angle: 270 }, [500]);
    expect(east.every((b) => Number.isFinite(b.x) && Number.isFinite(b.y))).toBe(true);
  });
  it("anchors the menu on the table edge when the seat is far away (clamped)", () => {
    const far = layoutMenu({ id: "f", x: 4, y: 60, angle: 0 }, [500]);
    expect(far[0].y).toBeCloseTo(10.5 - 1.4);
    const farNeg = layoutMenu({ id: "f", x: -50, y: 4, angle: 90 }, [500]);
    expect(farNeg[0].x).toBeCloseTo(-2.5 + 1.4);
  });
});

describe("Director flow", () => {
  it("stays idle with nobody there and emits nothing", () => {
    const r = run(new Director(), 0, 2000, []);
    expect(r.ev).toEqual([]); expect(r.last).toMatchObject({ phase: "idle", mode: null, seat: null, menu: [], progress: {} });
  });
  it("seat -> intro -> menu announces the player once and shows the menu", () => {
    const d = new Director(), r = run(d, 0, 6200, [seat]);
    expect(r.ev.filter((e) => e.type === "seat")).toHaveLength(1);
    expect(phases(r.ev)).toEqual(["intro", "menu"]); expect(r.last.menu.length).toBe(4); expect(r.last.seat).toEqual(seat);
  });
  it("follows a moving seat while the menu is open", () => {
    const d = new Director(); run(d, 0, 6200, [seat]);
    const r = run(d, 6300, 6400, [{ ...seat, x: 6 }]);
    expect(r.last.menu[0].x).toBeGreaterThan(layoutMenu(seat, [500, 1000, 1500])[0].x);
  });
  it("hover dwell picks a button; progress rises while hovering and decays quickly when the hand leaves", () => {
    const d = new Director(); run(d, 0, 6200, [seat]);
    const b = layoutMenu(seat, d.cfg.elos).find((x) => x.id === "elo1000")!;
    let r = run(d, 6300, 6900, [seat], [{ id: "h", x: b.x, y: b.y }]);
    expect(r.last.progress.elo1000).toBeGreaterThan(0.2); expect(r.last.progress.elo1000).toBeLessThan(1);
    r = run(d, 7000, 7300, [seat], []);
    expect(r.last.progress.elo1000).toBe(0);
    r = run(d, 7400, 9200, [seat], [{ id: "h", x: b.x, y: b.y }]);
    expect(r.ev.find((e) => e.type === "mode")!.data).toEqual({ mode: "engine", elo: 1000 }); expect(r.last.phase).toBe("game"); expect(r.last.mode).toBe("engine");
  });
  it("picking 'two players' sets human mode without changing the Elo", () => {
    const d = new Director(); run(d, 0, 6200, [seat]);
    const b = layoutMenu(seat, d.cfg.elos).find((x) => x.id === "human")!;
    const r = run(d, 6300, 8100, [seat], [{ id: "h", x: b.x, y: b.y }]);
    expect(r.ev.find((e) => e.type === "mode")!.data).toEqual({ mode: "human", elo: 1000 });
  });
  it("menu goes back to idle if the player walks away", () => {
    const d = new Director(); run(d, 0, 6200, [seat]);
    const r = run(d, 6300, 11000, []);
    expect(r.last.phase).toBe("idle");
  });
  it("kiosk presets skip the menu: Stockfish at a fixed Elo, or two players", () => {
    const e = new Director({ ...defaultDirectorConfig(), preset: "engine", presetElo: 1500 }), r = run(e, 0, 6200, [seat]);
    expect(phases(r.ev)).toEqual(["intro", "game"]); expect(r.ev.find((x) => x.type === "mode")!.data).toEqual({ mode: "engine", elo: 1500 }); expect(r.last.menu).toEqual([]);
    const h = new Director({ ...defaultDirectorConfig(), preset: "human" }), r2 = run(h, 0, 6200, [seat]);
    expect(r2.ev.find((x) => x.type === "mode")!.data).toEqual({ mode: "human", elo: 1000 });
  });
  const inGame = () => { const d = new Director({ ...defaultDirectorConfig(), preset: "human" }); run(d, 0, 6200, [seat]); return d; };
  it("checkmate ends the game with the winner named, then returns to idle after the outro", () => {
    for (const [color, text] of [["w", "victoire des blancs"], ["b", "victoire des noirs"]] as const) {
      const d = inGame(), r = run(d, 6300, 6300, [seat], [], [{ type: "mate", t: 0, data: { color } }]);
      expect(r.ev.find((e) => e.data?.phase === "outro")!.data!.result).toContain(text);
      const after = run(d, 6400, 14600, [seat]);
      expect(phases(after.ev)).toContain("idle"); expect(after.ev.find((e) => e.data?.phase === "idle")).toBeTruthy(); expect(after.last.mode).toBeNull();
    }
  });
  it("a draw ends the game as 'partie nulle'", () => {
    const d = inGame(), r = run(d, 6300, 6300, [seat], [], [{ type: "draw", t: 0 }]);
    expect(r.ev.find((e) => e.data?.phase === "outro")!.data!.result).toBe("partie nulle");
  });
  it("walking away mid-game eventually ends it with a 'leave' event, but a short absence is forgiven", () => {
    const d = inGame();
    run(d, 6300, 9000, []);
    expect(d.phase).toBe("game");
    const back = run(d, 9100, 9300, [seat]); expect(back.last.phase).toBe("game");
    const gone = run(d, 9400, 9400 + 13000, []);
    expect(gone.ev.map((e) => e.type)).toContain("leave"); expect(gone.last.phase).toBe("outro");
  });
  it("ignores unrelated game events", () => {
    const d = inGame(), r = run(d, 6300, 6400, [seat], [], [{ type: "move", t: 0 }]);
    expect(r.last.phase).toBe("game");
  });
});
