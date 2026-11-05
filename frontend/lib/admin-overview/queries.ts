import { createAdminClient } from "@/lib/supabase/admin";
import { getUsdChf } from "@/lib/admin-currency";
import { dateKey, lastDayKeys, monthLabel, monthWindows, startOfDayKey } from "./time";
import type {
  OverviewBudget,
  OverviewCurrency,
  OverviewData,
  OverviewKpis,
  OverviewLatestAnalysis,
  OverviewSeriesPoint,
  TrendValue,
} from "./types";

type Admin = ReturnType<typeof createAdminClient>;

const CACHE_TTL_MS = 60_000;
const PAGE = 1000;
const MAX_PAGES = 30;
const AUTH_PAGES = 20;
const DAY_MS = 86_400_000;
const WINDOW_MS = 30 * DAY_MS;
const SERIES_DAYS = 30;
const LATEST_COUNT = 5;

interface OrgInfo {
  id: string;
  name: string;
  status: string | null;
  monthly_budget: number | string | null;
}

interface CostRow {
  at: number;
  cost: number;
  orgId: string | null;
}

interface Flags {
  truncated: boolean;
}

let cache: { at: number; value: OverviewData } | null = null;
let inflight: Promise<OverviewData> | null = null;

function first<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function changePct(value: number, prev: number): number | null {
  if (!(prev > 0)) return null;
  return Math.round(((value - prev) / prev) * 100);
}

function trend(value: number, prev: number): TrendValue {
  return { value, prev, changePct: changePct(value, prev) };
}

async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>,
  flags?: Flags,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await build(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error("query failed");
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
    if (page === MAX_PAGES - 1 && flags) flags.truncated = true;
  }
  return out;
}

async function countRows(build: () => PromiseLike<{ count: number | null; error: unknown }>): Promise<number> {
  const { count, error } = await build();
  if (error) throw new Error("count failed");
  return count ?? 0;
}

function resolveCurrency(): OverviewCurrency {
  return { code: "CHF", usdToChf: getUsdChf().usdToChf };
}

async function loadOrgs(admin: Admin, flags: Flags): Promise<OrgInfo[]> {
  return fetchAll<OrgInfo>(
    (from, to) =>
      admin
        .from("organizations")
        .select("id, name, status, monthly_budget")
        .is("deleted_at", null)
        .order("id")
        .range(from, to),
    flags,
  );
}

interface RawAnalysisCost {
  created_at: string;
  cost_usd: number | string | null;
  documents: { projects: { org_id: string | null } | { org_id: string | null }[] | null } | { projects: unknown }[] | null;
}

async function loadAnalysisRows(admin: Admin, sinceIso: string, flags: Flags): Promise<CostRow[]> {
  const rows = await fetchAll<RawAnalysisCost>(
    (from, to) =>
      admin
        .from("analyses")
        .select("created_at, cost_usd, documents(projects(org_id))")
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
    flags,
  );
  return rows.map((r) => {
    const doc = first(r.documents as { projects: unknown } | { projects: unknown }[] | null);
    const project = first(doc?.projects as { org_id: string | null } | { org_id: string | null }[] | null);
    return { at: Date.parse(r.created_at), cost: toNumber(r.cost_usd), orgId: project?.org_id ?? null };
  });
}

interface RawChatCost {
  created_at: string;
  cost_usd: number | string | null;
  projects?: { org_id: string | null } | { org_id: string | null }[] | null;
}

async function loadChatRows(admin: Admin, sinceIso: string, flags: Flags): Promise<CostRow[]> {
  const toRows = (rows: RawChatCost[]): CostRow[] =>
    rows.map((r) => ({
      at: Date.parse(r.created_at),
      cost: toNumber(r.cost_usd),
      orgId: first(r.projects)?.org_id ?? null,
    }));
  try {
    const rows = await fetchAll<RawChatCost>(
      (from, to) =>
        admin
          .from("chat_messages")
          .select("created_at, cost_usd, projects(org_id)")
          .gt("cost_usd", 0)
          .gte("created_at", sinceIso)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to),
      flags,
    );
    return toRows(rows);
  } catch {
    const rows = await fetchAll<RawChatCost>(
      (from, to) =>
        admin
          .from("chat_messages")
          .select("created_at, cost_usd")
          .gt("cost_usd", 0)
          .gte("created_at", sinceIso)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to),
      flags,
    );
    return toRows(rows);
  }
}

async function loadNormRows(admin: Admin, sinceIso: string, flags: Flags): Promise<CostRow[]> {
  const load = (table: "project_norm_summaries" | "project_kenndaten") =>
    fetchAll<RawChatCost>(
      (from, to) =>
        admin
          .from(table)
          .select("created_at, cost_usd, projects(org_id)")
          .gt("cost_usd", 0)
          .gte("created_at", sinceIso)
          .order("created_at", { ascending: false })
          .order("project_id", { ascending: false })
          .range(from, to),
      flags,
    );
  const [rows, kenndaten] = await Promise.all([
    load("project_norm_summaries"),
    // Ohne Migration 20261110000001 gibt es die Tabelle noch nicht.
    load("project_kenndaten").catch(() => [] as RawChatCost[]),
  ]);
  return rows.concat(kenndaten).map((r) => ({
    at: Date.parse(r.created_at),
    cost: toNumber(r.cost_usd),
    orgId: first(r.projects)?.org_id ?? null,
  }));
}

function sumWindow(rows: CostRow[], from: number, to: number, orgIds?: Set<string>): number {
  let total = 0;
  for (const r of rows) {
    if (!(r.at >= from && r.at < to)) continue;
    if (orgIds && !(r.orgId && orgIds.has(r.orgId))) continue;
    total += r.cost;
  }
  return total;
}

async function loadAnalysisCounts(admin: Admin, now: number): Promise<{ value: number; prev: number }> {
  const t30 = new Date(now - WINDOW_MS).toISOString();
  const t60 = new Date(now - 2 * WINDOW_MS).toISOString();
  const [value, prev] = await Promise.all([
    countRows(() => admin.from("analyses").select("id", { count: "exact", head: true }).gte("created_at", t30)),
    countRows(() =>
      admin.from("analyses").select("id", { count: "exact", head: true }).gte("created_at", t60).lt("created_at", t30),
    ),
  ]);
  return { value, prev };
}

async function loadActiveUsers(admin: Admin, now: number, activeOrgIds: Set<string>, flags: Flags): Promise<number> {
  const memberOrg = new Map<string, string>();
  const users = await fetchAll<{ id: string; org_id: string | null }>(
    (from, to) => admin.from("users").select("id, org_id").order("id").range(from, to),
    flags,
  );
  for (const u of users) if (u.org_id) memberOrg.set(u.id, u.org_id);

  const cutoff = now - WINDOW_MS;
  let count = 0;
  for (let page = 1; page <= AUTH_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PAGE });
    if (error) throw new Error("auth list failed");
    const list = data?.users ?? [];
    for (const u of list) {
      if (!u.last_sign_in_at) continue;
      const t = Date.parse(u.last_sign_in_at);
      if (!Number.isFinite(t) || t < cutoff || t > now) continue;
      const orgId = memberOrg.get(u.id);
      if (orgId && activeOrgIds.has(orgId)) count += 1;
    }
    if (list.length < PAGE) break;
    if (page === AUTH_PAGES) flags.truncated = true;
  }
  return count;
}

interface RawLatest {
  id: string;
  status: string;
  created_at: string;
  documents:
    | { projects: { name: string | null; organizations: { name: string | null } | { name: string | null }[] | null } | unknown[] | null }
    | unknown[]
    | null;
}

async function countFindings(admin: Admin, analysisId: string): Promise<number | null> {
  try {
    return await countRows(() =>
      admin
        .from("analysis_items")
        .select("id", { count: "exact", head: true })
        .eq("analysis_id", analysisId)
        .in("status", ["fail", "warn"]),
    );
  } catch {
    return null;
  }
}

async function loadLatest(admin: Admin): Promise<OverviewLatestAnalysis[]> {
  const { data, error } = await admin
    .from("analyses")
    .select("id, status, created_at, documents(projects(name, organizations(name)))")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(LATEST_COUNT);
  if (error) throw new Error("latest failed");
  const rows = (data ?? []) as unknown as RawLatest[];
  return Promise.all(
    rows.map(async (r) => {
      const doc = first(r.documents as { projects: unknown } | { projects: unknown }[] | null);
      const project = first(
        doc?.projects as
          | { name: string | null; organizations: { name: string | null } | { name: string | null }[] | null }
          | { name: string | null; organizations: { name: string | null } | { name: string | null }[] | null }[]
          | null,
      );
      const org = first(project?.organizations);
      return {
        id: r.id,
        projectName: project?.name ?? "Unbekannt",
        orgName: org?.name ?? "Unbekannt",
        status: r.status,
        createdAt: r.created_at,
        findings: r.status === "done" ? await countFindings(admin, r.id) : null,
      };
    }),
  );
}

function buildSeries(rows: CostRow[], now: number): OverviewSeriesPoint[] {
  const keys = lastDayKeys(now, SERIES_DAYS);
  const counts = new Map<string, number>(keys.map((k) => [k, 0]));
  const from = startOfDayKey(keys[0]);
  for (const r of rows) {
    if (!Number.isFinite(r.at) || r.at < from || r.at > now) continue;
    const key = dateKey(r.at);
    if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return keys.map((date) => ({ date, count: counts.get(date) ?? 0 }));
}

async function compute(): Promise<OverviewData> {
  const nowDate = new Date();
  const now = nowDate.getTime();
  const admin = createAdminClient();
  const win = monthWindows(now);
  const seriesFrom = startOfDayKey(lastDayKeys(now, SERIES_DAYS)[0]);
  const since = Math.min(now - 2 * WINDOW_MS, win.prevStart, seriesFrom);
  const flags: Flags = { truncated: false };
  const unavailable: string[] = [];

  const [orgsR, countsR, analysisR, chatR, normR] = await Promise.allSettled([
    loadOrgs(admin, flags),
    loadAnalysisCounts(admin, now),
    loadAnalysisRows(admin, new Date(since).toISOString(), flags),
    loadChatRows(admin, new Date(win.prevStart).toISOString(), flags),
    loadNormRows(admin, new Date(win.prevStart).toISOString(), flags),
  ]);

  if (orgsR.status === "rejected") unavailable.push("orgs");
  if (countsR.status === "rejected") unavailable.push("analysesCount");
  if (analysisR.status === "rejected") unavailable.push("analyses");
  if (chatR.status === "rejected") unavailable.push("chat");
  if (normR.status === "rejected") unavailable.push("norms");

  const orgs = orgsR.status === "fulfilled" ? orgsR.value : [];
  const counts = countsR.status === "fulfilled" ? countsR.value : { value: 0, prev: 0 };
  const analysisRows = analysisR.status === "fulfilled" ? analysisR.value : [];
  const chatRows = chatR.status === "fulfilled" ? chatR.value : [];

  const activeOrgIds = new Set(orgs.filter((o) => o.status === "active").map((o) => o.id));
  const t30 = now - WINDOW_MS;
  const t60 = now - 2 * WINDOW_MS;
  const curOrgs = new Set<string>();
  const prevOrgs = new Set<string>();
  for (const r of analysisRows) {
    if (!r.orgId || !activeOrgIds.has(r.orgId) || !Number.isFinite(r.at)) continue;
    if (r.at >= t30 && r.at <= now) curOrgs.add(r.orgId);
    else if (r.at >= t60 && r.at < t30) prevOrgs.add(r.orgId);
  }

  const normRows = normR.status === "fulfilled" ? normR.value : [];
  const allCosts = analysisRows.concat(chatRows, normRows);
  const costNow = sumWindow(allCosts, win.monthStart, now + 1);
  const costPrev = sumWindow(allCosts, win.prevStart, win.prevEnd);

  const budgeted = orgs.filter((o) => toNumber(o.monthly_budget) > 0);
  const budgetIds = new Set(budgeted.map((o) => o.id));
  const budgetUsd = budgeted.reduce((s, o) => s + toNumber(o.monthly_budget), 0) / getUsdChf().usdToChf;
  const usedUsd = budgetIds.size ? sumWindow(allCosts, win.monthStart, now + 1, budgetIds) : 0;
  const budget: OverviewBudget = {
    usedUsd,
    budgetUsd,
    percent: budgetUsd > 0 ? Math.round((usedUsd / budgetUsd) * 100) : null,
    orgsWithBudget: budgeted.length,
  };

  const [usersR, latestR] = await Promise.allSettled([loadActiveUsers(admin, now, activeOrgIds, flags), loadLatest(admin)]);
  if (usersR.status === "rejected") unavailable.push("activeUsers");
  if (latestR.status === "rejected") unavailable.push("latest");

  const kpis: OverviewKpis = {
    analyses30d: trend(counts.value, counts.prev),
    activeOrgs: trend(curOrgs.size, prevOrgs.size),
    activeUsers: { value: usersR.status === "fulfilled" ? usersR.value : 0 },
    cost: {
      valueUsd: costNow,
      prevUsd: costPrev,
      changePct: changePct(costNow, costPrev),
      monthLabel: monthLabel(now),
    },
  };

  return {
    generatedAt: nowDate.toISOString(),
    currency: resolveCurrency(),
    kpis,
    series: buildSeries(analysisRows, now),
    budget,
    latest: latestR.status === "fulfilled" ? latestR.value : [],
    ...(unavailable.length ? { unavailable } : {}),
    ...(flags.truncated ? { truncated: true } : {}),
  };
}

export async function getOverview(): Promise<OverviewData> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  if (inflight) return inflight;
  inflight = compute()
    .then((value) => {
      if (!value.unavailable?.length) cache = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
