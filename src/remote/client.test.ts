import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountRemote } from "./client";
import type { RemoteState } from "./protocol";

const state = (o: Partial<RemoteState> = {}): RemoteState => ({
  v: 1, t: 1, phase: "game", status: "synced", fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1", turn: "b", ply: 1, over: false, moves: ["e4"],
  last: { from: "e2", to: "e4", san: "e4" }, hint: null, fidelity: 0.9, cameras: [{ id: "A", online: true, quality: 0.8, hasFrame: true }, { id: "B", online: false, quality: 0, hasFrame: false }],
  lines: [{ name: "Jean", text: "Un beau départ." }], play: "virtual", notice: null, clocks: null, ...o,
});
const flush = () => new Promise((r) => setTimeout(r, 15));
const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body } as Response);
let stop = () => {};
const host = () => document.getElementById("app")!;
const start = (fetchFn: ReturnType<typeof vi.fn>, hash = "#/remote?code=4321") => { history.replaceState({}, "", `/${hash}`); stop = mountRemote(host(), { fetchFn: fetchFn as never, base: "/", poll: 5, storage: { getItem: () => null, setItem: () => {} } }).stop; };
const q = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

beforeEach(() => { document.body.innerHTML = '<div id="app"></div>'; Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { stop(); history.replaceState({}, "", "/"); });

describe("phone page", () => {
  it("keeps move guides stable across polls and puts watch-only controls at the bottom", async () => {
    start(vi.fn(() => json({ rev: 1, clients: 1, state: state() }))); await flush();
    expect(q('.rm-head [aria-label="Chess XP"]').querySelector("svg")).not.toBeNull();
    expect(q('.rm-head [aria-label="Join another game"]').textContent).toBe("Join another");
    expect(q('.rm-bottom [aria-label="Watch only"]')).not.toBeNull();
    const ghost = q(".rm-guide-ghost"), moving = q(".rm-guide-piece");
    expect(ghost.style.left).toBe("50%"); expect(ghost.style.top).toBe("50%");
    expect(document.querySelectorAll(".rm-guide path")).toHaveLength(3);
    await flush(); expect(q(".rm-guide-piece")).toBe(moving);
    q<HTMLButtonElement>('[aria-label="Turn the board around"]').click();
    expect(q(".rm-guide-ghost").style.left).toBe("37.5%");
  });
  it("animates reset instructions and clears them when the host confirms setup", async () => {
    let current = state({ ply: 0, moves: [], last: null, phase: "idle", setupMoves: [{ from: "e4", to: "e2", code: "wp" }] });
    let revision = 1;
    start(vi.fn(() => json({ rev: revision, clients: 1, state: current }))); await flush();
    expect(q(".rm-turn").textContent).toContain("follow the pieces home");
    expect(q(".rm-guide-ghost").style.top).toBe("75%");
    current = state({ last: null, setupMoves: [] }); revision++;
    await flush(); expect(document.querySelector(".rm-guide-piece")).toBeNull();
    expect(q(".rm-turn").textContent).toBe("Your turn");
  });
  it("renders and polls when the browser blocks access to session storage", async () => {
    history.replaceState({}, "", "/#/remote?code=4321");
    const getter = vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => { throw new DOMException("Storage blocked", "SecurityError"); });
    const f = vi.fn(() => json({ rev: 0, clients: 1, waiting: true }));
    try {
      stop = mountRemote(host(), { fetchFn: f as never, base: "/", poll: 5 }).stop;
      expect(document.querySelectorAll(".rm-sq")).toHaveLength(64);
      await flush();
      expect(f).toHaveBeenCalled();
      expect(q(".rm-conn").textContent).toBe("Waiting for the computer");
    } finally { getter.mockRestore(); }
  });
  it("asks for the code when the address has none, and keeps the player on that screen until one is typed", async () => {
    const f = vi.fn(() => json({ rev: 0, clients: 1, waiting: true }));
    start(f, "#/remote");
    expect(q("h1").textContent).toBe("Join the game"); expect(q(".rm-join-pop").getAttribute("role")).toBe("dialog");
    q<HTMLFormElement>(".rm-join").dispatchEvent(new Event("submit", { cancelable: true })); expect(q(".rm-err").textContent).toContain("Type the code");
    q<HTMLInputElement>(".rm-join input").value = "9999"; q<HTMLFormElement>(".rm-join").dispatchEvent(new Event("submit", { cancelable: true })); await flush();
    expect(String((f.mock.calls as unknown[][])[0][0])).toContain("code=9999"); expect(q(".rm-turn").textContent).toContain("Waiting for the computer");
  });
  it("goes back to the code screen, with a reason, when the code is wrong", async () => {
    start(vi.fn(() => json({ error: "no" }, 401))); await flush();
    expect(q("h1").textContent).toBe("Join the game"); expect(q(".rm-err").textContent).toContain("not right");
  });
  it("shows the live game: turn, board, the paper score sheet and game info", async () => {
    start(vi.fn(() => json({ rev: 1, clients: 2, state: state({ moves: ["e4", "e5", "Nf3"], turn: "b", hint: { from: "g1", to: "f3" }, notice: { text: "Playing Nf3.", ok: true, at: 5 } }), frames: { A: 3 } }))); await flush();
    expect(q(".rm-confidence").textContent).toBe("Live board confidence 90%");
    expect(q<HTMLMeterElement>(".rm-confidence meter").value).toBe(0.9);
    expect(q(".rm-turn").textContent).toBe("Your turn"); expect(q(".rm-conn").textContent).toMatch(/^Live · \d+ ms$/);
    expect(document.querySelectorAll(".rm-sq")).toHaveLength(64); expect(q('[data-sq="e4"]').getAttribute("aria-label")).toBe("e4, white pawn"); expect(q('[data-sq="e5"]').getAttribute("aria-label")).toBe("e5, empty");
    expect(q('[data-sq="e4"]').classList.contains("last")).toBe(true);
    expect([...document.querySelectorAll(".rm-sheet tbody tr")].map((r) => r.textContent)).toEqual(["1e4e5", "2Nf3"]);
    q<HTMLButtonElement>('.rm-tabs button:nth-child(3)').click(); expect(q(".rm-info").textContent).toContain("Following the board"); expect(q(".rm-lines").textContent).toContain("Un beau départ."); expect(q(".rm-info").textContent).toContain("2");
  });
  it("steps back through the moves from the sheet and the buttons, and returns to live", async () => {
    start(vi.fn(() => json({ rev: 1, clients: 1, state: state({ moves: ["e4", "e5", "Nf3"], fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2" }) }))); await flush();
    const cells = () => [...document.querySelectorAll<HTMLButtonElement>(".rm-sheet td button")];
    cells()[1].click(); expect(q(".rm-turn").textContent).toBe("Looking back: after 1... e5"); expect(q('[data-sq="f3"]').getAttribute("aria-label")).toBe("f3, empty"); expect(cells()[1].getAttribute("aria-current")).toBe("true");
    q('button[aria-label="Previous move"]').click(); expect(q(".rm-turn").textContent).toBe("Looking back: after 1. e4");
    q('button[aria-label="First move"]').click(); expect(q(".rm-turn").textContent).toBe("Looking back: start position");
    q('button[aria-label="Next move"]').click(); q('button[aria-label="Next move"]').click(); q('button[aria-label="Next move"]').click(); expect(q(".rm-turn").textContent).toBe("Your turn");
    cells()[0].click(); q('button[aria-label="Latest move"]').click(); expect(q(".rm-turn").textContent).toBe("Your turn");
    cells()[0].click(); q('button[aria-label="Follow the live game"]').click(); expect(q(".rm-turn").classList.contains("back")).toBe(false);
    q('button[aria-label="Turn the board around"]').click(); expect(document.querySelector<HTMLElement>(".rm-sq")!.dataset.sq).toBe("h1");
  });
  it("sends a move on two taps, with a promotion piece when needed, and tells the player when the computer refuses", async () => {
    const posts: unknown[] = [];
    const f = vi.fn((url: string, init?: RequestInit) => { if (init?.method === "POST") { posts.push(JSON.parse(String(init.body))); return json({ error: "The computer is not sharing a game right now." }, 503); } return json({ rev: 1, clients: 1, state: state({ turn: "w", fen: "8/4P3/8/8/8/8/8/k6K w - - 0 1", moves: [] }) }); });
    start(f); await flush();
    q('[data-sq="e7"]').click(); expect(q('[data-sq="e8"]').classList.contains("target")).toBe(true); q('[data-sq="e8"]').click();
    expect(q(".rm-promo").hidden).toBe(false); q('[aria-label="Promote to Queen"]').click(); await flush();
    expect(posts).toEqual([{ type: "move", from: "e7", to: "e8", promotion: "q" }]); expect(q(".rm-notice").textContent).toContain("not sharing"); expect(q(".rm-notice").classList.contains("bad")).toBe(true);
    q('[data-sq="h1"]').click(); expect(document.querySelector(".rm-sq.sel")!.getAttribute("data-sq")).toBe("h1"); // white's king, white to move: selects
  });
  it("does not let a phone play when it is not allowed, or when looking back", async () => {
    const posts: unknown[] = []; let mode: RemoteState["play"] = "off";
    const f = vi.fn((_u: string, init?: RequestInit) => { if (init?.method === "POST") posts.push(1); return json({ rev: mode === "off" ? 1 : 2, clients: 1, state: state({ play: mode, turn: "b", fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1" }) }); });
    start(f); await flush(); q('[data-sq="e7"]').click(); expect(document.querySelector(".target")).toBeNull();
    mode = "hint"; await flush(); await flush(); q('[data-sq="e7"]').click(); expect(document.querySelectorAll(".target").length).toBe(2);
    q('[data-sq="e7"]').click(); expect(document.querySelector(".sel")).toBeNull(); q('[data-sq="e7"]').click(); q('[data-sq="d7"]').click(); expect(document.querySelector(".sel")!.getAttribute("data-sq")).toBe("d7");
    q<HTMLButtonElement>('button[aria-label="First move"]').click(); q('[data-sq="d7"]').click(); expect(posts).toHaveLength(0);
  });
  it("reports a network failure when sending", async () => {
    const f = vi.fn((_u: string, init?: RequestInit) => init?.method === "POST" ? Promise.reject(new Error("net")) : json({ rev: 1, clients: 1, state: state({ turn: "b" }) }));
    start(f); await flush(); q('[data-sq="e7"]').click(); q('[data-sq="e5"]').click(); await flush(); expect(q(".rm-notice").textContent).toContain("Could not reach");
  });
  it("shows the camera picture, switches cameras and explains when there is none", async () => {
    start(vi.fn(() => json({ rev: 1, clients: 1, state: state(), frames: { A: 4 } }))); await flush();
    q<HTMLButtonElement>(".rm-tabs button:nth-child(2)").click(); expect(q<HTMLImageElement>(".rm-shot").src).toContain("/remote/api/frame/A.jpg?code=4321"); expect(q<HTMLImageElement>(".rm-shot").src).toContain("r=4");
    q<HTMLButtonElement>(".rm-cams button:nth-child(2)").click(); expect(q(".rm-empty").textContent).toContain("offline");
    stop(); start(vi.fn(() => json({ rev: 1, clients: 1, state: state({ cameras: [{ id: "A", online: true, quality: 1, hasFrame: false }] }) }))); await flush(); q<HTMLButtonElement>(".rm-tabs button:nth-child(2)").click(); expect(q(".rm-empty").textContent).toContain("Waiting for the first picture");
    stop(); start(vi.fn(() => json({ rev: 1, clients: 1, state: state({ cameras: [] }) }))); await flush(); q<HTMLButtonElement>(".rm-tabs button:nth-child(2)").click(); expect(q(".rm-empty").textContent).toContain("No cameras");
  });
  it("says so when the computer cannot be reached, and when no moves exist yet", async () => {
    start(vi.fn(() => Promise.reject(new Error("down")))); await flush(); expect(q(".rm-conn").textContent).toContain("Offline"); expect(q(".rm-empty").textContent).toContain("No moves yet");
    stop(); start(vi.fn(() => json({}, 500))); await flush(); expect(q(".rm-conn").classList.contains("off")).toBe(true);
    stop(); start(vi.fn(() => json({ rev: 0, clients: 1, waiting: true }))); q<HTMLButtonElement>(".rm-tabs button:nth-child(3)").click(); await flush(); expect(q(".rm-info").textContent).toContain("Waiting for the computer");
  });
  it("describes a finished game and other tracker states", async () => {
    start(vi.fn(() => json({ rev: 1, clients: 1, state: state({ over: true, status: "weird" }) }))); await flush();
    expect(q(".rm-turn").textContent).toBe("Game over"); expect(q(".rm-clocks").hidden).toBe(true);
    q<HTMLButtonElement>(".rm-tabs button:nth-child(3)").click(); expect(q(".rm-info").textContent).toContain("weird");
  });
  it("shows the clocks on the turn line and the info tab, and downloads the PGN", async () => {
    start(vi.fn(() => json({ rev: 1, clients: 1, state: state({ clocks: { white: "5:00", black: "4:59", running: "b" }, moves: ["e4"] }) }))); await flush();
    expect(q(".rm-clocks").hidden).toBe(false); expect(q(".rm-clocks").textContent).toBe("White 5:00  ·  Black 4:59 running");
    q<HTMLButtonElement>(".rm-tabs button:nth-child(3)").click();
    expect(q(".rm-info").textContent).toContain("4:59 (running)");
    const url = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:pgn");
    const saveClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    [...document.querySelectorAll<HTMLButtonElement>(".rm-copies button")].find((b) => b.textContent === "Download PGN")!.click();
    expect(url).toHaveBeenCalled(); expect(saveClick).toHaveBeenCalled();
    expect((saveClick.mock.instances[0] as HTMLAnchorElement).download).toBe("chess-xp.pgn");
    url.mockRestore(); saveClick.mockRestore();
    stop(); start(vi.fn(() => json({ rev: 2, clients: 1, state: state({ clocks: { white: "1:00", black: "0:45", running: "w" } }) }))); await flush();
    expect(q(".rm-clocks").textContent).toBe("White 1:00 running  ·  Black 0:45");
    q<HTMLButtonElement>(".rm-tabs button:nth-child(3)").click();
    expect(q(".rm-info").textContent).toContain("1:00 (running)");
  });
  it("lets the page be taken down", () => { const f = vi.fn(() => json({ rev: 0, clients: 0, waiting: true })); start(f); stop(); expect(document.body.classList.contains("remote")).toBe(false); });
  it("asks which piece to promote to, and cancels if the board is tapped again", async () => {
    const posts: unknown[] = [];
    const f = vi.fn((_u: string, init?: RequestInit) => { if (init?.method === "POST") posts.push(JSON.parse(String(init.body))); return json({ rev: 1, clients: 1, state: state({ turn: "w", fen: "8/4P3/8/8/8/8/8/k6K w - - 0 1", moves: [] }) }); });
    start(f); await flush();
    q('[data-sq="e7"]').click(); q('[data-sq="e8"]').click(); expect(q(".rm-promo").hidden).toBe(false);
    q('[data-sq="h1"]').click(); expect(q(".rm-promo").hidden).toBe(true); expect(posts).toHaveLength(0);
    q('[data-sq="e7"]').click(); q('[data-sq="e8"]').click(); q('[aria-label="Promote to Knight"]').click(); await flush();
    expect(posts).toEqual([{ type: "move", from: "e7", to: "e8", promotion: "n" }]);
  });
  it("copies PGN and FEN from the game info tab", async () => {
    const write = vi.fn(async (_text: string) => {}); Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
    start(vi.fn(() => json({ rev: 1, clients: 1, state: state({ moves: ["e4", "e5"] }) }))); await flush();
    q<HTMLButtonElement>(".rm-tabs button:nth-child(3)").click();
    [...document.querySelectorAll<HTMLButtonElement>(".rm-copies button")].find((b) => b.textContent === "Copy PGN")!.click();
    [...document.querySelectorAll<HTMLButtonElement>(".rm-copies button")].find((b) => b.textContent === "Copy FEN")!.click();
    expect(write.mock.calls.length).toBe(2);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => { throw new Error("denied"); }) }, configurable: true });
    [...document.querySelectorAll<HTMLButtonElement>(".rm-copies button")].find((b) => b.textContent === "Copy PGN")!.click();
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    [...document.querySelectorAll<HTMLButtonElement>(".rm-copies button")].find((b) => b.textContent === "Copy PGN")!.click();
    stop(); start(vi.fn(() => json({ rev: 1, clients: 1, state: state({ moves: [] }) }))); await flush();
    q<HTMLButtonElement>(".rm-tabs button:nth-child(3)").click();
    Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
    [...document.querySelectorAll<HTMLButtonElement>(".rm-copies button")].find((b) => b.textContent === "Copy PGN")!.click();
    expect(String(write.mock.calls.at(-1)?.[0])).toContain("[Result");
  });
  it("can watch without sending moves or takeback, and remembers that choice", async () => {
    const bag: Record<string, string> = {}, posts: unknown[] = [];
    const f = vi.fn((_u: string, init?: RequestInit) => { if (init?.method === "POST") posts.push(JSON.parse(String(init.body))); return json({ rev: 1, clients: 1, state: state({ turn: "b" }) }); });
    const store = { getItem: (k: string) => bag[k] ?? null, setItem: (k: string, v: string) => { bag[k] = v; } };
    history.replaceState({}, "", "/#/remote?code=4321");
    stop = mountRemote(host(), { fetchFn: f as never, base: "/", poll: 5, storage: store }).stop; await flush();
    q('[aria-label="Watch only"]').click();
    expect(q('[aria-label="Watch only"]').getAttribute("aria-pressed")).toBe("true"); expect(q(".rm-acts").hidden).toBe(true); expect(bag["chess.remote.watch"]).toBe("1");
    q('[data-sq="e7"]').click(); expect(document.querySelector(".target")).toBeNull(); expect(posts).toHaveLength(0);
    stop(); stop = mountRemote(host(), { fetchFn: f as never, base: "/", poll: 5, storage: store }).stop; await flush();
    expect(q(".rm-acts").hidden).toBe(true); expect(q('[aria-label="Watch only"]').getAttribute("aria-pressed")).toBe("true");
  });
  it("sends takeback, resign, and draw from the action row", async () => {
    const posts: unknown[] = [];
    const f = vi.fn((_u: string, init?: RequestInit) => { if (init?.method === "POST") posts.push(JSON.parse(String(init.body))); return json({ rev: 1, clients: 1, state: state() }); });
    start(f); await flush();
    q('[aria-label="Takeback"]').click(); q('[aria-label="Resign"]').click(); q('[aria-label="Draw"]').click(); await flush();
    expect(posts).toEqual([{ type: "takeback" }, { type: "resign" }, { type: "draw" }]);
    expect(q(".rm-notice").textContent).toContain("Sending draw");
  });
  it("opens the join popup from the header so the code can be typed again", async () => {
    start(vi.fn(() => json({ rev: 1, clients: 1, state: state() }))); await flush();
    expect(document.querySelector(".rm-join-pop")).toBeNull();
    q('[aria-label="Join another game"]').click();
    expect(q(".rm-join-pop").getAttribute("role")).toBe("dialog"); expect(q(".rm-join input")).toBeTruthy();
  });
});
