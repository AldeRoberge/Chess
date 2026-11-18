import { describe, expect, it } from "vitest";
import { ScenarioRunner, scenarioById } from "./scenarios";
import { virtualTable } from "./virtualTable";

// the runner asks for actions; "moved" is true when it asks for a move this tick
const moved = (r: ScenarioRunner, now: number) => r.step(now).some((a) => a.kind === "move");

describe("ScenarioRunner pause", () => {
  it("a held scenario asks for nothing, and resuming does not eat the pause already waited", () => {
    virtualTable.reset();
    const r = new ScenarioRunner(virtualTable, scenarioById("scholars-mate")!, 1000);
    r.step(0); r.step(100); r.step(200); // primed, handshake asked, first move due at 1200
    r.setHeld(true, 500); // 300 ms of the pause already waited
    expect(r.held).toBe(true);
    expect(moved(r, 5000)).toBe(false); expect(r.index).toBe(0);
    r.setHeld(false, 5000); // held for 4500 ms: the next move is now due at 5700
    expect(r.held).toBe(false);
    expect(moved(r, 5400)).toBe(false); expect(r.index).toBe(0);
    expect(moved(r, 5700)).toBe(true); expect(r.index).toBe(1);
  });
  it("holding twice or releasing an unheld runner changes nothing", () => {
    virtualTable.reset();
    const r = new ScenarioRunner(virtualTable, scenarioById("scholars-mate")!, 1000);
    r.step(0); r.step(100); r.step(200); // first move due at 1200
    r.setHeld(false, 300); expect(r.held).toBe(false);
    r.setHeld(true, 400); r.setHeld(true, 9000); r.setHeld(false, 1000); // the second hold call keeps the first timestamp: 600 ms held, so due at 1800
    expect(moved(r, 1000)).toBe(false); expect(moved(r, 1600)).toBe(false); expect(moved(r, 1800)).toBe(true);
  });
});
