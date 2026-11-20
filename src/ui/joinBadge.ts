import { withIcon, setLabel } from "./icons";
/**
 * The phone join code, kept in the top bar as a small QR + code chip. It appears once the phone relay answers with a code;
 * clicking it opens a popup in the middle of the screen with a large QR, the code and the address. It never covers the app.
 */
import { qrSvg } from "./qr";

interface Source { available: boolean | null; code: string; urls: string[]; clients: number }

export function installJoinBadge(src: Source, mount: HTMLElement | (() => HTMLElement | null) = document.body) {
  const chip = document.createElement("button"); chip.type = "button"; chip.className = "jb-chip"; chip.hidden = true;
  chip.setAttribute("aria-haspopup", "dialog"); chip.setAttribute("aria-label", "Join from a phone: show the QR code and join code");
  chip.dataset.tip = "Join from a phone"; chip.dataset.tipBody = "Scan the QR code or enter the code on a phone. Click for a bigger view.";
  const chipQr = document.createElement("span"), chipCode = document.createElement("strong");
  chipQr.className = "jb-qr"; chipCode.className = "jb-code";
  chip.append(chipQr, chipCode);

  const overlay = document.createElement("div"); overlay.className = "jb-modal"; overlay.hidden = true;
  const card = document.createElement("div"); card.className = "jb-card"; card.setAttribute("role", "dialog"); card.setAttribute("aria-modal", "true"); card.setAttribute("aria-label", "Join from a phone");
  const title = document.createElement("div"); title.className = "jb-title"; title.textContent = "Join from a phone";
  const bigQr = document.createElement("div"); bigQr.className = "jb-bigqr";
  const bigCode = document.createElement("strong"); bigCode.className = "jb-bigcode";
  const status = document.createElement("div"); status.className = "jb-status";
  const url = document.createElement("div"); url.className = "jb-url";
  const row = document.createElement("div"); row.className = "jb-row";
  const copy = document.createElement("button"); copy.type = "button"; copy.className = "jb-copy"; copy.textContent = "Copy address"; withIcon(copy, "copy");
  const close = document.createElement("button"); close.type = "button"; close.className = "jb-close"; close.textContent = "Close"; withIcon(close, "x");
  row.append(copy, close); card.append(title, bigQr, bigCode, status, url, row); overlay.append(card);

  const address = () => src.urls.find((s) => s.includes("alderoberge.com")) ?? src.urls[0] ?? "";
  const hide = () => { overlay.hidden = true; };
  const show = () => { update(); overlay.hidden = false; close.focus(); };
  chip.onclick = show; close.onclick = hide;
  overlay.addEventListener("pointerdown", (e) => { if (e.target === overlay) hide(); });
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !overlay.hidden) hide(); };
  addEventListener("keydown", onKey);
  copy.onclick = () => { void navigator.clipboard?.writeText(address()).catch(() => {}); setLabel(copy, "Copied"); setTimeout(() => { setLabel(copy, "Copy address"); }, 1500); };

  let qrFor = "", placed = false;
  const place = () => {
    if (placed && chip.isConnected) return;
    const host = typeof mount === "function" ? mount() : mount;
    if (!host) return;
    host.append(chip); document.body.append(overlay); placed = true;
  };
  const update = () => {
    place();
    const ok = src.available === true && !!src.code;
    chip.hidden = !ok; if (!ok) { hide(); return; }
    const u = address();
    if (u !== qrFor) {
      qrFor = u;
      try { chipQr.replaceChildren(qrSvg(u)); bigQr.replaceChildren(qrSvg(u)); } catch { chipQr.replaceChildren(); bigQr.replaceChildren(); }
    }
    chipCode.textContent = src.code; bigCode.textContent = src.code;
    status.textContent = src.clients ? `${src.clients} phone${src.clients === 1 ? " is" : "s are"} connected` : "Scan the QR code, or open the address and enter the code";
    url.textContent = u.replace(/^https?:\/\//, "").replace(/#.*$/, "");
  };
  update();
  const t = setInterval(update, 1000);
  return { el: chip, modal: overlay, update, open: show, close: hide, stop: () => { clearInterval(t); removeEventListener("keydown", onKey); chip.remove(); overlay.remove(); } };
}
