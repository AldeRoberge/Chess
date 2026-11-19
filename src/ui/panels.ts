import { Chess } from "chess.js";
import type { Graph } from "../core/graph";
import { bus } from "../core/bus";
import { extractSurfaces } from "../mapping/planes";
import { runCalibration } from "../mapping/calibrator";
import { loadMapping, saveMapping, defaultMapping, type MappingConfig } from "../mapping/store";
import { virtualTable } from "../sim/virtualTable";
import { SQUARE } from "../world/coords";
import { sqIndex, sqName } from "../vision/types";
import { WorldView } from "../world/view";
import { drawTableOverlay } from "../world/overlay";
import { registerContextMenu } from "./contextMenu";
import { viewMenu } from "./menus/viewMenu";
import { dueFrame, pixelRatio, setDisplay, viewSettings } from "./viewSettings";
import { PIECE_SETS, pieceColors, pieceImage, pieceSet, setPieceColors, setPieceSet } from "./pieceSets";
import { BOARD_THEMES, boardTheme, setBoardTheme } from "./boardThemes";
import { openChannel, type InMsg } from "./channel";
import { drawBotAvatar, drawGrabHand } from "./botAvatar";
import { setLabel, withIcon } from "./icons";
import type { Tip, TipRow } from "./tooltip";
import { fenPieces, looksLikeStart } from "../plugins/shared";
import { playStatus } from "./playStatus";
import { isLightSquare, pct, pieceLabel, tone } from "../plugins/hover";
import { fmtClock } from "../clock/types";
import { positionAt } from "../remote/protocol";

const o2 = (n: string) => sqIndex(n);
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
const copyText = (s: string) => { void navigator.clipboard?.writeText(s).catch(() => {}); };
const downloadText = (name: string, s: string) => {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([s], { type: "text/plain;charset=utf-8" })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
const flipped = () => viewSettings().display.flip;
const visSq = (sq: number) => (flipped() ? 63 - sq : sq);
const tableXY = (q: { x: number; y: number }) => (flipped() ? { x: 8 - q.x, y: 8 - q.y } : q);
const GLYPH: Record<string, string> = { wp: "♙", wn: "♘", wb: "♗", wr: "♖", wq: "♕", wk: "♔", bp: "♟", bn: "♞", bb: "♝", br: "♜", bq: "♛", bk: "♚" };

/** The virtual table: play moves with the mouse (a simulated hand carries the piece past the cameras), hover menu buttons to test dwell selection. */
const PROMO = { q: "Queen", r: "Rook", b: "Bishop", n: "Knight" } as const;
const START_N: Record<string, number> = { q: 1, r: 2, b: 2, n: 2, p: 8 };

export class TablePanel {
  root = el("div", "panel table");
  private cv = el("canvas"); private info = el("div", "muted");
  private gamebar = el("div", "gamebar"); private promo = el("div", "promo");
  private px = 44; private margin = 3; private sel: number | null = null;
  /** A piece being dragged with the mouse (square index), and whether it was already selected when grabbed. */
  private drag: { from: number; was: boolean } | null = null; private suppressClick = false;
  /** Square (0 = a8) under the mouse, or null; the margin ring counts as off the board. */
  private over: number | null = null; private overMargin: { x: number; y: number } | null = null;
  /** Keyboard cursor (0 = a8). Arrows move it; Enter selects or moves. */
  private cursor = 52;
  private pending: { from: string; to: string; choices: ("q" | "r" | "b" | "n")[] } | null = null;
  private seat = el("button", "", "Sit down");
  private flipBtn = withIcon(el("button", "", "Flip"), "flip");
  private hintsBtn = withIcon(el("button", "", "Hints"), "spark");
  private dotsBtn = withIcon(el("button", "", "Legal dots"), "board");
  private lookSel = el("select", "board-look");
  private pieceSel = el("select", "board-look");
  private banner = el("div", "over-banner");
  private playBox = el("div", "play-status");
  private playTitle = el("strong", "", "Getting ready");
  private playDetail = el("span", "", "Waiting for the cameras to see the board.");
  private playKey = "";
  private gameKey = "";
  /** null follows the live game; a number is the ply being looked at on the scoresheet. */
  private viewPly: number | null = null;

  constructor() {
    this.cv.width = this.cv.height = (8 + this.margin * 2) * this.px;
    this.cv.className = "table-cv"; this.cv.dataset.tipLive = "1"; this.cv.tabIndex = 0;
    this.cv.setAttribute("role", "application");
    this.cv.setAttribute("aria-label", "Chessboard. Arrow keys move the cursor. Enter or Space selects and moves. q, r, b or n chooses a promotion. Flip turns the board so Black plays from the bottom.");
    const bar = el("div", "bar");
    const reset = withIcon(el("button", "", "Reset table"), "undo"); reset.type = "button"; reset.dataset.tip = "Reset table"; reset.dataset.tipBody = "Puts every piece back on its starting square.";
    reset.onclick = () => this.startFresh();
    this.seat.type = "button"; withIcon(this.seat, "people");
    this.seat.dataset.tip = "Sit / stand"; this.seat.dataset.tipBody = "Seats or removes the virtual player, so the cameras and tracking see a person at the table.";
    this.seat.onclick = () => { virtualTable.seated = !virtualTable.seated; this.paintSeat(); this.seatCb(virtualTable.seated); };
    this.paintSeat();
    this.lookSel.title = "Board look"; this.lookSel.setAttribute("aria-label", "Board look");
    for (const t of BOARD_THEMES) { const o = el("option", "", t.name); o.value = t.id; this.lookSel.append(o); }
    this.lookSel.value = boardTheme().id; this.lookSel.onchange = () => setBoardTheme(this.lookSel.value);
    this.pieceSel.title = "Piece set"; this.pieceSel.setAttribute("aria-label", "Piece set");
    for (const s of PIECE_SETS) { const o = el("option", "", s.name); o.value = s.id; this.pieceSel.append(o); }
    this.pieceSel.value = pieceSet().id; this.pieceSel.onchange = () => setPieceSet(this.pieceSel.value);
    this.flipBtn.type = "button"; this.flipBtn.dataset.tip = "Flip board"; this.flipBtn.dataset.tipBody = "Turn the board around so Black plays from the bottom.";
    this.flipBtn.onclick = () => { setDisplay({ flip: !flipped() }); this.paintFlip(); };
    this.paintFlip();
    this.hintsBtn.type = "button"; this.hintsBtn.dataset.tip = "Move hints"; this.hintsBtn.dataset.tipBody = "Show or hide the engine's suggested move on the board.";
    this.hintsBtn.onclick = () => { setDisplay({ hints: !viewSettings().display.hints }); this.paintDisp(); };
    this.dotsBtn.type = "button"; this.dotsBtn.dataset.tip = "Legal dots"; this.dotsBtn.dataset.tipBody = "Show or hide dots on the squares a selected piece can move to.";
    this.dotsBtn.onclick = () => { setDisplay({ legalMoves: !viewSettings().display.legalMoves }); this.paintDisp(); };
    this.paintDisp();
    const hover = withIcon(el("button", "", "Hover hand"), "hand"); hover.title = "Hold a simulated hand over the board under your mouse, to test what the cameras do when squares are covered";
    hover.onclick = () => { virtualTable.hoverHand = !virtualTable.hoverHand; hover.classList.toggle("on", virtualTable.hoverHand); if (!virtualTable.hoverHand && !virtualTable.busy) virtualTable.hand = null; };
    const copyPgn = withIcon(el("button", "", "Copy PGN"), "copy"); copyPgn.type = "button";
    copyPgn.dataset.tip = "Copy PGN"; copyPgn.dataset.tipBody = "Copy the game in PGN, the usual way to save or share a chess game.";
    copyPgn.onclick = () => copyText(virtualTable.game.pgn());
    const copyFen = withIcon(el("button", "", "Copy FEN"), "copy"); copyFen.type = "button";
    copyFen.dataset.tip = "Copy FEN"; copyFen.dataset.tipBody = "Copy the current position as FEN, so you can paste it into an analysis board.";
    copyFen.onclick = () => copyText(virtualTable.game.fen());
    const savePgn = withIcon(el("button", "", "Download PGN"), "export"); savePgn.type = "button";
    savePgn.dataset.tip = "Download PGN"; savePgn.dataset.tipBody = "Save the game as a PGN file, so it does not vanish when you leave.";
    savePgn.onclick = () => downloadText("chess-xp.pgn", virtualTable.game.pgn());
    const takeback = withIcon(el("button", "", "Takeback"), "undo"); takeback.type = "button";
    takeback.dataset.tip = "Takeback"; takeback.dataset.tipBody = "Undo the last move, or cancel a resignation.";
    takeback.onclick = () => { if (virtualTable.takeback()) { this.viewPly = null; this.sel = null; this.pending = null; this.paintPromo(); this.paintGame(); this.paintBoardAria(); } };
    const resignBtn = withIcon(el("button", "", "Resign"), "flag"); resignBtn.type = "button";
    resignBtn.dataset.tip = "Resign"; resignBtn.dataset.tipBody = "Give up. The side to move loses.";
    resignBtn.onclick = () => { if (virtualTable.resign(virtualTable.game.turn())) this.paintGame(); };
    const drawBtn = withIcon(el("button", "", "Draw"), "people"); drawBtn.type = "button";
    drawBtn.dataset.tip = "Draw"; drawBtn.dataset.tipBody = "End the game as a draw both sides agreed.";
    drawBtn.onclick = () => { if (virtualTable.agreeDraw()) this.paintGame(); };
    bar.append(this.seat, reset, hover, this.flipBtn, this.hintsBtn, this.dotsBtn, this.lookSel, this.pieceSel, copyPgn, copyFen, savePgn, takeback, resignBtn, drawBtn);
    this.promo.hidden = true;
    this.gamebar.setAttribute("aria-live", "polite");
    this.banner.hidden = true; this.banner.setAttribute("role", "status");
    this.playBox.dataset.tone = "wait"; this.playBox.setAttribute("role", "status"); this.playBox.append(this.playTitle, this.playDetail);
    this.root.append(bar, this.gamebar, this.banner, this.playBox, this.promo, this.cv, this.info);
    this.info.textContent = "Click a piece, then a square. Hover a menu button to test dwell selection. Arrow keys and Enter play too.";
    const pos = (e: MouseEvent) => { const r = this.cv.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * (8 + 2 * this.margin) - this.margin, y: ((e.clientY - r.top) / r.height) * (8 + 2 * this.margin) - this.margin }; };
    this.cv.onmousemove = (e) => {
      let q = tableXY(pos(e));
      const c = Math.floor(q.x), r = Math.floor(q.y); this.over = c >= 0 && c < 8 && r >= 0 && r < 8 ? r * 8 + c : null; this.overMargin = this.over === null ? q : null;
      if (this.drag && this.over !== null && this.over !== this.drag.from) {
        const from = sqName(this.drag.from), to = sqName(this.over);
        if (virtualTable.game.moves({ verbose: true }).some((m) => m.from === from && m.to === to)) q = { x: (this.over % 8) + 0.5, y: Math.floor(this.over / 8) + 0.5 };
      }
      virtualTable.pointer = q;
      if (virtualTable.hoverHand && !virtualTable.busy) { virtualTable.hand = { ...virtualTable.pointer }; virtualTable.carried = null; virtualTable.setHoverHand(); }
    };
    this.cv.onmousedown = (e) => {
      this.suppressClick = false;
      if (this.takeover()) { this.suppressClick = true; return; } // two bots are playing: the click asks to take control instead of moving a piece
      virtualTable.pointerDown = true;
      const p = tableXY(pos(e)), c = Math.floor(p.x), r = Math.floor(p.y), pc = c >= 0 && c < 8 && r >= 0 && r < 8 ? virtualTable.game.board()[r][c] : null;
      if (pc && !virtualTable.busy && pc.color === virtualTable.game.turn() && this.sideOk(pc.color)) { this.drag = { from: r * 8 + c, was: this.sel === r * 8 + c }; this.sel = r * 8 + c; this.paintBoardAria(); } // grab: drag it to a square, or release to keep it selected
    };
    this.cv.onmouseup = (e) => {
      virtualTable.pointerDown = false;
      const d = this.drag; this.drag = null;
      if (!d) return;
      const p = tableXY(pos(e)), c = Math.floor(p.x), r = Math.floor(p.y), to = c >= 0 && c < 8 && r >= 0 && r < 8 ? r * 8 + c : null;
      this.suppressClick = true; // the mouseup handled it; the click that follows must not act again
      if (to === null) { this.sel = null; return; }
      if (to === d.from) { this.sel = d.was ? null : to; return; } // released where it started: a plain click toggles the selection
      this.tryMove(d.from, to);
    };
    this.cv.onmouseleave = () => { virtualTable.pointer = null; virtualTable.pointerDown = false; this.drag = null; this.over = null; this.overMargin = null; if (virtualTable.hoverHand && !virtualTable.busy) virtualTable.hand = null; };
    this.cv.onclick = (e) => {
      if (this.suppressClick) { this.suppressClick = false; return; }
      const p = tableXY(pos(e)); const c = Math.floor(p.x), r = Math.floor(p.y);
      if (c < 0 || c > 7 || r < 0 || r > 7) return;
      this.act(r * 8 + c);
    };
    this.cv.onkeydown = (e) => {
      if (this.pending && "qrbn".includes(e.key) && this.pending.choices.includes(e.key as "q")) {
        e.preventDefault(); this.commit(this.pending.from + this.pending.to + e.key); return;
      }
      const step: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      let d = step[e.key];
      if (d) {
        e.preventDefault();
        if (flipped()) d = [-d[0], -d[1]];
        const c = Math.min(7, Math.max(0, (this.cursor % 8) + d[0])), r = Math.min(7, Math.max(0, Math.floor(this.cursor / 8) + d[1]));
        this.cursor = r * 8 + c; this.over = this.cursor; return;
      }
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      if (this.takeover()) return;
      this.act(this.cursor);
    };
  }

  /** A move is allowed once the director (if any) has opened the game, and never for the colour Stockfish is playing. */
  private sideOk(color: "w" | "b") {
    if (virtualTable.over || this.viewPly !== null) return false;
    const d = bus.director;
    if (d && d.phase !== "game") return false;
    return bus.botColor !== color;
  }

  private act(i: number) {
    const r = Math.floor(i / 8), c = i % 8, pc = virtualTable.game.board()[r][c];
    if (this.sel === null) { if (pc && !virtualTable.busy && pc.color === virtualTable.game.turn() && this.sideOk(pc.color)) this.sel = i; this.paintBoardAria(); return; }
    if (this.sel === i) { this.sel = null; this.paintBoardAria(); return; }
    this.tryMove(this.sel, i);
  }

  private tryMove(fromSq: number, toSq: number) {
    const from = sqName(fromSq), to = sqName(toSq);
    const ms = virtualTable.game.moves({ verbose: true }).filter((x) => x.from === from && x.to === to);
    if (!ms.length || !this.sideOk(virtualTable.game.turn())) { this.sel = null; this.pending = null; this.paintPromo(); this.paintBoardAria(); return; }
    const choices = [...new Set(ms.map((m) => m.promotion).filter((p): p is "q" | "r" | "b" | "n" => !!p))];
    if (choices.length > 1) { this.pending = { from, to, choices }; this.sel = null; this.paintPromo(); this.paintBoardAria(); return; }
    this.commit(from + to + (choices[0] ?? ""));
  }

  private commit(uci: string) {
    virtualTable.play(uci, performance.now());
    this.sel = null; this.pending = null; this.viewPly = null; this.paintPromo(); this.paintBoardAria();
  }

  private paintPromo() {
    this.promo.replaceChildren();
    const p = this.pending; this.promo.hidden = !p; if (!p) return;
    this.promo.append(el("span", "", "Promote to"));
    for (const ch of p.choices) {
      const b = el("button", "", `${PROMO[ch]} (${ch})`); b.type = "button";
      b.onclick = () => this.commit(p.from + p.to + ch);
      this.promo.append(b);
    }
  }

  private paintSeat() {
    const on = virtualTable.seated;
    setLabel(this.seat, on ? "Stand" : "Sit down");
    this.seat.classList.toggle("on", on);
    this.seat.setAttribute("aria-pressed", on ? "true" : "false");
  }

  /** A move the cameras accepted that the on-screen board has not caught up with yet. */
  private adoptTracked() {
    const g = bus.game;
    if (!g || virtualTable.busy || this.viewPly !== null) return;
    if (g.status !== "synced" && g.status !== "moved") return;
    if (g.history.length <= virtualTable.game.history().length) return;
    const next = new Chess();
    for (const m of g.history) { try { if (!next.move(m)) return; } catch { return; } }
    virtualTable.game = next;
  }

  private paintPlay() {
    const b = bus.board, g = bus.game;
    const n = playStatus({
      cameras: bus.cameras.length,
      board: b ? { settled: b.settled, handOver: b.handOver, cams: b.cams } : null,
      startPosition: looksLikeStart(b),
      game: g ? { status: g.status, ply: g.ply, turn: g.turn, over: g.over, history: g.history, lifted: g.lifted } : null,
      phase: bus.director?.phase ?? null,
      botColor: bus.botColor,
      hint: bus.engineHint,
    });
    const key = n.tone + n.title + n.detail;
    if (key === this.playKey) return;
    this.playKey = key;
    this.playBox.dataset.tone = n.tone;
    this.playTitle.textContent = n.title;
    this.playDetail.textContent = n.detail;
  }

  /** Turn, the last few moves, what each side has taken, and the clocks when a clock is publishing. */
  private paintGame() {
    const g = virtualTable.game, hist = g.history(), end = virtualTable.ended;
    const missing = (color: "w" | "b") => {
      const have: Record<string, number> = { q: 0, r: 0, b: 0, n: 0, p: 0 };
      for (const row of g.board()) for (const p of row) if (p && p.color === color && p.type !== "k") have[p.type]++;
      const glyph = color === "w" ? { q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" } : { q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
      let s = "";
      for (const t of ["q", "r", "b", "n", "p"] as const) for (let i = 0; i < START_N[t] - (have[t] ?? 0); i++) s += glyph[t];
      return s;
    };
    const turn = end?.kind === "resign" ? (end.color === "w" ? "Black wins" : "White wins") : end?.kind === "draw" || g.isDraw() ? "Draw" : g.isCheckmate() ? (g.turn() === "w" ? "Black wins" : "White wins") : `${g.turn() === "w" ? "White" : "Black"} to move`;
    const clk = bus.clock ? `${fmtClock(bus.clock.white.ms)} · ${fmtClock(bus.clock.black.ms)}` : "";
    const taken = [missing("b") && `White ${missing("b")}`, missing("w") && `Black ${missing("w")}`].filter(Boolean).join("   ");
    const key = `${turn}|${clk}|${hist.join(" ")}|${taken}|${this.viewPly ?? "live"}|${end?.kind ?? ""}`;
    if (key === this.gameKey) return;
    this.gameKey = key;
    const moves = el("span", "moves");
    for (let i = 0; i < hist.length; i += 2) {
      moves.append(document.createTextNode(`${i / 2 + 1}. `));
      const white = el("button", "", hist[i]); white.type = "button";
      white.setAttribute("aria-label", `Move ${i / 2 + 1}, White ${hist[i]}: show this position`);
      if (this.viewPly === i + 1) { white.classList.add("on"); white.setAttribute("aria-current", "true"); }
      white.onclick = () => { this.viewPly = i + 1; this.paintGame(); this.paintBoardAria(); };
      moves.append(white);
      if (hist[i + 1]) {
        moves.append(document.createTextNode(" "));
        const black = el("button", "", hist[i + 1]); black.type = "button";
        black.setAttribute("aria-label", `Move ${i / 2 + 1}, Black ${hist[i + 1]}: show this position`);
        if (this.viewPly === i + 2) { black.classList.add("on"); black.setAttribute("aria-current", "true"); }
        black.onclick = () => { this.viewPly = i + 2; this.paintGame(); this.paintBoardAria(); };
        moves.append(black);
      }
      moves.append(document.createTextNode("  "));
    }
    if (hist.length) {
      const live = el("button", this.viewPly === null ? "on" : "", "Live"); live.type = "button";
      live.setAttribute("aria-label", "Follow the live game"); live.setAttribute("aria-pressed", String(this.viewPly === null));
      live.onclick = () => { this.viewPly = null; this.paintGame(); this.paintBoardAria(); };
      moves.append(live);
    }
    this.gamebar.replaceChildren(el("span", "turn", clk ? `${turn} · ${clk}` : turn), moves, el("span", "caps", taken));
    if (!virtualTable.over) { this.banner.hidden = true; this.banner.replaceChildren(); return; }
    this.banner.hidden = false;
    const msg = el("span", "over-msg", turn);
    const rematch = withIcon(el("button", "", "Rematch"), "undo"); rematch.type = "button";
    rematch.onclick = () => this.startFresh();
    this.banner.replaceChildren(msg, rematch);
  }
  /** Puts every piece back and clears a resignation or an agreed draw. */
  private startFresh() {
    this.pending = null; this.viewPly = null; this.sel = null; this.drag = null;
    this.paintPromo(); this.banner.hidden = true; this.banner.replaceChildren(); virtualTable.reset(); this.paintGame(); this.paintBoardAria();
  }
  private paintFlip() {
    const on = flipped();
    this.flipBtn.classList.toggle("on", on);
    this.flipBtn.setAttribute("aria-pressed", on ? "true" : "false");
  }
  private paintDisp() {
    const d = viewSettings().display;
    this.hintsBtn.classList.toggle("on", d.hints); this.hintsBtn.setAttribute("aria-pressed", String(d.hints));
    this.dotsBtn.classList.toggle("on", d.legalMoves); this.dotsBtn.setAttribute("aria-pressed", String(d.legalMoves));
  }
  private paintBoardAria() {
    const base = "Chessboard. Arrow keys move the cursor. Enter or Space selects and moves. q, r, b or n chooses a promotion. Flip turns the board so Black plays from the bottom.";
    if (this.sel === null || this.viewPly !== null) { this.cv.setAttribute("aria-label", base); return; }
    const from = sqName(this.sel);
    const dest = virtualTable.game.moves({ verbose: true }).filter((m) => m.from === from).map((m) => m.to);
    this.cv.setAttribute("aria-label", dest.length ? `${base} ${from} selected. Legal squares: ${dest.join(", ")}.` : `${base} ${from} selected.`);
  }
  seatCb: (seated: boolean) => void = () => {};
  /** Called on every press on the table; return true when it was used up (e.g. to offer taking over from the AI players), so no piece is grabbed. */
  takeover: () => boolean = () => false;

  /** Hover card for the virtual table: what is on the square, what the cameras and tracker think, and what every colour on it means. */
  tips = (e: Element): Tip | null => {
    if (e !== this.cv) return null;
    const g = bus.game, d = bus.director, b = bus.board;
    if (this.over === null) {
      const m = this.overMargin, btn = d?.phase === "menu" && m ? d.menu.find((x) => Math.hypot(x.x - (m.x + 0), x.y - m.y) <= x.r) : null;
      if (btn) return { title: btn.label, tag: "menu button", color: "#8caaff", body: "A projected button. Hold a hand over it until the ring fills to select it.", rows: [{ label: "Dwell progress", value: pct(d!.progress[btn.id] ?? 0), bar: d!.progress[btn.id] ?? 0 }] };
      return { title: "Table edge", tag: "virtual table", color: "#8caaff", body: "Outside the board. Menu buttons and the simulated arms appear here.", rows: [{ label: "Phase", value: d?.phase ?? "idle" }, ...(virtualTable.hand ? [{ label: "Hand", value: virtualTable.carried !== null ? "carrying a piece" : "over the table" }] : [])] };
    }
    const sq = this.over, name = sqName(sq), r = Math.floor(sq / 8), c = sq % 8;
    const real = virtualTable.game.board()[r][c], realCh = real ? (real.color === "w" ? real.type.toUpperCase() : real.type) : null;
    const tracked = fenPieces(g?.fen)[sq] ?? null;
    const rows: TipRow[] = [{ label: "On the table", value: pieceLabel(realCh) }];
    if (g) rows.push({ label: "Tracker thinks", value: pieceLabel(tracked), tone: (tracked ?? null) === realCh ? "ok" : "bad" });
    if (b) {
      const occ = b.occ[sq], seen = occ > 0.5, white = b.white[sq];
      rows.push({ label: "Cameras see", value: seen ? `a ${white > 0.5 ? "white" : "black"} piece` : "empty", bar: b.conf[sq], tone: tone(b.conf[sq]) });
    } else rows.push({ label: "Cameras see", value: "no reading yet", tone: "warn" });
    // Every colour on this square, with its reason.
    const why: string[] = [];
    const mark = (label: string, value: string, t?: TipRow["tone"]) => rows.push({ label, value, tone: t });
    if (this.sel === sq) { mark("Yellow", "your selected piece", "warn"); why.push("Yellow: the piece you clicked; click a highlighted square to move it."); }
    if (g?.lifted === name) { mark("Amber", "piece picked up", "warn"); why.push("Amber: the tracker saw this piece leave its square."); }
    if (g?.last && o2(g.last.from) === sq) { mark("Blue", "last move started here", "ok"); why.push("Blue: the last move the tracker confirmed."); }
    if (g?.last && o2(g.last.to) === sq) { mark("Blue", "last move ended here", "ok"); }
    if (g?.status === "illegal" && g.diff.includes(sq)) { mark("Red outline", "cameras ≠ expected", "bad"); why.push(`Red outline: the cameras disagree with the position the tracker expects here, so it flags the position illegal (${g.diff.length} squares disagree). Usually the cameras are not calibrated or are not seeing the board yet.`); }
    if (bus.engineHint && (bus.engineHint.from === name || bus.engineHint.to === name)) { mark("Green", bus.engineHint.from === name ? "engine move: pick up here" : "engine move: put down here", "ok"); why.push("Green: Stockfish's move. Play it on the board for the engine."); }
    if (this.sel !== null && viewSettings().display.legalMoves && virtualTable.game.moves({ verbose: true }).some((m) => m.from === sqName(this.sel!) && m.to === name)) { mark("Dot", "legal move for the selected piece"); }
    if (g) rows.push({ label: "Tracker status", value: g.status, tone: g.status === "illegal" ? "bad" : g.status === "synced" ? "ok" : "warn" });
    return {
      title: name, tag: `${isLightSquare(sq) ? "light" : "dark"} square · virtual table`, color: "#ffe45c",
      body: why.length ? why.join(" ") : real ? `A ${pieceLabel(realCh)} stands here. No overlay colours on this square.` : "Empty square. No overlay colours on this square.",
      rows, hint: this.sel === null ? "Click a piece to select it" : "Click a square to move there",
    };
  };

  /** Top-down view of both arms: sleeve, forearm, palm and fingers, higher parts drawn on top. */
  private drawArms(c: CanvasRenderingContext2D, px: number) {
    const caps = virtualTable.arms().flatMap((a) => a.capsules).sort((a, b) => a.a[1] + a.b[1] - (b.a[1] + b.b[1]));
    c.lineCap = "round";
    const to = (p: [number, number, number]) => { const q = tableXY({ x: p[0] / SQUARE + 4, y: p[2] / SQUARE + 4 }); return [q.x * px, q.y * px]; };
    for (const k of caps) {
      const [x0, y0] = to(k.a), [x1, y1] = to(k.b);
      c.strokeStyle = k.tone < 150 ? "rgba(58,74,99,.82)" : "rgba(226,170,138,.9)"; c.lineWidth = (2 * k.r * px) / SQUARE;
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    }
    c.lineCap = "butt";
  }

  private lastFrame = -1e9;
  frame(now: number) {
    const vs = viewSettings(), disp = vs.display;
    if (!dueFrame(now, this.lastFrame, vs.render.fps)) return;
    this.lastFrame = now;
    this.adoptTracked();
    this.paintSeat(); this.paintFlip(); this.paintDisp(); this.paintPlay(); this.paintGame(); this.paintBoardAria();
    this.lookSel.value = boardTheme().id; this.pieceSel.value = pieceSet().id;
    const c = this.cv.getContext("2d")!, px = this.px, m = this.margin, th = boardTheme();
    const k = pixelRatio(vs.render.scale), side = Math.round((8 + m * 2) * px * k); // backing resolution only: CSS keeps the canvas at 100% width
    if (this.cv.width !== side) this.cv.width = this.cv.height = side;
    c.setTransform(k, 0, 0, k, 0, 0);
    c.fillStyle = th.surround; c.fillRect(0, 0, (8 + m * 2) * px, (8 + m * 2) * px);
    c.save(); c.translate(m * px, m * px);
    const live = this.viewPly === null;
    const b = live ? virtualTable.game.board() : new Chess(positionAt(virtualTable.game.history(), this.viewPly!).fen).board();
    for (let i = 0; i < 64; i++) { c.fillStyle = ((i % 8) + Math.floor(i / 8)) % 2 ? th.dark : th.light; c.fillRect((i % 8) * px, Math.floor(i / 8) * px, px, px); }
    if (live && this.sel !== null) { const v = visSq(this.sel); c.fillStyle = th.hi; c.fillRect((v % 8) * px, Math.floor(v / 8) * px, px, px); }
    if (this.cursor !== null) { const v = visSq(this.cursor); c.strokeStyle = "rgba(255,228,92,.95)"; c.lineWidth = 2; c.strokeRect((v % 8) * px + 2, Math.floor(v / 8) * px + 2, px - 4, px - 4); }
    c.restore();
    const ov = { game: bus.game, director: bus.director, hint: bus.engineHint, clock: bus.clockView, pieces: bus.pieceView, outline: bus.outline, reconcile: bus.reconcile, lastMove: disp.lastMove, hints: disp.hints, flip: disp.flip };
    drawTableOverlay(c, px, m, ov, now / 1000, false, "under"); // square tints sit under the pieces
    c.save(); c.translate(m * px, m * px);
    c.font = `700 ${px * 0.28}px Arial, sans-serif`; c.textBaseline = "top"; c.textAlign = "left"; c.lineWidth = Math.max(2, px * 0.06); c.strokeStyle = "rgba(0,0,0,.75)"; c.fillStyle = "#f7f4ee";
    for (let k = 0; k < (disp.coords ? 8 : 0); k++) {
      const rank = flipped() ? k + 1 : 8 - k, file = flipped() ? "hgfedcba"[k] : "abcdefgh"[k];
      c.textAlign = "left"; c.strokeText(String(rank), 0.08 * px, k * px + 0.06 * px); c.fillText(String(rank), 0.08 * px, k * px + 0.06 * px);
      c.textAlign = "right"; c.textBaseline = "bottom"; c.strokeText(file, (k + 1) * px - 0.08 * px, 8 * px - 0.04 * px); c.fillText(file, (k + 1) * px - 0.08 * px, 8 * px - 0.04 * px); c.textBaseline = "top";
    }
    if (live && this.sel !== null && disp.legalMoves) {
      const from = sqName(this.sel);
      for (const mv of virtualTable.game.moves({ verbose: true }).filter((x) => x.from === from)) {
        const i = visSq((8 - Number(mv.to[1])) * 8 + (mv.to.charCodeAt(0) - 97)), cx = ((i % 8) + 0.5) * px, cy = (Math.floor(i / 8) + 0.5) * px;
        c.fillStyle = "rgba(12,16,24,.62)"; c.beginPath();
        if (mv.captured || mv.flags.includes("e")) { c.arc(cx, cy, px * 0.46, 0, 7); c.arc(cx, cy, px * 0.34, 0, 7, true); } else c.arc(cx, cy, px * 0.22, 0, 7);
        c.fill();
      }
    }
    if (live && this.drag && this.over !== null && this.over !== this.drag.from) {
      const from = sqName(this.drag.from), to = sqName(this.over);
      if (virtualTable.game.moves({ verbose: true }).some((mv) => mv.from === from && mv.to === to)) {
        const v = visSq(this.over); c.fillStyle = "rgba(116,240,179,.38)"; c.fillRect((v % 8) * px, Math.floor(v / 8) * px, px, px);
      }
    }
    c.font = `${px * 0.82}px "Segoe UI Symbol", serif`; c.textAlign = "center"; c.textBaseline = "middle";
    b.forEach((row, r) => row.forEach((p, col) => {
      if (!p || (live && (virtualTable.carried === r * 8 + col || this.drag?.from === r * 8 + col)) || bus.pieceView) return; // projected pieces come with the overlay
      const v = visSq(r * 8 + col), x = (v % 8) * px, y = Math.floor(v / 8) * px;
      const img = pieceImage(p.color + p.type);
      if (img) { c.drawImage(img, x, y, px, px); return; }
      const g = GLYPH["b" + p.type]; c.fillStyle = p.color === "w" ? "#fdfdfd" : "#262421"; c.strokeStyle = p.color === "w" ? "#3b3a37" : "#0d0d0d"; c.lineWidth = p.color === "w" ? 2.2 : 1.2; c.strokeText(g, x + 0.5 * px, y + 0.55 * px); c.fillText(g, x + 0.5 * px, y + 0.55 * px);
    }));
    if (bus.botColor) {
      const look = virtualTable.hand, side = flipped() ? (bus.botColor === "b" ? "w" : "b") : bus.botColor;
      drawBotAvatar(c, px, side, virtualTable.busy || !!bus.engineHint, look ? tableXY(look) : null, now / 1000, bus.director?.elo);
    }
    this.drawArms(c, px);
    const lifted = (sq: number | null, x: number, y: number, hand: "me" | "bot") => { // a piece in a hand, raised and shadowed
      const p = sq === null ? null : b[Math.floor(sq / 8)][sq % 8]; if (!p) return;
      c.fillStyle = "rgba(0,0,0,.25)"; c.beginPath(); c.ellipse(x * px + 4, y * px + px * 0.4, px * 0.32, px * 0.14, 0, 0, 7); c.fill();
      const img = pieceImage(p.color + p.type), s = px * 1.12;
      if (img) c.drawImage(img, x * px - s / 2, y * px - s / 2 - 6, s, s);
      else { c.font = `${px * 0.9}px "Segoe UI Symbol", serif`; c.fillStyle = p.color === "w" ? "#fdfdfd" : "#262421"; c.fillText(GLYPH["b" + p.type], x * px, y * px - 4); }
      drawGrabHand(c, x * px, y * px - px * 0.3, px, hand === "bot" ? bus.botColor === "b" : false);
    };
    if (live && virtualTable.carried !== null && virtualTable.hand) { const h = tableXY(virtualTable.hand); lifted(virtualTable.carried, h.x, h.y, "bot"); }
    if (live && this.drag && virtualTable.pointer) { const h = tableXY(virtualTable.pointer); lifted(this.drag.from, h.x, h.y, "me"); }
    if (this.over !== null) { const v = visSq(this.over); c.strokeStyle = "rgba(255,255,255,.9)"; c.lineWidth = 2; c.strokeRect((v % 8) * px + 1, Math.floor(v / 8) * px + 1, px - 2, px - 2); }
    c.restore();
    drawTableOverlay(c, px, m, ov, now / 1000, false, "over");
    const g = bus.game, d = bus.director;
    const cams = bus.cameras.map((c) => `Camera ${c.id} is ${c.online ? "online" : "offline"}`).join(", ");
    this.info.textContent = `${d?.phase ?? "idle"}${d?.mode ? ` · ${d.mode === "engine" ? `Stockfish ${d.elo}` : "2 players"}` : ""} · tracker: ${g?.status ?? "—"}${g?.history.length ? ` · ${g.history.slice(-6).join(" ")}` : ""}${cams ? ` · ${cams}` : ""}`;
  }
}

/** 3D simulation + projection mapping: scan import, projector rig, auto-calibration, output windows. */
export class WorldPanel {
  root = el("div", "panel world");
  view: WorldView;
  cfg: MappingConfig = loadMapping();
  private cv = el("canvas", "world-cv");
  private status = el("div", "muted");
  private projSize = new Map<number, { w: number; h: number }>();
  private ch = openChannel();
  private wins = new Map<number, Window | null>();

  constructor(private graph: Graph) {
    const bar = el("div", "bar");
    const frusta = this.toggle("Projector frusta", viewSettings().display.frusta, (v) => { this.view.showFrusta = v; setDisplay({ frusta: v }); });
    const proj = this.toggle("Projected content", true, (v) => { this.view.showProjection = v; this.view.setMapping(this.cfg); });
    const scan = withIcon(el("label", "btn", "Import room scan (.glb/.obj)"), "open"); scan.dataset.tip = "Import room scan"; scan.dataset.tipBody = "Loads a 3D scan of the room, finds the flat surfaces (table, walls, floor) and maps the projectors onto them."; scan.dataset.tipTag = "file .glb · .obj"; const file = el("input"); file.type = "file"; file.accept = ".glb,.gltf,.obj"; file.hidden = true; scan.append(file);
    file.onchange = () => file.files?.[0] && void this.importScan(file.files[0]);
    const reset = withIcon(el("button", "", "Default room"), "room"); reset.dataset.tip = "Default room"; reset.dataset.tipBody = "Forgets the imported scan and projector poses and goes back to the built-in room."; reset.dataset.tipTag = "resets mapping"; reset.onclick = () => { this.cfg = defaultMapping(); this.apply(); };
    bar.append(frusta, proj, scan, reset);
    const rig = el("div", "rig");
    this.root.append(bar, this.cv, rig, this.status);
    this.view = new WorldView(this.cv, this.cfg);
    registerContextMenu(this.cv, () => viewMenu([
      { kind: "action", label: "Reset camera", run: () => this.view.resetCamera() },
      { kind: "action", label: "Default room", run: () => { this.cfg = defaultMapping(); this.apply(); } },
    ], { world: true }));
    this.renderRig(rig);
    this.status.textContent = "Auto-calibrate needs the projector output window open, and a Webcam node set to Online.";
    this.ch.onmessage = (e: MessageEvent<InMsg>) => { if (e.data.type === "size") this.projSize.set(e.data.index, { w: e.data.w, h: e.data.h }); };
  }

  private toggle(label: string, on: boolean, cb: (v: boolean) => void) {
    const l = el("label", "chk"); l.dataset.tip = label; l.dataset.tipTag = "toggle";
    l.dataset.tipBody = { "Projector frusta": "Draws the cone of light each projector throws, so you can see what it covers.", "Projected content": "Shows the overlay (move hints, clock, menu) as it lands on the table, as the projector would draw it." }[label] ?? ""; const c = el("input"); c.type = "checkbox"; c.checked = on; c.onchange = () => cb(c.checked); l.append(c, document.createTextNode(label)); return l;
  }

  private apply() { saveMapping(this.cfg); this.view.setMapping(this.cfg); this.ch.postMessage({ type: "mapping" }); }

  private renderRig(rig: HTMLElement) {
    rig.replaceChildren();
    this.cfg.projectors.forEach((p, i) => {
      const row = el("div", "rig-row"); row.append(el("b", "", p.id));
      const open = withIcon(el("button", "", "Open output"), "popout"); open.dataset.tip = `Open output for ${p.id}`; open.dataset.tipBody = "Opens the picture this projector shows in its own window. Drag it onto the projector and double-click for fullscreen."; open.onclick = () => { this.wins.set(i, window.open(`?output=${i}`, `cx-out-${i}`, "popup,width=960,height=540")); };
      const cal = withIcon(el("button", "", this.cfg.calibration[p.id] ? `Re-calibrate (${this.cfg.calibration[p.id].rms.toFixed(1)}px)` : "Auto-calibrate"), "target"); cal.dataset.tip = `Calibrate ${p.id}`; cal.dataset.tipBody = "Projects dots and watches them with the webcam to learn where the projector lands on the table. Needs the output window open and a webcam Online."; cal.dataset.tipRows = this.cfg.calibration[p.id] ? `Last error:${this.cfg.calibration[p.id].rms.toFixed(1)} px` : "Calibrated:no"; cal.onclick = () => void this.calibrate(i);
      row.append(open, cal); rig.append(row);
    });
  }

  private async calibrate(i: number) {
    const p = this.cfg.projectors[i];
    if (!this.wins.get(i) || this.wins.get(i)!.closed) { this.status.textContent = `Open the output window for ${p.id} first, drag it to the projector and double-click for fullscreen.`; return; }
    // find the first online webcam node to look at the projection
    const camId = [...this.graph.nodes.values()].find((n) => n.type === "source.webcam" && n.params.online)?.id;
    if (!camId) { this.status.textContent = "Set a Webcam node Online (the camera that sees the projection) before calibrating."; return; }
    const io = {
      show: (cmd: any) => this.ch.postMessage({ type: "calib", cmd }),
      grab: async () => { await new Promise((r) => setTimeout(r, 450)); return this.graph.outputs.get(camId)?.frame ?? null; },
    };
    this.status.textContent = `Calibrating ${p.id}…`;
    const out = await runCalibration(io, { w: 1280, h: 720 }, (pr) => (this.status.textContent = `Calibrating ${p.id}… ${Math.round(pr * 100)}%`));
    this.ch.postMessage({ type: "calib", cmd: { kind: "end" } });
    if (!out.result) { this.status.textContent = `Calibration failed: saw ${out.hits} dots (need 6). Reduce ambient light or aim the camera at the projection.`; return; }
    this.cfg.calibration[p.id] = { camToProj: out.result.camToProj, rms: out.result.rmsError };
    saveMapping(this.cfg); this.renderRig(this.root.querySelector(".rig")!);
    this.status.textContent = `${p.id} calibrated: ${out.hits} dots, RMS ${out.result.rmsError.toFixed(2)}px${out.footprint ? ", footprint found" : ""}.`;
  }

  private async importScan(f: File) {
    this.status.textContent = "Reading scan…";
    const THREE = await import("three");
    const buf = await f.arrayBuffer();
    const verts: number[] = [];
    const collect = (root: any) => root.traverse((o: any) => {
      if (!o.isMesh) return;
      o.updateWorldMatrix(true, false);
      const pos = o.geometry.attributes.position, v = new THREE.Vector3();
      const step = Math.max(1, Math.floor(pos.count / 40000));
      for (let k = 0; k < pos.count; k += step) { v.fromBufferAttribute(pos, k).applyMatrix4(o.matrixWorld); verts.push(v.x, v.y, v.z); }
    });
    if (/\.obj$/i.test(f.name)) { const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js"); collect(new OBJLoader().parse(new TextDecoder().decode(buf))); }
    else { const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js"); const g = await new GLTFLoader().parseAsync(buf, ""); collect(g.scene); }
    // recentre on the scan's floor so the table can sit at the origin
    let minY = Infinity, sx = 0, sz = 0;
    for (let k = 0; k < verts.length; k += 3) { minY = Math.min(minY, verts[k + 1]); sx += verts[k]; sz += verts[k + 2]; }
    const n = verts.length / 3;
    for (let k = 0; k < verts.length; k += 3) { verts[k] -= sx / n; verts[k + 1] -= minY; verts[k + 2] -= sz / n; }
    const surfaces = extractSurfaces(new Float32Array(verts), { tol: 0.04, minInliers: Math.max(150, n / 80), maxPlanes: 10 });
    if (!surfaces.length) { this.status.textContent = "No planar surfaces found in that scan."; return; }
    this.cfg.surfaces = surfaces; this.apply();
    this.status.textContent = `Scan mapped: ${surfaces.map((s) => s.kind).join(", ")}. Move the table by editing projector poses (saved in localStorage cx.mapping.v1).`;
  }

  frame(now: number) { this.view.render(now); }
  post(m: any) { this.ch.postMessage(m); }
}

export class LogPanel {
  root = el("div", "panel log");
  private chips = el("div", "chips"); private lines = el("div", "lines"); private ev = el("div", "events");
  private n = 0;
  constructor() { this.root.append(this.chips, el("h4", "", "Narration"), this.lines, el("h4", "", "Events"), this.ev); }
  /** Hover cards for camera chips, narration lines and events: the full record behind each short row. */
  tips = (e: Element): Tip | null => {
    if (!(e instanceof HTMLElement) || !this.root.contains(e)) return null;
    if (e.dataset.cam) {
      const c = bus.cameras.find((x) => x.id === e.dataset.cam);
      return c ? { title: `Camera ${c.id}`, tag: c.online ? "online" : "offline", color: "#35e0b4", body: "Image quality is how clean this camera's picture is; trust is how often it agreed with the other cameras, and it scales its vote in Fusion.",
        rows: [{ label: "Picture quality", value: pct(c.quality), bar: c.quality, tone: tone(c.quality) }, { label: "Trust", value: pct(c.reliability), bar: c.reliability, tone: tone(c.reliability) }] } : null;
    }
    if (e.classList.contains("ln")) {
      const l = bus.lines.find((x) => String(x.t) === e.dataset.t && x.speaker === e.dataset.who);
      return l ? { title: l.name, tag: `voice ${l.speaker}`, color: l.speaker === "A" ? "#7fd4ff" : "#ffb86b", body: l.text, rows: [{ label: "Priority", value: `${l.priority} / 3`, bar: l.priority / 3 }, { label: "Said at", value: `${Math.round(l.t / 1000)} s` }] } : null;
    }
    if (e.classList.contains("evt")) {
      const v = bus.events.find((x) => String(x.t) === e.dataset.t && x.type === e.dataset.type);
      return v ? { title: v.type, tag: "event", color: "#ff5a6e", body: "Something worth reacting to; the narrator and scene cues listen for these.",
        rows: [{ label: "At", value: `${Math.round(v.t / 1000)} s` }, ...Object.entries((v.data ?? {}) as Record<string, unknown>).slice(0, 10).map(([k, x]) => ({ label: k, value: typeof x === "object" ? JSON.stringify(x).slice(0, 40) : String(x) }))] } : null;
    }
    return null;
  };
  frame() {
    this.chips.innerHTML = bus.cameras.map((c) => `<span class="chip ok" data-cam="${c.id}">cam ${c.id} · quality ${Math.round(c.quality * 100)}% · trust ${Math.round(c.reliability * 100)}%</span>`).join("") || `<span class="chip">no camera online</span>`;
    const sig = bus.lines.length + bus.events.length;
    if (sig === this.n) return; this.n = sig;
    this.lines.innerHTML = bus.lines.slice(-12).reverse().map((l) => `<div class="ln ${l.speaker}" data-t="${l.t}" data-who="${l.speaker}"><b>${l.name}</b> ${l.text}</div>`).join("");
    this.ev.innerHTML = bus.events.slice(-14).reverse().map((e) => `<div class="evt" data-t="${e.t}" data-type="${e.type}"><b>${e.type}</b> ${e.data ? JSON.stringify(e.data).slice(0, 90) : ""}</div>`).join("");
  }
}
