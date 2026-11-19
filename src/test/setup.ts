import "vitest-canvas-mock";
import { beforeEach } from "vitest";
// A game left in storage by one test would be resumed by the next one's tracker.
beforeEach(() => { try { localStorage.removeItem("chess-xp.ongoing-game"); } catch { /* no storage here */ } });
