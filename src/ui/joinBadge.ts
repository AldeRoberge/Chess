/**
 * A large join-code badge pinned to the bottom-right of the desktop app, so a phone can join without hunting for the Phone window.
 * It stays visible once the phone relay answers with a code; clicking it opens the full Phone window.
 */
import { withIcon } from "./icons";
import { qrSvg } from "./qr";

interface Source { available: boolean | null; code: string; urls: string[]; clients: number }

export function installJoinBadge(src: Source, openPhone: () => void) {
  const box = document.createElement("div"); box.className = "join-badge"; box.hidden = true; box.setAttribute("role", "status");
  const main = withIcon(document.createElement("button"), "phone", 22); main.type = "button"; main.className = "jb-main";
  main.setAttribute("aria-label", "Join from a phone: open the Phone window"); main.onclick = openPhone;
  const label = document.createElement("span"), code = document.createElement("strong"), url = document.createElement("span");
  label.className = "jb-label"; code.className = "jb-code"; url.className = "jb-url";
  main.append(label, code, url);
  const qr = document.createElement("div"); qr.className = "jb-qr"; qr.title = "Scan with a phone camera to join";
  box.append(qr, main); document.body.append(box);
  let qrFor = "";
  const update = () => {
    const show = src.available === true && !!src.code;
    box.hidden = !show; if (!show) return;
    const u = src.urls.find((s) => s.includes("alderoberge.com")) ?? src.urls[0] ?? "";
    label.textContent = src.clients ? `This PC’s join code · ${src.clients} connected` : "This PC’s join code";
    if (u !== qrFor) { qrFor = u; try { qr.replaceChildren(qrSvg(u)); } catch { qr.replaceChildren(); } }
    code.textContent = src.code; url.textContent = u.replace(/^https?:\/\//, "").replace(/#.*$/, "");
  };
  update();
  const t = setInterval(update, 1000);
  return { el: box, update, stop: () => { clearInterval(t); box.remove(); } };
}
