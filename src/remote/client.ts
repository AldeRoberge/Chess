import { renderCalibration } from "../ui/calibrate";
/**
 * The phone page (`#/remote`): follow the game on the computer, read the moves on a paper score sheet, step back through them,
 * look at what the camera sees, and send a move. It never runs the cameras or the engine; it only talks to the relay.
 */
import "../style.css";
import "./remote.css";
import "@fontsource/chakra-petch/500.css";
import "@fontsource/chakra-petch/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import { KNIGHT_SVG } from "../ui/brandIcon";
import { createMoveGuide, guideMoves } from "./moveGuide";
import { boardTheme } from "../ui/boardThemes";
import { withIcon } from "../ui/icons";
import { pieceSet } from "../ui/pieceSets";
import { Chess } from "chess.js";
import { codeFromHash, needsPromotion, positionAt, scoreSheet, sideName, targetsFrom, type RemoteCommand, type RemoteState } from "./protocol";

type Tab = "moves" | "camera" | "info" | "calibrate";
interface Poll { rev: number; clients: number; waiting?: boolean; state?: RemoteState; frames?: Record<string, number> }
export interface RemoteDeps { fetchFn?: typeof fetch; base?: string; storage?: Pick<Storage, "getItem" | "setItem">; poll?: number }

const PIECES: Record<string, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
const baseUrl = () => { try { return (import.meta as any).env?.BASE_URL ?? "/"; } catch { return "/"; } };

export function mountRemote(root: HTMLElement, deps: RemoteDeps = {}) {
  const fetchFn = deps.fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const api = `${deps.base ?? baseUrl()}remote/api/`;
  const store = () => deps.storage ?? sessionStorage;
  const read = (k: string) => { try { return store().getItem(k) ?? ""; } catch { return ""; } };
  const write = (k: string, v: string) => { try { store().setItem(k, v); } catch { /* private mode: the code is asked again next time */ } };
  const cid = read("chess.remote.cid") || Math.random().toString(36).slice(2, 12); write("chess.remote.cid", cid);
  let code = codeFromHash(location.hash) || read("chess.remote.code");
  let rev = -1, st: RemoteState | null = null, frames: Record<string, number> = {}, clients = 0;
  let view: number | null = null; // null follows the live game; a number is a half-move being looked at
  let sel: string | null = null, tab: Tab = "moves", cam = "", flipped = false, online = false, stopped = false, timer = 0;
  let sent = "";
  let latency = 0;
  let promo: { from: string; to: string; fen: string } | null = null;
  let watch = read("chess.remote.watch") === "1";

  document.body.classList.add("remote");
  root.replaceChildren();
  const page = el("div", "rm"); root.append(page);

  // ---- join popup
  function askCode(problem = "") {
    if (!head.isConnected) build();
    page.querySelector(".rm-join-pop")?.remove();
    const pop = el("div", "rm-join-pop"); pop.setAttribute("role", "dialog"); pop.setAttribute("aria-modal", "true"); pop.setAttribute("aria-label", "Join the game");
    const f = el("form", "rm-join"); f.noValidate = true;
    const h = el("h1", "", "Join the game"), p = el("p", "rm-lead", "Enter the code shown on the computer, in the Phone window.");
    const i = el("input"); i.type = "text"; i.inputMode = "numeric"; i.autocomplete = "one-time-code"; i.maxLength = 8; i.value = code; i.setAttribute("aria-label", "Join code"); i.placeholder = "Code";
    const err = el("p", "rm-err", problem); err.setAttribute("role", "alert");
    const b = withIcon(el("button", "rm-btn primary", "Join"), "arrow", 18); b.type = "submit";
    f.append(h, p, i, err, b);
    f.onsubmit = (e) => {
      e.preventDefault(); code = i.value.trim();
      if (!code) { err.textContent = "Type the code from the computer."; return; }
      write("chess.remote.code", code); clearTimeout(timer); rev = -1; st = null; pop.remove(); draw(); void poll();
    };
    pop.append(f); page.append(pop); i.focus();
  }

  // ---- main layout
  const head = el("div", "rm-head"), title = el("span", "rm-title"), conn = el("span", "rm-conn", "Connecting"); conn.setAttribute("role", "status");
  title.innerHTML = KNIGHT_SVG; title.setAttribute("role", "img"); title.setAttribute("aria-label", "Chess XP");
  const joinBtn = withIcon(el("button", "rm-btn", "Join another"), "arrow", 18); joinBtn.type = "button"; joinBtn.setAttribute("aria-label", "Join another game");
  joinBtn.onclick = () => askCode();
  const watchBtn = withIcon(el("button", "rm-btn", "Watch only"), "eye", 18); watchBtn.type = "button";
  watchBtn.setAttribute("aria-label", "Watch only");
  watchBtn.onclick = () => { watch = !watch; write("chess.remote.watch", watch ? "1" : "0"); draw(); };
  head.append(title, conn, joinBtn);
  const bottom = el("footer", "rm-bottom"); bottom.append(watchBtn);
  const turn = el("p", "rm-turn"); turn.setAttribute("aria-live", "polite");
  const confidence = el("p", "rm-confidence");
  const confidenceMeter = el("meter"); confidenceMeter.min = 0; confidenceMeter.max = 1;
  confidenceMeter.setAttribute("aria-label", "Live board confidence");
  const confidenceText = el("span"); confidence.append(confidenceText, confidenceMeter);
  const clocksEl = el("p", "rm-clocks"); clocksEl.hidden = true;
  const boardEl = el("div", "rm-board"); boardEl.setAttribute("role", "group"); boardEl.setAttribute("aria-label", "Chess board");
  const moveGuide = createMoveGuide(deps.base ?? baseUrl());
  const nav = el("div", "rm-nav");
  const navBtn = (ic: string, label: string, aria: string, run: () => void, cls = "") => { const b = withIcon(el("button", `rm-btn ${cls}`.trim(), label), ic, 20); b.type = "button"; b.setAttribute("aria-label", aria); b.onclick = run; return b; };
  const first = navBtn("first", "", "First move", () => go(0)), prev = navBtn("prev", "", "Previous move", () => go((view ?? total()) - 1));
  const next = navBtn("next", "", "Next move", () => go((view ?? total()) + 1)), last = navBtn("last", "", "Latest move", () => go(null));
  const live = navBtn("live", "Live", "Follow the live game", () => go(null), "live"), flip = navBtn("flip", "Flip", "Turn the board around", () => { flipped = !flipped; draw(); });
  nav.append(first, prev, next, last, live, flip);
  const acts = el("div", "rm-acts");
  const act = (ic: string, label: string, type: "takeback" | "resign" | "draw") => {
    const b = withIcon(el("button", "rm-btn", label), ic, 18); b.type = "button";
    b.setAttribute("aria-label", label);
    b.onclick = () => void sendCmd({ type });
    return b;
  };
  acts.append(act("undo", "Takeback", "takeback"), act("flag", "Resign", "resign"), act("people", "Draw", "draw"));
  const promoEl = el("div", "rm-promo"); promoEl.hidden = true;
  const notice = el("p", "rm-notice"); notice.setAttribute("role", "status");
  const tabs = el("div", "rm-tabs"); tabs.setAttribute("role", "tablist");
  const tabBtns = (["moves", "camera", "info", "calibrate"] as Tab[]).map((t) => { const b = withIcon(el("button", "", { moves: "Moves", camera: "Camera", info: "Game info", calibrate: "Calibrate" }[t]), { moves: "list", camera: "camera", info: "info", calibrate: "settings" }[t], 18); b.type = "button"; b.setAttribute("role", "tab"); b.onclick = () => { tab = t; drawPanel(); markTabs(); }; tabs.append(b); return b; });
  const panel = el("div", "rm-panel"); panel.setAttribute("role", "tabpanel");

  function build() { page.replaceChildren(head, turn, clocksEl, boardEl, confidence, promoEl, nav, acts, notice, tabs, panel, bottom); draw(); }
  const markTabs = () => tabBtns.forEach((b, i) => { const on = (["moves", "camera", "info", "calibrate"] as Tab[])[i] === tab; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); });

  const total = () => st?.moves.length ?? 0;
  function go(p: number | null) {
    sel = null; promo = null;
    if (p === null || p >= total()) view = null; else view = Math.max(0, p);
    draw();
  }

  // ---- drawing
  function currentPosition() {
    if (!st) return { fen: new Chess().fen(), last: null as { from: string; to: string } | null };
    if (view === null) return { fen: st.fen, last: st.last ? { from: st.last.from, to: st.last.to } : null };
    const p = positionAt(st.moves, view); return { fen: p.fen, last: p.last };
  }
  const canPlay = () => !!st && view === null && st.play !== "off" && !st.over && !watch && !st.calibration && !st.setupMoves?.length;

  function drawBoard() {
    const { fen, last: lm } = currentPosition(), g = new Chess(fen), theme = boardTheme(), set = pieceSet().id;
    const targets = sel ? targetsFrom(fen, sel) : [];
    const guides = view === null ? guideMoves(st) : [];
    boardEl.style.setProperty("--light", theme.light); boardEl.style.setProperty("--dark", theme.dark); boardEl.style.setProperty("--hi", theme.hi);
    const cells: HTMLElement[] = [];
    const images = new Map(Array.from(boardEl.querySelectorAll<HTMLButtonElement>("button[data-sq]")).map((cell) => [cell.dataset.sq, cell.querySelector("img")]));
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const file = flipped ? 7 - c : c, rank = flipped ? r : 7 - r, name = "abcdefgh"[file] + (rank + 1);
      const pc = g.get(name as never);
      const b = el("button", `rm-sq ${(file + rank) % 2 ? "light" : "dark"}`); b.type = "button"; b.dataset.sq = name;
      if (guides.some((m) => m.to === name && m.code === (pc ? pc.color + pc.type : ""))) b.classList.add("guide-destination");
      if (name === sel) b.classList.add("sel");
      if (lm && (lm.from === name || lm.to === name)) b.classList.add("last");
      if (view === null && st?.hint && (st.hint.from === name || st.hint.to === name)) b.classList.add("hint");
      if (targets.includes(name)) b.classList.add("target");
      b.setAttribute("aria-label", `${name}, ${pc ? `${pc.color === "w" ? "white" : "black"} ${PIECES[pc.type]}` : "empty"}${targets.includes(name) ? ", legal move" : ""}`);
      if (pc) {
        const im = images.get(name) ?? el("img");
        im.alt = ""; im.draggable = false;
        const src = `${deps.base ?? baseUrl()}pieces/${set}/${pc.color}${pc.type}.svg`;
        if (im.getAttribute("src") !== src) im.src = src;
        b.append(im);
      }
      if (c === 0) { const n = el("i", "rm-coord rank", String(rank + 1)); n.setAttribute("aria-hidden", "true"); b.append(n); }
      if (r === 7) { const n = el("i", "rm-coord file", "abcdefgh"[file]); n.setAttribute("aria-hidden", "true"); b.append(n); }
      b.onclick = () => tapSquare(name, fen);
      cells.push(b);
    }
    for (const cell of boardEl.querySelectorAll(":scope > .rm-sq")) cell.remove();
    boardEl.prepend(...cells);
    moveGuide.update(guides, flipped, set);
    if (moveGuide.el.parentElement !== boardEl) boardEl.append(moveGuide.el);
  }

  function tapSquare(name: string, fen: string) {
    if (!canPlay() || !st) return;
    if (promo) { promo = null; sel = null; draw(); return; }
    const g = new Chess(fen), pc = g.get(name as never);
    if (sel && sel !== name && targetsFrom(fen, sel).includes(name)) {
      if (needsPromotion(fen, sel, name)) { promo = { from: sel, to: name, fen }; sel = null; draw(); return; }
      void sendMove(sel, name); sel = null; draw(); return;
    }
    sel = pc && pc.color === st.turn && name !== sel ? name : null;
    drawBoard();
  }

  function drawPromo() {
    promoEl.replaceChildren();
    const p = promo; promoEl.hidden = !p;
    if (!p) return;
    promoEl.append(el("span", "", "Promote to"));
    for (const [ch, name] of [["q", "Queen"], ["r", "Rook"], ["b", "Bishop"], ["n", "Knight"]] as const) {
      const b = el("button", "rm-btn", name); b.type = "button"; b.setAttribute("aria-label", `Promote to ${name}`);
      b.onclick = () => { const cur = promo!; promo = null; void sendMove(cur.from, cur.to, ch); draw(); };
      promoEl.append(b);
    }
  }

  async function sendMove(from: string, to: string, promotion?: "q" | "r" | "b" | "n") {
    return sendCmd({ type: "move", from, to, ...(promotion ? { promotion } : {}) });
  }
  async function sendCmd(body: RemoteCommand) {
    sent = body.type === "move" ? `${body.from}${body.to}` : body.type;
    showNotice(body.type === "move" ? `Sending ${body.from} to ${body.to}…` : `Sending ${body.type}…`, true);
    try {
      const r = await fetchFn(`${api}cmd?code=${encodeURIComponent(code)}&cid=${cid}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); showNotice(j.error ?? "The computer did not accept the command.", false); }
    } catch { showNotice("Could not reach the computer. Check the Wi-Fi and try again.", false); }
  }
  function showNotice(text: string, ok: boolean) { notice.textContent = text; notice.classList.toggle("bad", !ok); }

  function drawTurn() {
    if (!st) { turn.textContent = "Waiting for the computer to share a game…"; clocksEl.hidden = true; clocksEl.textContent = ""; return; }
    turn.classList.toggle("back", view !== null);
    if (view !== null) turn.textContent = view === 0 ? "Looking back: start position" : `Looking back: after ${Math.ceil(view / 2)}${view % 2 ? "." : "..."} ${st.moves[view - 1]}`;
    else turn.textContent = st.setupMoves?.length ? "Set up a new game · follow the pieces home" : st.over ? (st.result ? `Game over. ${st.result}` : "Game over") : watch ? `${sideName(st.turn)} to move` : canPlay() ? "Your turn" : "Opponent’s turn";
    const c = st.clocks;
    if (!c) { clocksEl.hidden = true; clocksEl.textContent = ""; return; }
    clocksEl.hidden = false;
    const w = c.running === "w" ? `${c.white} running` : c.white;
    const b = c.running === "b" ? `${c.black} running` : c.black;
    clocksEl.textContent = `White ${w}  ·  Black ${b}`;
  }

  function drawNav() {
    const n = total(), at = view ?? n;
    first.disabled = prev.disabled = at <= 0; next.disabled = last.disabled = at >= n;
    live.classList.toggle("on", view === null); live.setAttribute("aria-pressed", String(view === null));
  }

  function drawPanel() {
    if (tab === "calibrate") {
      const signature = JSON.stringify(st?.calibration ?? null);
      if (panel.dataset.calibrationSignature !== signature || panel.firstElementChild?.textContent !== "Calibrate") {
        panel.dataset.calibrationSignature = signature;
        renderCalibration(panel, st?.calibration ?? null, c => { if (!online || !st) showNotice("Wait for the host connection.", false); else void sendCmd(c); });
      }
      return;
    }
    panel.replaceChildren();
    if (tab === "moves") {
      const rows = scoreSheet(st?.moves ?? []);
      const paper = el("div", "rm-paper");
      if (!rows.length) { paper.append(el("p", "rm-empty", "No moves yet. They are written here as they are played.")); panel.append(paper); return; }
      const t = el("table", "rm-sheet"), body = el("tbody");
      const cell = (san: string | null, ply: number) => { const td = el("td"); if (san) { const b = el("button", "", san); b.type = "button"; b.setAttribute("aria-label", `Move ${Math.ceil(ply / 2)}, ${ply % 2 ? "White" : "Black"} ${san}: show this position`); if ((view ?? total()) === ply) { b.classList.add("on"); b.setAttribute("aria-current", "true"); } b.onclick = () => go(ply); td.append(b); } return td; };
      const head = el("thead"), hr = el("tr"); for (const x of ["No.", "White", "Black"]) hr.append(el("th", "", x)); head.append(hr);
      for (const r of rows) { const tr = el("tr"); tr.append(el("th", "", String(r.n)), cell(r.white, r.n * 2 - 1), cell(r.black, r.n * 2)); body.append(tr); }
      t.append(head, body); paper.append(t); panel.append(paper);
      const cur = body.querySelector(".on") ?? body.lastElementChild; cur?.scrollIntoView?.({ block: "nearest" });
    } else if (tab === "camera") {
      const cams = st?.cameras ?? [];
      if (!cams.length) { panel.append(el("p", "rm-empty", "No cameras are set up on the computer yet.")); return; }
      if (!cams.some((c) => c.id === cam)) cam = (cams.find((c) => c.hasFrame) ?? cams[0]).id;
      if (cams.length > 1) { const bar = el("div", "rm-cams"); for (const c of cams) { const b = withIcon(el("button", c.id === cam ? "on" : "", `Camera ${c.id}${c.online ? "" : " (offline)"}`), "camera", 16); b.type = "button"; b.onclick = () => { cam = c.id; drawPanel(); }; bar.append(b); } panel.append(bar); }
      const c = cams.find((x) => x.id === cam)!;
      if (!c.hasFrame) { panel.append(el("p", "rm-empty", c.online ? "Waiting for the first picture from this camera." : "This camera is offline. Check its cable on the computer.")); return; }
      const im = el("img", "rm-shot"); im.alt = `Latest picture from camera ${c.id}`; im.src = `${api}frame/${encodeURIComponent(c.id)}.jpg?code=${encodeURIComponent(code)}&cid=${cid}&r=${frames[c.id] ?? 0}`;
      panel.append(im, el("p", "rm-cap", "Grayscale, as the tracker sees it. Updates about once a second."));
    } else {
      const dl = el("dl", "rm-info"), row = (k: string, v: string) => { dl.append(el("dt", "", k), el("dd", "", v)); };
      if (st) {
        row("Tracker", { synced: "Following the board", lifted: "A piece is in the air", illegal: "Board does not match a legal move", moved: "Move just read", pending: "Waiting for the board" }[st.status] ?? st.status);
        row("Phase", st.phase); row("Position confidence", `${Math.round(st.fidelity * 100)}%`);
        row("Last move", st.last?.san ?? "none yet");
        if (st.clocks) row("Clocks", `White ${st.clocks.white}${st.clocks.running === "w" ? " (running)" : ""} · Black ${st.clocks.black}${st.clocks.running === "b" ? " (running)" : ""}`);
        for (const c of st.cameras) row(`Camera ${c.id}`, `${c.online ? "online" : "offline"}, picture quality ${Math.round(c.quality * 100)}%`);
        row("Phones watching", String(clients));
      } else row("Status", "Waiting for the computer");
      const copy = (label: string, text: string) => {
        const b = withIcon(el("button", "rm-btn", label), "copy", 18); b.type = "button";
        b.onclick = () => { void navigator.clipboard?.writeText(text).catch(() => {}); };
        return b;
      };
      const g = new Chess();
      for (const san of st?.moves ?? []) try { g.move(san); } catch { break; }
      const save = withIcon(el("button", "rm-btn", "Download PGN"), "export", 18); save.type = "button";
      save.onclick = () => {
        const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([g.pgn()], { type: "text/plain;charset=utf-8" })); a.download = "chess-xp.pgn"; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      };
      const copies = el("div", "rm-copies"); copies.append(copy("Copy PGN", g.pgn()), copy("Copy FEN", g.fen()), save);
      panel.append(dl, copies);
      if (st?.lines.length) { const l = el("ul", "rm-lines"); for (const x of [...st.lines].reverse()) { const li = el("li"); li.append(el("b", "", x.name), document.createTextNode(` ${x.text}`)); l.append(li); } panel.append(el("h2", "", "Narration"), l); }
    }
  }

  function draw() {
    const fid = st && Number.isFinite(st.fidelity) ? Math.max(0, Math.min(1, st.fidelity)) : null;
    confidenceText.textContent = !online || fid === null ? "Board confidence unavailable" : `Live board confidence ${Math.round(fid * 100)}%`;
    confidenceMeter.hidden = !online || fid === null;
    confidenceMeter.value = fid ?? 0;
    drawTurn(); drawNav(); drawBoard(); drawPromo(); drawPanel(); markTabs();
    acts.hidden = watch || !!st?.calibration; watchBtn.classList.toggle("on", watch); watchBtn.setAttribute("aria-pressed", String(watch));
    conn.textContent = online ? (st ? `Live · ${latency} ms` : "Waiting") : "Offline, retrying…"; conn.classList.toggle("off", !online);
    if (st?.notice && `${st.notice.at}` !== lastNotice) { lastNotice = `${st.notice.at}`; if (sent) showNotice(st.notice.text, st.notice.ok); }
  }
  let lastNotice = "";

  async function poll() {
    if (stopped || !code) return;
    try {
      const started = performance.now();
      const r = await fetchFn(`${api}state?code=${encodeURIComponent(code)}&cid=${cid}&rev=${rev}`);
      if (r.status === 401) { online = false; write("chess.remote.code", ""); askCode("That code is not right. Check the computer and try again."); return; }
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json() as Poll; latency = Math.max(0, Math.round(performance.now() - started)); online = true; clients = j.clients;
      if (j.state && j.rev !== rev) { rev = j.rev; st = j.state; frames = j.frames ?? {}; if (view !== null && view > total()) view = null; draw(); }
      else if (j.rev !== rev) rev = j.rev;
      conn.textContent = st ? `Live · ${latency} ms` : "Waiting for the computer"; conn.classList.remove("off");
    } catch { online = false; conn.textContent = "Offline, retrying…"; conn.classList.add("off"); }
    if (!stopped) timer = window.setTimeout(() => void poll(), deps.poll ?? 700);
  }

  if (!code) askCode(); else { build(); void poll(); }
  return { stop() { stopped = true; clearTimeout(timer); document.body.classList.remove("remote"); } };
}
