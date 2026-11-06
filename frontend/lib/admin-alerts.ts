import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUsdChf } from "@/lib/admin-currency";
import { monthKey, periodRange } from "@/lib/admin-billing";
import { isMissingSchema } from "@/lib/supabase/schema-errors";

export type AlertRule = "budget" | "service" | "invitation" | "inactive_org";
export type AlertSeverity = "critical" | "warning" | "info";

export interface AdminAlert {
  id: string;
  rule: AlertRule;
  severity: AlertSeverity;
  title: string;
  message: string;
  orgId: string | null;
  orgName: string | null;
  href: string;
  createdAt: string;
}

export interface AdminAlertsResult {
  alerts: AdminAlert[];
  counts: { critical: number; warning: number; info: number; total: number };
  generatedAt: string;
}

interface OrgInfo {
  id: string;
  name: string;
  status: string | null;
  monthly_budget: number | null;
  created_at: string;
}

const CACHE_TTL_MS = 60_000;
const DEGRADED_MS = 1200;
const CHECK_TIMEOUT_MS = 4000;
const PAGE = 1000;
const MAX_PAGES = 30;
const DAY_MS = 86_400_000;

let cache: { at: number; value: AdminAlertsResult } | null = null;
let inflight: Promise<AdminAlertsResult> | null = null;

async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await build(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error((error as { message?: string }).message ?? "query failed");
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
  console.error("admin-alerts: Abfrage nach", MAX_PAGES, "Seiten abgebrochen, Daten unvollständig");
  return out;
}

function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    Promise.resolve(p).then(
      v => { clearTimeout(t); resolve(v); },
      e => { clearTimeout(t); reject(e); },
    );
  });
}

function orgHref(orgId: string, tab: string): string {
  return `/admin?org=${encodeURIComponent(orgId)}&tab=${tab}`;
}

async function loadOrgs(admin: SupabaseClient): Promise<OrgInfo[]> {
  return fetchAll<OrgInfo>((from, to) =>
    admin
      .from("organizations")
      .select("id, name, status, monthly_budget, created_at")
      .is("deleted_at", null)
      .order("id")
      .range(from, to),
  );
}

async function orgIdByDocument(admin: SupabaseClient): Promise<Map<string, string>> {
  const [projects, docs] = await Promise.all([
    fetchAll<{ id: string; org_id: string }>((f, t) => admin.from("projects").select("id, org_id").order("id").range(f, t)),
    fetchAll<{ id: string; project_id: string }>((f, t) => admin.from("documents").select("id, project_id").order("id").range(f, t)),
  ]);
  const orgByProject = new Map(projects.map(p => [p.id, p.org_id]));
  const map = new Map<string, string>();
  for (const d of docs) {
    const orgId = orgByProject.get(d.project_id);
    if (orgId) map.set(d.id, orgId);
  }
  return map;
}

async function budgetAlerts(admin: SupabaseClient, orgs: OrgInfo[], now: Date): Promise<AdminAlert[]> {
  const budgeted = orgs.filter(o => Number(o.monthly_budget) > 0);
  if (!budgeted.length) return [];

  const monthStart = periodRange({ kind: "month", value: monthKey(now) }).from;
  const { usdToChf } = getUsdChf();
  const projectCosts = (table: "chat_messages" | "project_norm_summaries" | "project_kenndaten_kosten", tiebreak: "id" | "project_id") =>
    fetchAll<{ cost_usd: number | string | null; project_id: string | null }>((f, t) =>
      admin
        .from(table)
        .select("cost_usd, project_id")
        .gt("cost_usd", 0)
        .gte("created_at", monthStart)
        .order("created_at", { ascending: true })
        .order(tiebreak, { ascending: true })
        .range(f, t),
    );
  const [docOrg, projects, analyses, chat, norms, kenndaten] = await Promise.all([
    orgIdByDocument(admin),
    fetchAll<{ id: string; org_id: string }>((f, t) => admin.from("projects").select("id, org_id").order("id").range(f, t)),
    fetchAll<{ cost_usd: number | string | null; document_id: string }>((f, t) =>
      admin
        .from("analyses")
        .select("cost_usd, document_id")
        .gt("cost_usd", 0)
        .gte("created_at", monthStart)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(f, t),
    ),
    projectCosts("chat_messages", "id"),
    projectCosts("project_norm_summaries", "project_id"),
    // Ohne Migration 20261110000001 gibt es die Tabelle noch nicht.
    projectCosts("project_kenndaten_kosten", "id").catch((e: Error) => {
      if (isMissingSchema(e.message)) return [];
      throw e;
    }),
  ]);

  const costByOrg = new Map<string, number>();
  const addCost = (orgId: string | undefined, cost: number | string | null) => {
    if (!orgId) return;
    costByOrg.set(orgId, (costByOrg.get(orgId) ?? 0) + (Number(cost) || 0));
  };
  for (const a of analyses) addCost(docOrg.get(a.document_id), a.cost_usd);
  const orgByProject = new Map(projects.map(p => [p.id, p.org_id]));
  for (const r of chat.concat(norms, kenndaten)) addCost(r.project_id ? orgByProject.get(r.project_id) : undefined, r.cost_usd);

  const out: AdminAlert[] = [];
  for (const org of budgeted) {
    const budget = Number(org.monthly_budget);
    const cost = (costByOrg.get(org.id) ?? 0) * usdToChf;
    const pct = (cost / budget) * 100;
    if (pct < 80) continue;
    const critical = pct >= 100;
    out.push({
      id: `budget:${org.id}`,
      rule: "budget",
      severity: critical ? "critical" : "warning",
      title: critical ? "Monatsbudget überschritten" : "Monatsbudget fast aufgebraucht",
      message: `CHF ${cost.toFixed(2)} von CHF ${budget.toFixed(2)} (${Math.round(pct)} %)`,
      orgId: org.id,
      orgName: org.name,
      href: orgHref(org.id, "kosten"),
      createdAt: now.toISOString(),
    });
  }
  return out;
}

type CheckStatus = "online" | "degraded" | "offline" | "unknown";

async function timed(fn: () => PromiseLike<{ error: unknown } | void>): Promise<CheckStatus> {
  const t0 = Date.now();
  try {
    const res = await withTimeout(fn(), CHECK_TIMEOUT_MS);
    if (res && (res as { error?: unknown }).error) return "offline";
    return Date.now() - t0 > DEGRADED_MS ? "degraded" : "online";
  } catch (e) {
    return e instanceof Error && e.message === "timeout" ? "degraded" : "offline";
  }
}

async function checkAnthropic(): Promise<CheckStatus> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return "unknown";
  const t0 = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.anthropic.com/v1/models?limit=1", {
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      signal: controller.signal,
    });
    if (!res.ok) return "offline";
    return Date.now() - t0 > 4000 ? "degraded" : "online";
  } catch (e) {
    return e instanceof Error && e.name === "AbortError" ? "degraded" : "offline";
  } finally {
    clearTimeout(timeout);
  }
}

async function serviceAlerts(admin: SupabaseClient, now: Date): Promise<AdminAlert[]> {
  const checks: { key: string; name: string; run: () => Promise<CheckStatus> }[] = [
    { key: "db", name: "Datenbank", run: () => timed(() => admin.from("organizations").select("id", { count: "exact", head: true })) },
    { key: "storage", name: "Storage", run: () => timed(() => admin.storage.listBuckets()) },
    { key: "auth", name: "Authentifizierung", run: () => timed(() => admin.auth.admin.listUsers({ page: 1, perPage: 1 })) },
    { key: "ai", name: "KI-Analyse", run: checkAnthropic },
  ];
  const results = await Promise.all(
    checks.map(async c => {
      try { return await c.run(); } catch { return "unknown" as CheckStatus; }
    }),
  );

  const out: AdminAlert[] = [];
  checks.forEach((c, i) => {
    const status = results[i];
    if (status !== "degraded" && status !== "offline") return;
    out.push({
      id: `service:${c.key}`,
      rule: "service",
      severity: status === "offline" ? "critical" : "warning",
      title: status === "offline" ? `${c.name} nicht erreichbar` : `${c.name} verlangsamt`,
      message: status === "offline"
        ? `Der Dienst ${c.name} antwortet nicht oder meldet einen Fehler.`
        : `Der Dienst ${c.name} antwortet ungewöhnlich langsam.`,
      orgId: null,
      orgName: null,
      href: "/admin",
      createdAt: now.toISOString(),
    });
  });
  return out;
}

async function signedInUserIds(admin: SupabaseClient): Promise<Set<string>> {
  const signedIn = new Set<string>();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PAGE });
    if (error) throw new Error("auth list failed");
    const list = data?.users ?? [];
    for (const u of list) if (u.last_sign_in_at) signedIn.add(u.id);
    if (list.length < PAGE) break;
  }
  return signedIn;
}

async function invitationAlerts(admin: SupabaseClient, orgs: OrgInfo[], now: Date): Promise<AdminAlert[]> {
  const [users, signedIn] = await Promise.all([
    fetchAll<{ id: string; org_id: string; created_at: string }>((f, t) =>
      admin.from("users").select("id, org_id, created_at").range(f, t),
    ),
    signedInUserIds(admin),
  ]);

  const cutoff = now.getTime() - 7 * DAY_MS;
  const orgById = new Map(orgs.map(o => [o.id, o]));
  const stats = new Map<string, { count: number; oldest: number }>();
  for (const u of users) {
    if (signedIn.has(u.id)) continue;
    const created = new Date(u.created_at).getTime();
    if (!Number.isFinite(created) || created > cutoff) continue;
    if (!orgById.has(u.org_id)) continue;
    const s = stats.get(u.org_id);
    if (s) {
      s.count += 1;
      s.oldest = Math.min(s.oldest, created);
    } else {
      stats.set(u.org_id, { count: 1, oldest: created });
    }
  }

  const out: AdminAlert[] = [];
  for (const [orgId, s] of Array.from(stats.entries())) {
    const org = orgById.get(orgId);
    if (!org) continue;
    out.push({
      id: `invitation:${orgId}`,
      rule: "invitation",
      severity: "info",
      title: s.count === 1 ? "Einladung offen" : "Einladungen offen",
      message: s.count === 1
        ? "1 Einladung ist seit mehr als 7 Tagen nicht angenommen."
        : `${s.count} Einladungen sind seit mehr als 7 Tagen nicht angenommen.`,
      orgId,
      orgName: org.name,
      href: orgHref(orgId, "mitglieder"),
      createdAt: new Date(s.oldest + 7 * DAY_MS).toISOString(),
    });
  }
  return out;
}

async function inactiveOrgAlerts(admin: SupabaseClient, orgs: OrgInfo[], now: Date): Promise<AdminAlert[]> {
  const cutoffMs = now.getTime() - 30 * DAY_MS;
  const cutoffIso = new Date(cutoffMs).toISOString();
  const candidates = orgs.filter(o => o.status === "active" && new Date(o.created_at).getTime() < cutoffMs);
  if (!candidates.length) return [];

  const [docOrg, recentAnalyses, recentAudit] = await Promise.all([
    orgIdByDocument(admin),
    fetchAll<{ document_id: string }>((f, t) =>
      admin.from("analyses").select("document_id").gte("created_at", cutoffIso).range(f, t),
    ),
    fetchAll<{ org_id: string | null }>((f, t) =>
      admin.from("audit_log").select("org_id").gte("created_at", cutoffIso).range(f, t),
    ),
  ]);

  const activeOrgs = new Set<string>();
  for (const a of recentAnalyses) {
    const orgId = docOrg.get(a.document_id);
    if (orgId) activeOrgs.add(orgId);
  }
  for (const a of recentAudit) if (a.org_id) activeOrgs.add(a.org_id);

  return candidates
    .filter(o => !activeOrgs.has(o.id))
    .map(o => ({
      id: `inactive_org:${o.id}`,
      rule: "inactive_org" as const,
      severity: "info" as const,
      title: "Organisation inaktiv",
      message: "Seit 30 Tagen keine Analyse und keine Aktivität.",
      orgId: o.id,
      orgName: o.name,
      href: orgHref(o.id, "uebersicht"),
      createdAt: new Date(Math.max(cutoffMs, new Date(o.created_at).getTime())).toISOString(),
    }));
}

const ORDER: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };

async function compute(): Promise<AdminAlertsResult> {
  const now = new Date();
  const admin = createAdminClient();

  let orgs: OrgInfo[] = [];
  try { orgs = await loadOrgs(admin); } catch { orgs = []; }

  const settled = await Promise.all([
    budgetAlerts(admin, orgs, now).catch(() => [] as AdminAlert[]),
    serviceAlerts(admin, now).catch(() => [] as AdminAlert[]),
    invitationAlerts(admin, orgs, now).catch(() => [] as AdminAlert[]),
    inactiveOrgAlerts(admin, orgs, now).catch(() => [] as AdminAlert[]),
  ]);

  const alerts = settled.flat().sort((a, b) =>
    ORDER[a.severity] - ORDER[b.severity]
    || (a.orgName ?? "").localeCompare(b.orgName ?? "")
    || a.id.localeCompare(b.id),
  );

  const counts = { critical: 0, warning: 0, info: 0, total: alerts.length };
  for (const a of alerts) counts[a.severity] += 1;

  return { alerts, counts, generatedAt: now.toISOString() };
}

export async function evaluateAlerts(): Promise<AdminAlertsResult> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  if (inflight) return inflight;
  inflight = compute()
    .then(value => {
      cache = { at: Date.now(), value };
      return value;
    })
    .finally(() => { inflight = null; });
  return inflight;
}
