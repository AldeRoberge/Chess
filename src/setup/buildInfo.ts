/** Which build is running, and what GitHub Actions says about the latest CI run on main. */
import { ago } from "./backups";

// Defined by vite.config.ts at build time.
declare const __BUILD_TIME__: string;
declare const __BUILD_COMMIT__: string;

export const BUILD = { time: Date.parse(__BUILD_TIME__), commit: __BUILD_COMMIT__ };

export const CI_REPO = "AldeRoberge/Chess";
export interface CiRun { state: "passed" | "failed" | "running"; commit: string; at: number; url: string }

/** Latest ci.yml run on main, or null when GitHub can't say (offline, rate limited, no runs yet). */
export async function latestCi(fetchFn: typeof fetch = fetch): Promise<CiRun | null> {
  try {
    const r = await fetchFn(`https://api.github.com/repos/${CI_REPO}/actions/workflows/ci.yml/runs?branch=main&per_page=1`, { headers: { Accept: "application/vnd.github+json" } });
    if (!r.ok) return null;
    const run = (await r.json())?.workflow_runs?.[0];
    if (!run) return null;
    const state = run.status !== "completed" ? "running" : run.conclusion === "success" ? "passed" : "failed";
    return { state, commit: String(run.head_sha ?? ""), at: Date.parse(run.run_started_at ?? run.created_at), url: String(run.html_url ?? "") };
  } catch { return null; }
}

/** Short hash for display. */
export const short = (sha: string) => sha.slice(0, 7);

export type Tone = "ok" | "warn" | "bad" | "";
export interface Badge { tone: Tone; text: string; tip: string; href?: string }

/** The build chip: its age, its commit, and whether CI on main has moved past it. `ci` is undefined while still asking, null when GitHub can't say. */
export function buildBadge(build: { time: number; commit: string }, ci: CiRun | null | undefined, now = Date.now()): Badge {
  const known = !!(ci && ci.commit && build.commit);
  const behind = known && ci!.commit !== build.commit;
  const when = new Date(build.time).toLocaleString();
  const from = build.commit ? `, from commit ${short(build.commit)}` : "";
  const verdict = behind ? "A newer commit has passed CI on main: reload to get it." : known ? "This is the commit CI last checked on main." : "Compared with the latest CI run on main when GitHub can be reached.";
  return {
    tone: behind ? "warn" : known ? "ok" : "",
    text: `build ${ago(build.time, now)}${build.commit ? ` · ${short(build.commit)}` : ""}${behind ? " · behind main" : known ? " · latest" : ""}`,
    tip: `Built ${when}${from}. ${verdict}`,
  };
}

/** The CI chip: the state of the latest ci.yml run on main, linking to it on GitHub. */
export function ciBadge(ci: CiRun | null | undefined, now = Date.now()): Badge {
  if (ci === undefined) return { tone: "", text: "CI checking…", tip: "Asking GitHub for the latest CI run on main." };
  if (ci === null) return { tone: "", text: "CI unavailable", tip: "GitHub did not answer: offline, or too many requests from this network." };
  const tone: Tone = ci.state === "passed" ? "ok" : ci.state === "failed" ? "bad" : "warn";
  const label = ci.state === "passed" ? "CI passed" : ci.state === "failed" ? "CI failed" : "CI running";
  return { tone, text: `${label} · ${ago(ci.at, now)}`, tip: `The ci.yml check on main for commit ${short(ci.commit)}. Opens the run on GitHub.`, href: ci.url };
}
