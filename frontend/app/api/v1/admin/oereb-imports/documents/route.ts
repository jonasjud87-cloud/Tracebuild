import { getAuthUser, ok, unauthorized, forbidden, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingSchema } from "@/lib/supabase/schema-errors";
import { isOerebSupportedCanton } from "@/lib/oereb/cantons";
import { DEFAULT_IMPORT_FILTER, resolveFilterRules } from "@/lib/oereb/import-filter";
import type { AdminDocument, DocumentsResponse } from "@/components/admin/oereb/types";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
const SCAN_PAGE = 1000;
const SCAN_MAX_PAGES = 20;
const STATUSES = new Set(["pending", "imported", "rejected", "failed", "duplicate_manual", "removed"]);

// Ohne filter_snapshot und text_sketch: gross und für die Anzeige ohne Nutzen.
const BASE_COLUMNS =
  "id, canton, bfs_number, municipality, title, url, doc_type, scope, status, reject_reason, reject_detail, norm_id, last_checked_at, last_update_status";
// Ab Migration 20261107000001.
const VERSION_COLUMNS = `${BASE_COLUMNS}, version_note`;
// Spalte der Entscheide: kommt mit der Migration zu lib/oereb/manual-decision.ts.
const DECISION_COLUMNS = `${VERSION_COLUMNS}, manual_decision`;

function intParam(value: string | null, fallback: number, max: number): number {
  const n = Number(value);
  return value !== null && Number.isInteger(n) && n >= 0 ? Math.min(n, max) : fallback;
}

function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, "\\$&")}%`;
}

/** Dokumente eines Kantons, nach Gemeinde sortiert, mit den wirksamen Regeln des Kantons. */
export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "super_admin") return forbidden();

  const { searchParams } = new URL(request.url);
  const canton = (searchParams.get("canton") ?? "").trim().toUpperCase();
  if (!isOerebSupportedCanton(canton)) return err("Unbekannter Kanton.", 400);

  const status = searchParams.get("status");
  if (status && !STATUSES.has(status)) return err("Unbekannter Status.", 400);
  const reason = searchParams.get("reason");
  const bfsRaw = searchParams.get("bfs");
  const bfs = bfsRaw ? Number(bfsRaw) : null;
  if (bfs !== null && !Number.isInteger(bfs)) return err("Ungültige Gemeinde.", 400);
  const q = (searchParams.get("q") ?? "").trim().slice(0, 100);
  const limit = Math.max(1, intParam(searchParams.get("limit"), DEFAULT_LIMIT, MAX_LIMIT));
  const offset = intParam(searchParams.get("offset"), 0, Number.MAX_SAFE_INTEGER);

  const admin = createAdminClient();
  const unavailable: DocumentsResponse = {
    available: false, truncated: false, total: 0, documents: [], municipalities: [], reasons: [], rules: DEFAULT_IMPORT_FILTER,
  };

  const { data: filterRows, error: filterError } = await admin.from("oereb_import_filters").select("scope, rules, active");
  if (filterError) {
    if (isMissingSchema(filterError.message)) return ok(unavailable);
    console.error("oereb-imports Filter", filterError.code);
    return err("Die Filterregeln konnten nicht geladen werden.", 500);
  }
  const rules = resolveFilterRules(filterRows ?? [], canton);

  // Auswahllisten: über den ganzen Kanton, unabhängig von den gesetzten Filtern.
  const municipalities = new Map<number, { bfs_number: number; municipality: string; count: number }>();
  const reasons = new Map<string, number>();
  let truncated = true;
  for (let page = 0; page < SCAN_MAX_PAGES; page++) {
    const { data, error } = await admin
      .from("oereb_documents")
      .select("bfs_number, municipality, reject_reason")
      .eq("canton", canton)
      .order("id", { ascending: true })
      .range(page * SCAN_PAGE, (page + 1) * SCAN_PAGE - 1);
    if (error) {
      if (isMissingSchema(error.message)) return ok(unavailable);
      console.error("oereb-imports Auswahl", error.code);
      return err("Die Dokumente konnten nicht geladen werden.", 500);
    }
    for (const row of (data ?? []) as { bfs_number: number; municipality: string; reject_reason: string | null }[]) {
      const entry = municipalities.get(row.bfs_number);
      if (entry) entry.count++;
      else municipalities.set(row.bfs_number, { bfs_number: row.bfs_number, municipality: row.municipality, count: 1 });
      if (row.reject_reason) reasons.set(row.reject_reason, (reasons.get(row.reject_reason) ?? 0) + 1);
    }
    if ((data ?? []).length < SCAN_PAGE) {
      truncated = false;
      break;
    }
  }

  const build = (columns: string) => {
    let query = admin.from("oereb_documents").select(columns, { count: "exact" }).eq("canton", canton);
    if (status) query = query.eq("status", status);
    if (reason) query = query.eq("reject_reason", reason);
    if (bfs !== null) query = query.eq("bfs_number", bfs);
    if (q) query = query.ilike("title", likePattern(q));
    return query
      .order("municipality", { ascending: true })
      .order("bfs_number", { ascending: true })
      .order("title", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + limit - 1);
  };

  let { data, error, count } = await build(DECISION_COLUMNS);
  if (error && isMissingSchema(error.message)) ({ data, error, count } = await build(VERSION_COLUMNS));
  if (error && isMissingSchema(error.message)) ({ data, error, count } = await build(BASE_COLUMNS));
  if (error) {
    console.error("oereb-imports Dokumente", error.code);
    return err("Die Dokumente konnten nicht geladen werden.", 500);
  }

  const documents = ((data ?? []) as unknown as Partial<AdminDocument>[]).map((d) => ({
    ...d,
    version_note: d.version_note ?? null,
    manual_decision: d.manual_decision ?? null,
  })) as AdminDocument[];

  return ok<DocumentsResponse>({
    available: true,
    truncated,
    total: count ?? documents.length,
    documents,
    municipalities: Array.from(municipalities.values()).sort((a, b) => a.municipality.localeCompare(b.municipality, "de-CH")),
    reasons: Array.from(reasons, ([key, value]) => ({ reason: key, count: value })),
    rules,
  });
}
