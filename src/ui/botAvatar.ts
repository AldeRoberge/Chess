import { botKnightImage } from "./botIcon";

/**
 * The bot's body, drawn in the table margin on the far side (board units, board at 0..8, `px` pixels per unit).
 * `color` is the side the bot plays: black sits at the top, white at the bottom. `busy` makes the eyes glow amber
 * and the head lean toward `look` (where its hand is, in board units); `t` is seconds for the idle sway and blinks.
 */
export function drawBotAvatar(c: CanvasRenderingContext2D, px: number, color: "w" | "b", busy: boolean, look: { x: number; y: number } | null, t: number, elo?: number) {
  const dir = color === "b" ? -1 : 1, base = color === "b" ? 0 : 8; // the table edge nearest the bot
  const X = (u: number) => u * px, Y = (v: number) => (base + dir * v) * px; // v = distance out from that edge
  const lean = look ? Math.max(-0.35, Math.min(0.35, (look.x - 4) * 0.07)) : 0;
  const hx = 4 + lean + Math.sin(t * 1.3) * 0.04, hv = 1.7;
  c.save();
  const knight = botKnightImage();
  if (knight) { // the app's knight, made cute, stands still on the table margin and only animates (hops, sways toward its hand, amber glow) while it moves
    // it stands perfectly still until it moves a piece: then it hops, sways and leans toward its hand
    const go = busy ? 1 : 0, size = X(1.9), cx = X(4 + go * lean * 1.6), cy = Y(1.45) - go * Math.abs(Math.sin(t * 5)) * X(0.08);
    if (busy) { const g = c.createRadialGradient(cx, cy, size * 0.15, cx, cy, size * 0.75); g.addColorStop(0, "rgba(255,179,71,.55)"); g.addColorStop(1, "rgba(255,179,71,0)"); c.fillStyle = g; c.beginPath(); c.arc(cx, cy, size * 0.75, 0, Math.PI * 2); c.fill(); }
    const foot = Y(1.45) + size * 0.43;
    c.fillStyle = "rgba(0,0,0,.22)"; c.beginPath(); c.ellipse(cx, foot, size * 0.32, size * 0.07, 0, 0, Math.PI * 2); c.fill(); // soft shadow under its base
    c.save(); c.translate(cx, cy + size * 0.43); c.rotate(go * (lean * 0.6 + Math.sin(t * 4) * 0.05)); c.drawImage(knight, -size / 2, -size * 0.93, size, size); c.restore();
    c.restore();
    return;
  }
  // shoulders
  c.fillStyle = "#34425c"; c.strokeStyle = "#1c2536"; c.lineWidth = 2;
  c.beginPath(); c.ellipse(X(4), Y(2.3), X(2.1), X(0.6), 0, 0, Math.PI * 2); c.fill(); c.stroke();
  // head
  c.fillStyle = "#cfd8ea";
  c.beginPath(); c.rect(X(hx - 0.55), Y(hv) - X(0.45), X(1.1), X(0.9)); c.fill(); c.stroke();
  // eyes: dark sockets, glowing pupils that slide toward what it is looking at; blink now and then
  const blink = (t * 0.7) % 5 < 0.08;
  for (const ex of [-0.22, 0.22]) {
    c.fillStyle = "#101826"; c.beginPath(); c.arc(X(hx + ex), Y(hv), X(0.14), 0, 7); c.fill();
    if (!blink) { c.fillStyle = busy ? "#ffb347" : "#4dffb8"; c.beginPath(); c.arc(X(hx + ex + lean * 0.3), Y(hv), X(0.07), 0, 7); c.fill(); }
  }
  c.fillStyle = "rgba(255,255,255,.92)"; c.font = `700 ${px * 0.2}px system-ui, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
  c.fillText("BOT", X(4), Y(2.5));
  c.fillStyle = busy ? "#ffb347" : "rgba(255,255,255,.8)"; c.font = `600 ${px * 0.16}px system-ui, sans-serif`;
  c.fillText(`${busy ? "thinking" : color === "b" ? "Black" : "White"}${elo ? " · " + elo : ""}`, X(4), Y(2.95));
  c.restore();
}

/** A hand gripping a piece: wrist, curled fingers and thumb, centred on (x, y) in pixels, reaching in from the player's side. */
export function drawGrabHand(c: CanvasRenderingContext2D, x: number, y: number, px: number, fromTop: boolean) {
  const d = fromTop ? -1 : 1;
  c.save(); c.translate(x, y); c.lineCap = "round"; c.strokeStyle = "rgba(226,170,138,.95)";
  c.lineWidth = px * 0.17; c.beginPath(); c.moveTo(0, d * px * 0.9); c.lineTo(0, d * px * 0.3); c.stroke(); // wrist and palm
  c.lineWidth = px * 0.1;
  for (const f of [-0.2, -0.07, 0.07, 0.2]) { c.beginPath(); c.moveTo(f * px, d * px * 0.25); c.lineTo(f * px * 1.2, d * px * 0.02); c.stroke(); }
  c.beginPath(); c.moveTo(-0.28 * px, d * px * 0.25); c.lineTo(-0.12 * px, d * px * 0.02); c.stroke(); // thumb
  c.restore();
}
