import { fetchJson, fetchText } from "../http";
import { parseVercelDeployments, sumFocusJsonl } from "../parse";
import { fmtDateTime, shortSha } from "../format";
import { PLANS } from "../plans";
import { deploymentState, worstState } from "../thresholds";
import type { MonitoringEnv, ProviderDef } from "../types";
import { attempt, emptyCard, envValue, has } from "./shared";
import { githubConfigured, githubMainSha } from "./github";

const API = "https://api.vercel.com";

export function vercelConfigured(env: MonitoringEnv): boolean {
  return has(env, "MONITORING_VERCEL_TOKEN", "MONITORING_VERCEL_PROJECT_ID");
}

function startOfMonthUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export const vercelProvider: ProviderDef = {
  key: "vercel",
  title: "Vercel",
  ttlMs: 5 * 60_000,
  configured: vercelConfigured,
  async load(env, deps) {
    const card = emptyCard("vercel", "Vercel");
    const headers = { Authorization: `Bearer ${envValue(env, "MONITORING_VERCEL_TOKEN") ?? ""}` };
    const teamId = envValue(env, "MONITORING_VERCEL_TEAM_ID");
    const qs = new URLSearchParams({ projectId: envValue(env, "MONITORING_VERCEL_PROJECT_ID") ?? "", target: "production", limit: "10" });
    if (teamId) qs.set("teamId", teamId);

    const [deploymentsPart, mainPart] = await Promise.all([
      // Hauptabruf: Fehler hier macht die Karte rot.
      fetchJson(`${API}/v6/deployments?${qs.toString()}`, { fetchImpl: deps.fetchImpl, timeoutMs: deps.timeoutMs, headers }),
      githubConfigured(env) ? attempt(githubMainSha(env, deps)) : Promise.resolve(null),
    ]);
    const deployments = parseVercelDeployments(deploymentsPart.body);
    const mainSha = mainPart?.ok ?? null;
    if (mainPart === null) card.notes.push("Vergleich mit main nur mit MONITORING_GITHUB_TOKEN");
    else if (!mainPart.ok) card.notes.push(`Commit main nicht abrufbar: ${mainPart.error}`);

    const verdict = deploymentState(deployments.map(d => ({ state: d.state, sha: d.sha })), mainSha);
    card.message = verdict.message;
    const live = deployments.find(d => d.state === "READY");
    const latest = deployments[0];
    card.metrics.push({
      label: "Produktion",
      value: live ? `${shortSha(live.sha)} · ${fmtDateTime(live.createdMs)}` : "–",
      source: "api",
      state: verdict.state,
    });
    if (latest && latest !== live) {
      card.metrics.push({
        label: "Letzter Versuch",
        value: `${latest.state} · ${fmtDateTime(latest.createdMs)}`,
        source: "api",
        state: latest.state === "ERROR" ? "error" : "ok",
        hint: latest.errorCode ?? undefined,
      });
    }
    if (mainSha) card.metrics.push({ label: "main", value: shortSha(mainSha), source: "api" });
    if (latest?.inspectorUrl) card.links.push({ label: "Letztes Deployment", href: latest.inspectorUrl });

    card.costs.push({ label: `Plan ${PLANS.vercel.name}`, usd: PLANS.vercel.baseUsd, source: "plan" });
    let billingFailed = false;
    if (teamId) {
      const now = deps.now();
      const bq = new URLSearchParams({ from: startOfMonthUtc(now).toISOString(), to: now.toISOString(), teamId });
      const billing = await attempt(fetchText(`${API}/v1/billing/charges?${bq.toString()}`, { fetchImpl: deps.fetchImpl, timeoutMs: deps.timeoutMs, headers }));
      if (billing.ok) {
        const sum = sumFocusJsonl(billing.ok.text);
        card.costs.push({ label: "Nutzung (Monat bisher)", usd: sum.totalUsd, source: "api", note: sum.invalid > 0 ? `${sum.invalid} Zeilen nicht lesbar` : undefined });
      } else {
        billingFailed = true;
        card.notes.push(`Abrechnung nicht abrufbar: ${billing.error}`);
      }
    } else {
      card.notes.push("Abrechnung nur mit MONITORING_VERCEL_TEAM_ID");
    }

    card.links.push({ label: "Dashboard", href: "https://vercel.com/dashboard" }, { label: "Nutzung", href: PLANS.vercel.billingUrl });
    card.state = worstState(...card.metrics.map(m => m.state), billingFailed || (mainPart !== null && !mainPart.ok) ? "warn" : "ok");
    return card;
  },
};
