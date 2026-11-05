import { getAuthUser, ok, unauthorized, forbidden, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingSchema } from "@/lib/supabase/schema-errors";
import { OEREB_SUPPORTED_CANTONS } from "@/lib/oereb/cantons";
import { resolveFilterRules } from "@/lib/oereb/import-filter";
import type { CantonOverview, CantonRelease, FilterRow, OverviewResponse } from "@/components/admin/oereb/types";

export const dynamic = "force-dynamic";

const PAGE = 1000;
const MAX_PAGES = 50;

function releaseOf(rows: FilterRow[], canton: string): CantonRelease {
  const setsDocTypes = (scope: string) =>
    rows.some((r) => r.active && r.scope === scope && Array.isArray((r.rules as { doc_types?: unknown } | null)?.doc_types));
  return {
    released: resolveFilterRules(rows, canton).doc_types.length > 0,
    source: setsDocTypes(canton) ? "canton" : setsDocTypes("default") ? "default" : "code",
  };
}

/** Überblick je Kanton: Zahlen, Freigabe und die Filterzeilen aus der Datenbank. */
export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "super_admin") return forbidden();

  const admin = createAdminClient();
  const empty: OverviewResponse = { available: false, truncated: false, cantons: [], filters: [] };

  const { data: filterData, error: filterError } = await admin
    .from("oereb_import_filters")
    .select("scope, rules, active, note, updated_at")
    .order("scope", { ascending: true });
  if (filterError) {
    if (isMissingSchema(filterError.message)) return ok(empty);
    console.error("oereb-imports Filter", filterError.code);
    return err("Die Filterregeln konnten nicht geladen werden.", 500);
  }
  const filters = (filterData ?? []) as FilterRow[];

  const cantons = new Map<string, CantonOverview>(
    OEREB_SUPPORTED_CANTONS.map((canton) => {
      const own = filters.find((f) => f.scope === canton);
      return [canton, {
        canton,
        release: releaseOf(filters, canton),
        own_rules: own ? (own.active ? "active" : "inactive") : "none",
        total: 0, imported: 0, rejected: 0, scans: 0, failed: 0, pending: 0,
      } satisfies CantonOverview];
    })
  );

  let truncated = true;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await admin
      .from("oereb_documents")
      .select("canton, status, reject_reason")
      .order("id", { ascending: true })
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (error) {
      if (isMissingSchema(error.message)) return ok(empty);
      console.error("oereb-imports Überblick", error.code);
      return err("Die Dokumente konnten nicht gezählt werden.", 500);
    }
    for (const row of (data ?? []) as { canton: string; status: string; reject_reason: string | null }[]) {
      const entry = cantons.get(row.canton);
      if (!entry) continue;
      entry.total++;
      if (row.status === "imported") entry.imported++;
      else if (row.status === "failed") entry.failed++;
      else if (row.status === "pending") entry.pending++;
      else if (row.status === "rejected") {
        if (row.reject_reason === "scan_or_short") entry.scans++;
        else entry.rejected++;
      }
    }
    if ((data ?? []).length < PAGE) {
      truncated = false;
      break;
    }
  }

  return ok<OverviewResponse>({ available: true, truncated, cantons: Array.from(cantons.values()), filters });
}
