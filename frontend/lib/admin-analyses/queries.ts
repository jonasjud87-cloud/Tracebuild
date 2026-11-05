import { createAdminClient } from "@/lib/supabase/admin";
import {
  COST_MAX_PAGES,
  COST_PAGE_SIZE,
  COST_WINDOW_MS,
  ERROR_TEXT_MAX,
  EXPENSIVE_DEFAULT_USD,
  EXPENSIVE_WINDOW_MS,
  FAILED_WINDOW_MS,
  ORPHAN_AFTER_MINUTES,
  ORPHAN_AFTER_MS,
} from "./constants";
import { getUsdChf, toChf, toChfPrecise } from "@/lib/admin-currency";
import { encodeCursor, type ListParams } from "./params";
import type { AnalysesListResponse, AnalysesSummary, AnalysisRow, OrgOption } from "./types";

type Admin = ReturnType<typeof createAdminClient>;

const LIST_SELECT = [
  "id",
  "status",
  "cost_usd",
  "created_at",
  "duration_ms:result_json->>duration_ms",
  "error_text:result_json->>error",
  "run_id:result_json->>run_id",
  "documents!inner(id,doc_type,projects!inner(id,name,org_id,organizations(id,name)))",
].join(",");

type RawOrg = { id: string; name: string | null };

interface RawProject {
  id: string;
  name: string | null;
  org_id: string | null;
  organizations: RawOrg | RawOrg[] | null;
}

interface RawDocument {
  id: string;
  doc_type: string | null;
  projects: RawProject | RawProject[] | null;
}

interface RawRow {
  id: string;
  status: string;
  cost_usd: number | string | null;
  created_at: string;
  duration_ms: string | null;
  error_text: string | null;
  run_id: string | null;
  documents: RawDocument | RawDocument[] | null;
}

function first<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function truncate(text: string | null): string | null {
  if (!text) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length > ERROR_TEXT_MAX ? `${clean.slice(0, ERROR_TEXT_MAX - 1)}…` : clean;
}

function mapRow(raw: RawRow, now: Date, rate: number): AnalysisRow {
  const doc = first(raw.documents);
  const project = first(doc?.projects);
  const org = first(project?.organizations);
  const created = Date.parse(raw.created_at);
  const durationMs = toNumber(raw.duration_ms);
  const costUsd = toNumber(raw.cost_usd);
  return {
    id: raw.id,
    status: raw.status,
    orphaned: raw.status === "running" && Number.isFinite(created) && now.getTime() - created > ORPHAN_AFTER_MS,
    orgId: project?.org_id ?? org?.id ?? null,
    orgName: org?.name ?? "Unbekannt",
    projectId: project?.id ?? null,
    projectName: project?.name ?? "Unbekannt",
    documentId: doc?.id ?? null,
    docType: doc?.doc_type ?? null,
    createdAt: raw.created_at,
    durationMs: durationMs !== null && durationMs >= 0 ? durationMs : null,
    costUsd,
    costChf: costUsd === null ? null : toChfPrecise(costUsd, rate),
    errorText: truncate(raw.error_text),
    runId: raw.run_id || null,
  };
}

async function listAnalyses(
  admin: Admin,
  p: ListParams,
  now: Date,
  rate: number,
): Promise<{ items: AnalysisRow[]; nextCursor: string | null }> {
  let q = admin
    .from("analyses")
    .select(LIST_SELECT)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(p.limit + 1);

  if (p.view === "running") q = q.eq("status", "running");
  if (p.view === "failed") q = q.eq("status", "error");
  if (p.minCost !== null) q = q.gte("cost_usd", p.minCost);
  if (p.org) q = q.eq("documents.projects.org_id", p.org);
  if (p.from) q = q.gte("created_at", p.from);
  if (p.to) q = q.lte("created_at", p.to);
  if (p.cursor) {
    q = q.or(`created_at.lt.${p.cursor.createdAt},and(created_at.eq.${p.cursor.createdAt},id.lt.${p.cursor.id})`);
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as RawRow[];
  const hasMore = rows.length > p.limit;
  const page = hasMore ? rows.slice(0, p.limit) : rows;
  const last = page[page.length - 1];
  return {
    items: page.map((r) => mapRow(r, now, rate)),
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null,
  };
}

async function countRows(build: () => PromiseLike<{ count: number | null; error: { message: string } | null }>) {
  const { count, error } = await build();
  if (error) throw new Error(error.message);
  return count ?? 0;
}

function zurichOffsetMs(at: number): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((x) => x.type === type)?.value ?? 0);
  const localAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return localAsUtc - Math.floor(at / 1000) * 1000;
}

export function startOfZurichDay(now: Date): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((x) => x.type === type)?.value ?? 0);
  const localMidnightAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"));
  const firstGuess = localMidnightAsUtc - zurichOffsetMs(localMidnightAsUtc);
  return new Date(localMidnightAsUtc - zurichOffsetMs(firstGuess));
}

const COST_CACHE_TTL_MS = 60_000;
let costCache: { at: number; value: CostSums } | null = null;
let costInflight: Promise<CostSums> | null = null;

interface CostSums {
  today: number;
  month: number;
  truncated: boolean;
}

function sumCosts(admin: Admin, now: Date): Promise<CostSums> {
  if (costCache && Date.now() - costCache.at < COST_CACHE_TTL_MS) return Promise.resolve(costCache.value);
  if (costInflight) return costInflight;
  costInflight = computeCosts(admin, now)
    .then((value) => {
      costCache = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      costInflight = null;
    });
  return costInflight;
}

async function computeCosts(admin: Admin, now: Date): Promise<CostSums> {
  const since = new Date(now.getTime() - COST_WINDOW_MS).toISOString();
  const todayStart = startOfZurichDay(now).getTime();
  let today = 0;
  let month = 0;

  for (let page = 0; page < COST_MAX_PAGES; page++) {
    const from = page * COST_PAGE_SIZE;
    const { data, error } = await admin
      .from("analyses")
      .select("cost_usd,created_at")
      .gte("created_at", since)
      .gt("cost_usd", 0)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + COST_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { cost_usd: number | string | null; created_at: string }[];
    for (const r of rows) {
      const cost = toNumber(r.cost_usd) ?? 0;
      month += cost;
      if (Date.parse(r.created_at) >= todayStart) today += cost;
    }
    if (rows.length < COST_PAGE_SIZE) return { today, month, truncated: false };
  }
  return { today, month, truncated: true };
}

async function loadSummary(admin: Admin, now: Date, rate: number): Promise<AnalysesSummary> {
  const orphanCutoff = new Date(now.getTime() - ORPHAN_AFTER_MS).toISOString();
  const failedSince = new Date(now.getTime() - FAILED_WINDOW_MS).toISOString();
  const expensiveSince = new Date(now.getTime() - EXPENSIVE_WINDOW_MS).toISOString();
  const head = { count: "exact", head: true } as const;

  const [running, orphaned, failed24h, expensive30d, costs] = await Promise.all([
    countRows(() => admin.from("analyses").select("id", head).eq("status", "running")),
    countRows(() => admin.from("analyses").select("id", head).eq("status", "running").lt("created_at", orphanCutoff)),
    countRows(() => admin.from("analyses").select("id", head).eq("status", "error").gte("created_at", failedSince)),
    countRows(() =>
      admin.from("analyses").select("id", head).gte("cost_usd", EXPENSIVE_DEFAULT_USD).gte("created_at", expensiveSince),
    ),
    sumCosts(admin, now),
  ]);

  return {
    running,
    orphaned,
    failed24h,
    expensive30d,
    costToday: costs.today,
    cost30d: costs.month,
    costTodayChf: toChf(costs.today, rate),
    cost30dChf: toChf(costs.month, rate),
    costTruncated: costs.truncated,
  };
}

async function loadOrgOptions(admin: Admin): Promise<OrgOption[]> {
  const { data, error } = await admin.from("organizations").select("id,name").is("deleted_at", null).order("name");
  if (error) throw new Error(error.message);
  return ((data ?? []) as RawOrg[]).map((o) => ({ id: o.id, name: o.name ?? "Unbekannt" }));
}

export async function buildListResponse(admin: Admin, p: ListParams, now: Date): Promise<AnalysesListResponse> {
  const withExtras = !p.cursor;
  const { usdToChf } = getUsdChf();
  const [page, summary, orgs] = await Promise.all([
    listAnalyses(admin, p, now, usdToChf),
    withExtras ? loadSummary(admin, now, usdToChf).catch(() => null) : Promise.resolve(null),
    withExtras ? loadOrgOptions(admin).catch(() => null) : Promise.resolve(null),
  ]);
  return {
    items: page.items,
    nextCursor: page.nextCursor,
    view: p.view,
    currency: "CHF",
    usdToChf,
    thresholds: {
      expensiveUsd: EXPENSIVE_DEFAULT_USD,
      expensiveChf: toChfPrecise(EXPENSIVE_DEFAULT_USD, usdToChf),
      orphanMinutes: ORPHAN_AFTER_MINUTES,
    },
    appliedFilters: { org: p.org, from: p.from, to: p.to, minCost: p.minCost },
    summary,
    orgs,
  };
}
