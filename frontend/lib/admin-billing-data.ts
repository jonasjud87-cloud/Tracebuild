import { createAdminClient } from "@/lib/supabase/admin";
import { getUsdChf } from "@/lib/admin-currency";
import {
  aggregateCosts,
  toCents,
  type BillingAnalysis,
  type CostSource,
  type OrgCostRow,
  type UnassignedCosts,
} from "@/lib/admin-billing";
import { isMissingSchema } from "@/lib/supabase/schema-errors";

type Admin = ReturnType<typeof createAdminClient>;

const PAGE = 1000;
const MAX_PAGES = 200;

interface RawAnalysis {
  created_at: string;
  cost_usd: number | string | null;
  documents: { projects: { org_id: string | null } | { org_id: string | null }[] | null } | { projects: unknown }[] | null;
}

function first<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await build(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
  throw new Error("Zu viele Datensätze für die Kostenauswertung");
}

interface RawProjectCost {
  created_at: string;
  cost_usd: number | string | null;
  project_id: string | null;
}

export interface BillingData {
  rows: OrgCostRow[];
  usdToChf: number;
  rateSource: "env" | "fallback";
  unassigned: UnassignedCosts;
}

export async function loadBilling(admin: Admin, range?: { from: string; to: string }): Promise<BillingData> {
  const projectCosts = (table: "chat_messages" | "project_norm_summaries" | "project_kenndaten_kosten", tiebreak: "id" | "project_id") =>
    fetchAll<RawProjectCost>((from, to) => {
      let q = admin.from(table).select("created_at, cost_usd, project_id").gt("cost_usd", 0);
      if (range) q = q.gte("created_at", range.from).lt("created_at", range.to);
      return q
        .order("created_at", { ascending: true })
        .order(tiebreak, { ascending: true })
        .range(from, to);
    });

  const [orgs, projects, chatRaw, normRaw, kenndatenRaw, raw] = await Promise.all([
    fetchAll<{ id: string; name: string }>((from, to) =>
      admin.from("organizations").select("id, name").is("deleted_at", null).order("id").range(from, to),
    ),
    fetchAll<{ id: string; org_id: string | null }>((from, to) =>
      admin.from("projects").select("id, org_id").order("id").range(from, to),
    ),
    projectCosts("chat_messages", "id"),
    projectCosts("project_norm_summaries", "project_id"),
    // Ohne Migration 20261110000001 gibt es die Tabelle noch nicht.
    projectCosts("project_kenndaten_kosten", "id").catch((e: Error) => {
      if (isMissingSchema(e.message)) return [] as RawProjectCost[];
      throw e;
    }),
    fetchAll<RawAnalysis>((from, to) => {
      let q = admin
        .from("analyses")
        .select("created_at, cost_usd, documents(projects(org_id))")
        .gt("cost_usd", 0);
      if (range) q = q.gte("created_at", range.from).lt("created_at", range.to);
      return q
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);
    }),
  ]);

  const analyses: BillingAnalysis[] = [];
  let unassignedCount = 0;
  let unassignedUsd = 0;
  const add = (source: CostSource, costUsd: number, createdAt: string, orgId: string | null | undefined) => {
    if (!(costUsd > 0) || !Number.isFinite(costUsd)) return;
    if (!orgId) {
      unassignedCount += 1;
      unassignedUsd += costUsd;
      return;
    }
    analyses.push({ source, costUsd, createdAt, orgId });
  };

  for (const r of raw) {
    const doc = first(r.documents as { projects: unknown } | { projects: unknown }[] | null);
    const project = first(doc?.projects as { org_id: string | null } | { org_id: string | null }[] | null);
    add("analysis", Number(r.cost_usd), r.created_at, project?.org_id);
  }
  const orgByProject = new Map(projects.map((p) => [p.id, p.org_id]));
  for (const r of chatRaw) add("chat", Number(r.cost_usd), r.created_at, r.project_id ? orgByProject.get(r.project_id) : null);
  for (const r of normRaw.concat(kenndatenRaw)) add("norm", Number(r.cost_usd), r.created_at, r.project_id ? orgByProject.get(r.project_id) : null);

  const { usdToChf, source } = getUsdChf();
  const orgNames = new Map(orgs.map((o) => [o.id, o.name]));
  return {
    rows: aggregateCosts(analyses, orgNames, usdToChf),
    usdToChf,
    rateSource: source,
    unassigned: {
      count: unassignedCount,
      usd: Math.round(unassignedUsd * 10000) / 10000,
      chf: toCents(unassignedUsd * usdToChf) / 100,
    },
  };
}
