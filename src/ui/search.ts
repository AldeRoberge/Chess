import "./search.css";
import { revealInMenu } from "./menubar";

export type SearchScope = "window" | "everywhere";
export interface SearchHit {
  id: string;
  label: string;
  location: string;
  text: string;
  reveal(): HTMLElement | null | void;
}
export interface SearchDeps {
  entries(scope: SearchScope): SearchHit[];
  ask(query: string, scope: SearchScope, hits: SearchHit[]): void;
}

export function matchSearch(entries: SearchHit[], query: string): SearchHit[] {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return entries.filter(h => terms.every(t => `${h.label} ${h.location} ${h.text}`.toLocaleLowerCase().includes(t)))
    .sort((a, b) => Number(b.label.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim())) - Number(a.label.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim())));
}

/** A nonmodal finder: the app stays visible and navigable behind the results. */
export class AppSearch {
  readonly root = document.createElement("section");
  private input = document.createElement("input");
  private scope = document.createElement("select");
  private list = document.createElement("div");
  private status = document.createElement("span");
  private hits: SearchHit[] = [];
  private at = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private marked?: HTMLElement;
  private previous: HTMLElement | null = null;
  private entries: SearchHit[] = [];
  private key = (e: KeyboardEvent) => {
    if (!this.root.isConnected) { window.removeEventListener("keydown", this.key, true); return; }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "f") {
      e.preventDefault(); e.stopImmediatePropagation(); this.open();
    } else if (!this.root.hidden && this.root.contains(e.target as Node)) {
      // Keep editor/settings shortcuts from treating search navigation as edits.
      e.stopPropagation();
      if (e.isComposing) return;
      if (e.key === "Escape") { e.preventDefault(); this.close(); }
      else if (e.key === "Enter" && e.target === this.input) { e.preventDefault(); this.ask(); }
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (e.target === this.scope) return;
        e.preventDefault(); this.move(e.key === "ArrowDown" ? 1 : -1);
      }
    }
  };

  constructor(private deps: SearchDeps, parent = document.body) {
    this.root.className = "app-search"; this.root.hidden = true;
    this.root.setAttribute("role", "dialog"); this.root.setAttribute("aria-label", "Search");
    const head = document.createElement("div"); head.className = "search-head";
    const title = document.createElement("strong"); title.textContent = "Search";
    const close = document.createElement("button"); close.type = "button"; close.textContent = "×";
    close.setAttribute("aria-label", "Close search"); close.onclick = () => this.close();
    head.append(title, close);
    this.input.type = "search"; this.input.placeholder = "Find a setting, node, section, or control…";
    this.input.setAttribute("aria-label", "Search query"); this.input.setAttribute("aria-controls", "app-search-results");
    this.scope.setAttribute("aria-label", "Search scope");
    for (const [value, label] of [["window", "This window"], ["everywhere", "Everywhere"]]) {
      const option = document.createElement("option"); option.value = value; option.textContent = label; this.scope.append(option);
    }
    const tools = document.createElement("div"); tools.className = "search-tools";
    const ai = document.createElement("button"); ai.type = "button"; ai.textContent = "Search with AI ↵"; ai.onclick = () => this.ask();
    tools.append(this.scope, ai);
    this.status.setAttribute("role", "status"); this.status.className = "search-status";
    this.list.id = "app-search-results"; this.list.className = "search-results";
    const hint = document.createElement("small"); hint.textContent = "↑ ↓ Tour matches · Click to reveal · Enter searches with AI · Esc closes";
    this.root.append(head, this.input, tools, this.status, this.list, hint); parent.append(this.root);
    this.input.oninput = () => { clearTimeout(this.timer); this.timer = setTimeout(() => this.refresh(), 160); };
    this.scope.onchange = () => { this.snapshot(); this.refresh(); };
    window.addEventListener("keydown", this.key, true);
  }

  open() {
    const dialog = document.querySelector("dialog[open]");
    if (dialog && !dialog.contains(this.root)) dialog.append(this.root);
    else if (!dialog && this.root.parentElement instanceof HTMLDialogElement) document.body.append(this.root);
    if (this.root.hidden) { this.previous = document.activeElement as HTMLElement; this.snapshot(); }
    this.root.hidden = false; this.input.focus(); this.input.select(); this.refresh();
  }
  close() {
    clearTimeout(this.timer); this.root.hidden = true; this.clearMark();
    if (this.previous?.isConnected && !this.previous.closest("[inert]")) this.previous.focus();
  }
  destroy() { this.close(); window.removeEventListener("keydown", this.key, true); this.root.remove(); }
  private snapshot() { this.entries = this.deps.entries(this.scope.value as SearchScope); }
  private clearMark() { this.marked?.classList.remove("search-match"); this.marked = undefined; }
  private refresh() {
    clearTimeout(this.timer); this.clearMark();
    this.hits = matchSearch(this.entries, this.input.value); this.at = 0;
    this.status.textContent = !this.input.value.trim() ? "Where do you want to search?" : `${this.hits.length} match${this.hits.length === 1 ? "" : "es"}${this.hits.length ? "" : " · Try Everywhere or search with AI"}`;
    this.draw(); if (this.hits.length) this.reveal();
  }
  private draw() {
    this.list.replaceChildren(...this.hits.map((hit, i) => {
      const button = document.createElement("button"); button.type = "button";
      button.className = "search-result"; button.classList.toggle("active", i === this.at);
      button.setAttribute("aria-current", String(i === this.at));
      const label = document.createElement("span"); label.textContent = hit.label;
      const location = document.createElement("small"); location.textContent = hit.location;
      button.append(label, location); button.onclick = () => { this.at = i; this.draw(); this.reveal(); this.input.focus(); };
      return button;
    }));
  }
  private move(delta: number) {
    if (!this.hits.length) return;
    this.at = (this.at + delta + this.hits.length) % this.hits.length; this.draw(); this.reveal();
    this.list.children[this.at]?.scrollIntoView?.({ block: "nearest" });
  }
  private reveal() {
    this.clearMark(); const target = this.hits[this.at]?.reveal();
    if (target) {
      this.marked = target; target.classList.add("search-match");
      // Keep the finder on the opposite side of the control being shown.
      const rect = target.getBoundingClientRect(), left = window.innerWidth > 700 && rect.left + rect.width / 2 > window.innerWidth / 2;
      this.root.style.left = left ? "18px" : "auto"; this.root.style.right = left ? "auto" : "18px";
    }
  }
  private ask() {
    const query = this.input.value.trim(); if (!query) { this.input.focus(); return; }
    const hits = matchSearch(this.entries, query), scope = this.scope.value as SearchScope;
    this.deps.ask(query, scope, hits);
  }
}

/** Search text and labels, never input values or secrets. Includes closed <details>. */
export function domSearchEntries(root: HTMLElement, location: string, beforeReveal: () => void = () => {}): SearchHit[] {
  const targets = [...root.querySelectorAll<HTMLElement>("button,label,a,h1,h2,h3,h4,summary,[role=heading],[data-search-label],input[aria-label],select[aria-label]")];
  return targets.filter(el => !el.closest(".app-search,.ne,script,style") && !el.matches("[type=password]"))
    .map((el, i) => {
      const copy = el.cloneNode(true) as HTMLElement;
      copy.querySelectorAll("input,textarea,select,[contenteditable]").forEach(field => field.remove());
      const label = (el.dataset.searchLabel || el.getAttribute("aria-label") || copy.textContent || "").trim().replace(/\s+/g, " ");
      return { id: `${location}:${i}`, label, location, text: `${el.dataset.tip ?? ""} ${el.dataset.tipBody ?? ""}`, reveal: () => {
        beforeReveal();
        revealInMenu(el);
        const dropdown = el.closest(".rdrop");
        const toggle = dropdown?.querySelector<HTMLButtonElement>("button[aria-expanded=false]");
        if (toggle && toggle !== el) toggle.click();
        for (let p: HTMLElement | null = el; p; p = p.parentElement) if (p instanceof HTMLDetailsElement) p.open = true;
        el.scrollIntoView?.({ block: "center", behavior: "smooth" }); return el;
      } };
    }).filter(h => h.label);
}
