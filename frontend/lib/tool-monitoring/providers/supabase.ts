import { fetchJson } from "../http";
import { parseApiCounts, parseDbStats, parseDiskUtil, parseSupabaseHealth, supabaseRefFromUrl } from "../parse";
import { fmtBytes, fmtDateTime, fmtInt, fmtQuota } from "../format";
import { PLANS } from "../plans";
import { quotaState, worstState } from "../thresholds";
import type { MonitoringEnv, ProviderDef, ProviderDeps } from "../types";
import { allFailed, attempt, callRpc, emptyCard, envValue, firstError, has, MISSING_MIGRATION, supabaseConfigured } from "./shared";

const API = "https://api.supabase.com";

function mgmt(path: string, env: MonitoringEnv, deps: ProviderDeps) {
  return fetchJson(`${API}${path}`, {
    fetchImpl: deps.fetchImpl,
    timeoutMs: deps.timeoutMs,
    headers: { Authorization: `Bearer ${envValue(env, "MONITORING_SUPABASE_PAT") ?? ""}` },
  });
}

export const supabaseProvider: ProviderDef = {
  key: "supabase",
  title: "Supabase",
  ttlMs: 5 * 60_000,
  configured: env => supabaseConfigured(env) || has(env, "MONITORING_SUPABASE_PAT"),
  async load(env, deps) {
    const card = emptyCard("supabase", "Supabase");
    const plan = PLANS.supabase;
    const ref = supabaseRefFromUrl(envValue(env, "NEXT_PUBLIC_SUPABASE_URL"));
    const withPat = has(env, "MONITORING_SUPABASE_PAT") && ref !== null;

    const [stats, health, disk, counts] = await Promise.all([
      supabaseConfigured(env) ? attempt(callRpc(deps, "monitoring_db_stats")) : Promise.resolve(null),
      withPat ? attempt(mgmt(`/v1/projects/${ref}/health?services=auth,db,rest,storage,realtime`, env, deps)) : Promise.resolve(null),
      withPat ? attempt(mgmt(`/v1/projects/${ref}/config/disk/util`, env, deps)) : Promise.resolve(null),
      withPat ? attempt(mgmt(`/v1/projects/${ref}/analytics/endpoints/usage.api-counts`, env, deps)) : Promise.resolve(null),
    ]);
    const parts = [stats, health, disk, counts].filter(p => p !== null);
    if (allFailed(...parts)) throw firstError(...parts);

    if (has(env, "MONITORING_SUPABASE_PAT") && ref === null) card.notes.push("Projekt-Ref nicht aus NEXT_PUBLIC_SUPABASE_URL ableitbar");
    if (!has(env, "MONITORING_SUPABASE_PAT")) card.notes.push("Dienstzustand und Disk nur mit MONITORING_SUPABASE_PAT");

    if (stats?.ok !== undefined && stats.ok !== null) {
      const s = parseDbStats(stats.ok);
      const dbBytes = s.db_bytes ?? 0;
      card.metrics.push({
        label: "Datenbank",
        value: fmtQuota(dbBytes, plan.dbBytes, fmtBytes),
        source: "db",
        state: quotaState(dbBytes, plan.dbBytes),
        quota: { used: dbBytes, limit: plan.dbBytes },
        hint: "Limit aus Plan",
      });
      const storageBytes = (s.storage ?? []).reduce((a, b) => a + (b.bytes ?? 0), 0);
      const objects = (s.storage ?? []).reduce((a, b) => a + (b.objects ?? 0), 0);
      card.metrics.push({
        label: "Storage",
        value: fmtQuota(storageBytes, plan.storageBytes, fmtBytes),
        source: "db",
        state: quotaState(storageBytes, plan.storageBytes),
        quota: { used: storageBytes, limit: plan.storageBytes },
        hint: `${fmtInt(objects)} Dateien · Limit aus Plan`,
      });
      const active = s.auth_active_30d ?? 0;
      card.metrics.push({
        label: "Aktive Konten (30 Tage)",
        value: fmtQuota(active, plan.mau),
        source: "db",
        state: quotaState(active, plan.mau),
        quota: { used: active, limit: plan.mau },
        hint: `${fmtInt(s.auth_users)} Konten total · Näherung für MAU`,
      });
      const top = (s.tables ?? []).slice(0, 3);
      if (top.length > 0) {
        card.metrics.push({ label: "Grösste Tabellen", value: top.map(t => `${t.name} ${fmtBytes(t.bytes)}`).join(", "), source: "db" });
      }
      if (s.cron === null || s.cron === undefined) {
        card.notes.push("pg_cron nicht aktiv");
      } else {
        for (const j of s.cron) {
          const failed = j.failed_24h ?? 0;
          card.metrics.push({
            label: `Cron: ${j.jobname ?? "ohne Namen"}`,
            value: j.active === false ? "inaktiv" : `${j.last_status ?? "noch nie"} · ${fmtDateTime(j.last_start)}`,
            source: "db",
            state: failed > 0 ? "warn" : "ok",
            hint: failed > 0 ? `${failed} Fehler in 24 h${j.last_message ? `: ${j.last_message}` : ""}` : undefined,
          });
        }
      }
      if (s.net) {
        const total = s.net.reduce((a, b) => a + (b.n ?? 0), 0);
        const bad = s.net.filter(r => r.status_code === null || r.status_code < 200 || r.status_code >= 300).reduce((a, b) => a + (b.n ?? 0), 0);
        if (total > 0) card.metrics.push({ label: "pg_net-Aufrufe (24 h)", value: `${fmtInt(total)}, davon ${fmtInt(bad)} ohne 2xx`, source: "db", state: bad > 0 ? "warn" : "ok" });
      }
    } else if (stats) {
      card.notes.push(stats.error === MISSING_MIGRATION ? MISSING_MIGRATION : `Datenbank-Kennzahlen: ${stats.error}`);
    }

    if (health?.ok) {
      const services = parseSupabaseHealth(health.ok.body);
      const down = services.filter(s => !s.healthy);
      card.metrics.push({
        label: "Dienste",
        value: down.length === 0 ? `${services.length} gesund` : `${down.length} gestört`,
        source: "api",
        state: down.length === 0 ? "ok" : "error",
        hint: down.length > 0 ? down.map(s => `${s.name}: ${s.status ?? "ungesund"}`).join(", ") : undefined,
      });
    } else if (health) card.notes.push(`Dienstzustand: ${health.error}`);

    if (disk?.ok) {
      const d = parseDiskUtil(disk.ok.body);
      if (d) {
        card.metrics.push({
          label: "Disk",
          value: fmtQuota(d.usedBytes, d.sizeBytes, fmtBytes),
          source: "api",
          state: quotaState(d.usedBytes, d.sizeBytes),
          quota: { used: d.usedBytes, limit: d.sizeBytes },
        });
      } else card.notes.push("Disk: Antwortformat unbekannt");
    } else if (disk) card.notes.push(`Disk: ${disk.error}`);

    if (counts?.ok) {
      const n = parseApiCounts(counts.ok.body);
      if (n !== null) card.metrics.push({ label: "API-Anfragen (letzte Periode)", value: fmtInt(n), source: "api" });
    } else if (counts) card.notes.push(`API-Anfragen: ${counts.error}`);

    card.costs.push({ label: `Plan ${plan.name}`, usd: plan.baseUsd, source: "plan", note: plan.costHint });
    card.links.push({ label: "Abrechnung", href: plan.billingUrl });
    if (ref) card.links.push({ label: "Projekt", href: `https://supabase.com/dashboard/project/${ref}` });
    const partFailed = parts.some(p => !p.ok);
    card.state = worstState(...card.metrics.map(m => m.state), partFailed ? "warn" : "ok");
    return card;
  },
};
