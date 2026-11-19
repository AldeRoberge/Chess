import { AI_DEFAULT_MODEL, loadAiSettings, saveAiSettings } from "../workflows/ai";
import { effectiveKey, loadServerKeys, serverHas } from "../net/vendorFetch";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };

/** The collapsible OpenAI key and model form, shared with "Build with AI" through the same saved settings. */
export class KeyBox {
  readonly root = el("div", "as-key");
  /** Another place the key may already live (the setup's own key). */
  constructor(private fallbackKey: () => string = () => "") { this.build(); }

  apiKey() { return effectiveKey(loadAiSettings().apiKey || this.fallbackKey(), "openai"); }
  model() { return loadAiSettings().model || AI_DEFAULT_MODEL; }
  toggle() { this.root.classList.toggle("open"); }
  /** Opens the form and says why (a key is needed, or the one given was refused). */
  demand() { this.root.classList.add("open", "need"); this.root.scrollIntoView?.({ block: "nearest" }); }
  private sync() { const missing = !this.apiKey().trim(); this.root.classList.toggle("need", missing); if (missing) this.root.classList.add("open"); }

  private build() {
    const s = loadAiSettings(), key = el("input"), model = el("input"), rem = el("input"), save = el("button", "primary", "Save");
    key.type = "password"; key.placeholder = "OpenAI API key (sk-...)"; key.autocomplete = "off"; key.value = s.apiKey; key.setAttribute("aria-label", "OpenAI API key");
    model.value = s.model; model.setAttribute("aria-label", "Model"); model.placeholder = AI_DEFAULT_MODEL;
    rem.type = "checkbox"; rem.checked = s.remember; save.type = "button";
    const keep = el("label", "chk"); keep.append(rem, el("span", "", "Remember the key in this browser (stored unencrypted)"));
    save.onclick = () => { saveAiSettings({ apiKey: key.value, model: model.value.trim() || AI_DEFAULT_MODEL, remember: rem.checked }); this.root.classList.remove("open"); this.sync(); };
    this.root.replaceChildren(el("p", "", "Messages go to OpenAI. The assistant never sees API keys, and never sets them."), key, model, keep, save);
    this.sync();
    // The form is built before the worker says which keys it holds: once it does, close the form if the server has one.
    void loadServerKeys().then(() => {
      if (!this.apiKey().trim()) return;
      this.root.classList.remove("open", "need");
      if (serverHas("openai") && !loadAiSettings().apiKey.trim() && !this.fallbackKey().trim()) {
        const note = this.root.querySelector("p");
        if (note) note.textContent = "The Cloudflare worker already has an OpenAI key, so this browser does not need one.";
      }
    });
  }
}
