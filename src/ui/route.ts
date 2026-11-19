/** Hash routes: `#/table`, `#/world`, `#/log`, `#/perf`, `#/assistant`, `#/setup/<step-id>`. Hash routing works on any static host and file://. */
export type Page = "table" | "world" | "log" | "perf" | "assistant";
/** Name of a popup that can be shown in the URL as `?dialog=<name>` (see dialogUrl.ts). Kept open-ended until the popups are wired. */
export type Dialog = string;
export type Route = { page: Page } | { page: "setup"; step: string | null };

export const PAGES: Page[] = ["table", "world", "log", "perf", "assistant"];
export const PAGE_TITLES: Record<Page | "setup", string> = { table: "Table", world: "3D / Mapping", log: "Log", perf: "Performance", assistant: "Assistant", setup: "Setup" };

export function parseRoute(hash: string, stepIds: readonly string[] = []): Route {
  const [page, step] = hash.replace(/^#\/?/, "").split("/").map((s) => decodeURIComponent(s.trim().toLowerCase()));
  if (page === "setup") return { page: "setup", step: step && stepIds.includes(step) ? step : stepIds.length ? stepIds[0] : null };
  return { page: (PAGES as string[]).includes(page) ? (page as Page) : "table" };
}

export function formatRoute(r: Route): string {
  return r.page === "setup" ? (r.step ? `#/setup/${encodeURIComponent(r.step)}` : "#/setup") : `#/${r.page}`;
}

export const sameRoute = (a: Route, b: Route) => formatRoute(a) === formatRoute(b);

export function routeTitle(r: Route, stepTitle?: string): string {
  const base = "Chess Experience";
  return r.page === "setup" ? `${stepTitle ? `${stepTitle} · ` : ""}Setup · ${base}` : `${PAGE_TITLES[r.page]} · ${base}`;
}
