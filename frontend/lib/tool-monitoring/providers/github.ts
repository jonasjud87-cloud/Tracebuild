import { MonitorError, fetchJson, type FetchedJson } from "../http";
import { parseArrayLength, parseCommit, parseDependabot, parseLatestRuns } from "../parse";
import { fmtDateTime, fmtInt, shortSha } from "../format";
import { worstState } from "../thresholds";
import type { MonitoringEnv, ProviderDef, ProviderDeps } from "../types";
import { allFailed, attempt, emptyCard, envValue, firstError, has } from "./shared";

export const DEFAULT_GITHUB_REPO = "jonasjud87-cloud/Tracebuild";
const API = "https://api.github.com";

export function githubRepo(env: MonitoringEnv): string {
  const repo = envValue(env, "MONITORING_GITHUB_REPO") ?? DEFAULT_GITHUB_REPO;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new MonitorError("MONITORING_GITHUB_REPO ungültig (Format owner/repo)");
  return repo;
}

export function githubConfigured(env: MonitoringEnv): boolean {
  return has(env, "MONITORING_GITHUB_TOKEN");
}

export function githubGet(path: string, env: MonitoringEnv, deps: ProviderDeps): Promise<FetchedJson> {
  return fetchJson(`${API}${path}`, {
    fetchImpl: deps.fetchImpl,
    timeoutMs: deps.timeoutMs,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${envValue(env, "MONITORING_GITHUB_TOKEN") ?? ""}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "tracebuild-monitoring",
    },
  });
}

/** SHA von main, für den Vergleich mit dem Produktions-Deployment. */
export async function githubMainSha(env: MonitoringEnv, deps: ProviderDeps): Promise<string> {
  const r = await githubGet(`/repos/${githubRepo(env)}/commits/main`, env, deps);
  return parseCommit(r.body).sha;
}

export const githubProvider: ProviderDef = {
  key: "github",
  title: "GitHub",
  ttlMs: 5 * 60_000,
  configured: githubConfigured,
  async load(env, deps) {
    const card = emptyCard("github", "GitHub");
    const repo = githubRepo(env);
    const base = `/repos/${repo}`;

    const [runs, pulls, alerts, commit] = await Promise.all([
      attempt(githubGet(`${base}/actions/runs?branch=main&per_page=10`, env, deps)),
      attempt(githubGet(`${base}/pulls?state=open&per_page=100`, env, deps)),
      attempt(githubGet(`${base}/dependabot/alerts?state=open&per_page=100`, env, deps)),
      attempt(githubGet(`${base}/commits/main`, env, deps)),
    ]);
    // Dependabot 403/404 heisst «nicht aktiviert» oder fehlende Berechtigung, kein Ausfall.
    const alertsDisabled = !alerts.ok && (alerts.status === 403 || alerts.status === 404);
    if (allFailed(runs, pulls, commit) && !alerts.ok) throw firstError(runs, pulls, commit, alerts);

    if (commit.ok) {
      const c = parseCommit(commit.ok.body);
      card.metrics.push({ label: "main", value: `${shortSha(c.sha)} · ${fmtDateTime(c.date)}`, source: "api" });
      if (c.url) card.links.push({ label: "Letzter Commit", href: c.url });
    } else card.notes.push(`Commit main: ${commit.error}`);

    if (runs.ok) {
      const latest = parseLatestRuns(runs.ok.body).slice(0, 5);
      for (const r of latest) {
        const failed = r.conclusion !== null && !["success", "skipped", "neutral"].includes(r.conclusion);
        card.metrics.push({
          label: `CI: ${r.name}`,
          value: r.conclusion ?? r.status ?? "unbekannt",
          source: "api",
          state: failed ? "warn" : "ok",
          hint: fmtDateTime(r.createdAt),
        });
      }
      if (latest.length === 0) card.notes.push("Keine Workflow-Läufe auf main");
    } else card.notes.push(`Workflow-Läufe: ${runs.error}`);

    if (pulls.ok) {
      card.metrics.push({ label: "Offene Pull Requests", value: fmtInt(parseArrayLength(pulls.ok.body)), source: "api" });
    } else card.notes.push(`Pull Requests: ${pulls.error}`);

    if (alerts.ok) {
      const counts = parseDependabot(alerts.ok.body);
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      const severe = (counts.critical ?? 0) + (counts.high ?? 0);
      card.metrics.push({
        label: "Dependabot-Warnungen",
        value: fmtInt(total),
        source: "api",
        state: severe > 0 ? "warn" : "ok",
        hint: total > 0 ? Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(", ") : undefined,
      });
    } else if (alertsDisabled) {
      card.metrics.push({ label: "Dependabot-Warnungen", value: "Nicht aktiviert", source: "api", hint: "Oder Token ohne Leserecht für Warnungen" });
    } else card.notes.push(`Dependabot: ${alerts.error}`);

    const last = [commit, runs, pulls].find(p => p.ok)?.ok;
    const remaining = last?.headers.get("x-ratelimit-remaining");
    if (remaining) card.metrics.push({ label: "API-Kontingent übrig", value: fmtInt(Number(remaining)), source: "api" });

    card.links.push({ label: "Repository", href: `https://github.com/${repo}` }, { label: "Actions", href: `https://github.com/${repo}/actions` });
    card.state = worstState(...card.metrics.map(m => m.state), card.notes.length > 0 ? "warn" : "ok");
    return card;
  },
};
