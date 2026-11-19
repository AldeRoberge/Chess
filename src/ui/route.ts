/** Hash routes: `#/table`, `#/world`, `#/log`, `#/perf`, `#/settings/<step-id>`. Old `#/setup` links still open settings. Hash routing works on any static host and file://. */
export type Page = "table" | "world" | "log" | "perf";
/** Name of a popup that can be shown in the URL as `?dialog=<name>` (see dialogUrl.ts). Kept open-ended until the popups are wired. */
export type Dialog = string;
export type Route = { page: Page } | { page: "settings"; step: string | null };

export const PAGES: Page[] = ["table", "world", "log", "perf"];
export const PAGE_TITLES: Record<Page | "settings", string> = { table: "Table", world: "3D / Mapping", log: "Log", perf: "Performance", settings: "Settings" };

export function parseRoute(hash: string, stepIds: readonly string[] = []): Route {
  const [page, step] = hash.replace(/^#\/?/, "").split("/").map((s) => decodeURIComponent(s.trim().toLowerCase()));
  if (page === "settings" || page === "setup") return { page: "settings", step: step && stepIds.includes(step) ? step : stepIds.length ? stepIds[0] : null };
  return { page: (PAGES as string[]).includes(page) ? (page as Page) : "table" };
}

export function formatRoute(r: Route): string {
  return r.page === "settings" ? (r.step ? `#/settings/${encodeURIComponent(r.step)}` : "#/settings") : `#/${r.page}`;
}

export const sameRoute = (a: Route, b: Route) => formatRoute(a) === formatRoute(b);

export function routeTitle(r: Route, stepTitle?: string): string {
  const base = "Chess Experience";
  return r.page === "settings" ? `${stepTitle ? `${stepTitle} · ` : ""}Settings · ${base}` : `${PAGE_TITLES[r.page]} · ${base}`;
}
