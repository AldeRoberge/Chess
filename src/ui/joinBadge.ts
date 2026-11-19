/**
 * A large join-code badge pinned to the bottom-right of the desktop app, so a phone can join without hunting for the Phone window.
 * It shows only once the phone relay answers with a code; × hides it (remembered), and clicking it opens the full Phone window.
 */
import { withIcon } from "./icons";

export const HIDE_KEY = "chess.joinBadge.hidden";
interface Source { available: boolean | null; code: string; urls: string[]; clients: number }

export function installJoinBadge(src: Source, openPhone: () => void, store: Pick<Storage, "getItem" | "setItem"> | null = (() => { try { return localStorage; } catch { return null; } })()) {
  const box = document.createElement("div"); box.className = "join-badge"; box.hidden = true; box.setAttribute("role", "status");
  const main = withIcon(document.createElement("button"), "phone", 22); main.type = "button"; main.className = "jb-main";
  main.setAttribute("aria-label", "Join from a phone: open the Phone window"); main.onclick = openPhone;
  const label = document.createElement("span"), code = document.createElement("strong"), url = document.createElement("span");
  label.className = "jb-label"; code.className = "jb-code"; url.className = "jb-url";
  main.append(label, code, url);
  const x = withIcon(document.createElement("button"), "x", 14); x.type = "button"; x.className = "jb-x"; x.setAttribute("aria-label", "Hide the join code");
  x.onclick = () => { try { store?.setItem(HIDE_KEY, "1"); } catch { /* private mode */ } box.hidden = true; };
  box.append(main, x); document.body.append(box);
  const update = () => {
    let hidden = false; try { hidden = store?.getItem(HIDE_KEY) === "1"; } catch { /* ignore */ }
    const show = !hidden && src.available === true && !!src.code;
    box.hidden = !show; if (!show) return;
    const u = src.urls.find((s) => s.includes("alderoberge.com")) ?? src.urls[0] ?? "";
    label.textContent = src.clients ? `Phone join code · ${src.clients} connected` : "Phone join code";
    code.textContent = src.code; url.textContent = u.replace(/^https?:\/\//, "").replace(/#.*$/, "");
  };
  update();
  const t = setInterval(update, 1000);
  return { el: box, update, stop: () => { clearInterval(t); box.remove(); } };
}
