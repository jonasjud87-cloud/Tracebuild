import { fetchJson } from "../http";
import { parseAiCosts, type AiCostRow } from "../parse";
import { fmtInt } from "../format";
import { statusIndicatorState, worstState } from "../thresholds";
import type { CostLine, ProviderDef } from "../types";
import { allFailed, attempt, callRpc, emptyCard, envValue, firstError, has, MISSING_MIGRATION, STATUS_PAGES, loadStatusPage, supabaseConfigured } from "./shared";

const SOURCE_LABELS: Record<string, string> = {
  analyses: "Plananalysen",
  chat: "Chat",
  norm_summaries: "Normenblatt",
  kenndaten: "Kenndaten",
  oereb_ocr: "ÖREB-Texterkennung",
};

/** Tag in Europe/Zurich als YYYY-MM-DD. */
export function zurichDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function summarizeCosts(rows: AiCostRow[], today: string): { lines: CostLine[]; todayUsd: number; calls: number } {
  const bySource = new Map<string, { usd: number; calls: number }>();
  let todayUsd = 0;
  let calls = 0;
  for (const r of rows) {
    const s = bySource.get(r.source) ?? { usd: 0, calls: 0 };
    s.usd += r.costUsd;
    s.calls += r.calls;
    bySource.set(r.source, s);
    calls += r.calls;
    if (r.day === today) todayUsd += r.costUsd;
  }
  const lines: CostLine[] = Array.from(bySource.entries())
    .sort((a, b) => b[1].usd - a[1].usd)
    .map(([src, v]) => ({ label: SOURCE_LABELS[src] ?? src, usd: Math.round(v.usd * 10000) / 10000, source: "db", note: `${fmtInt(v.calls)} Aufrufe` }));
  return { lines, todayUsd: Math.round(todayUsd * 10000) / 10000, calls };
}

export const anthropicProvider: ProviderDef = {
  key: "anthropic",
  title: "Claude (Anthropic)",
  ttlMs: 5 * 60_000,
  configured: env => has(env, "ANTHROPIC_API_KEY") || supabaseConfigured(env),
  async load(env, deps) {
    const card = emptyCard("anthropic", "Claude (Anthropic)");
    const key = envValue(env, "ANTHROPIC_API_KEY");
    const now = deps.now();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const [ping, status, costs] = await Promise.all([
      // Kostenlos: listet nur Modelle, löst keinen Modellaufruf aus.
      key
        ? attempt(fetchJson("https://api.anthropic.com/v1/models?limit=1", { fetchImpl: deps.fetchImpl, timeoutMs: deps.timeoutMs, headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } }))
        : Promise.resolve(null),
      attempt(loadStatusPage(STATUS_PAGES.claude.url, deps)),
      supabaseConfigured(env) ? attempt(callRpc(deps, "monitoring_ai_costs", { p_since: monthStart.toISOString() })) : Promise.resolve(null),
    ]);
    const parts = [ping, costs].filter(p => p !== null);
    if (allFailed(...parts)) throw firstError(...parts);

    if (ping === null) card.metrics.push({ label: "API-Schlüssel", value: "nicht gesetzt", source: "api", state: "warn" });
    else if (ping.ok) card.metrics.push({ label: "API-Schlüssel", value: "gültig", source: "api", state: "ok" });
    else card.metrics.push({ label: "API-Schlüssel", value: "Fehler", source: "api", state: "error", hint: ping.error ?? undefined });

    if (status.ok) {
      card.metrics.push({ label: "Statusseite", value: status.ok.description ?? status.ok.indicator, source: "api", state: statusIndicatorState(status.ok.indicator) });
    } else card.notes.push(`Statusseite: ${status.error}`);

    if (costs?.ok !== undefined && costs.ok !== null) {
      const sum = summarizeCosts(parseAiCosts(costs.ok), zurichDay(now));
      card.costs.push(...sum.lines);
      card.metrics.push({ label: "Kosten heute", value: `${sum.todayUsd.toFixed(2)} USD`, source: "db" });
      card.metrics.push({ label: "Aufrufe (Monat)", value: fmtInt(sum.calls), source: "db" });
      if (sum.lines.length === 0) card.notes.push("Keine Kosten in diesem Monat");
    } else if (costs) {
      card.notes.push(costs.error === MISSING_MIGRATION ? MISSING_MIGRATION : `Kosten: ${costs.error}`);
    }

    card.notes.push("Kosten aus eigener DB (Monat bisher, UTC). Abrechnung von Anthropic kann abweichen.");
    card.links.push({ label: "Console", href: "https://console.anthropic.com/settings/usage" }, { label: "Status", href: STATUS_PAGES.claude.page });
    card.state = worstState(...card.metrics.map(m => m.state), costs && !costs.ok ? "warn" : "ok");
    return card;
  },
};
