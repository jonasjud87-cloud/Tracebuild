import { getAuthUser, ok, unauthorized, forbidden, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;
// Ohne Volltext: Sonst fällt das Cockpit über das Antwortlimit von Vercel (4.5 MB). Den Text liefert
// GET /admin/norms/{id}. Importe bleiben sichtbar, hier werden fehlerhafte Normen gelöscht.
const LIST_COLUMNS =
  "id, title, domain, layer, jurisdiction_type, jurisdiction_name, category, source_url, zone, org_id, promoted_from_org_id, created_at, pdf_url";

function intParam(value: string | null, fallback: number, max: number): number {
  const n = Number(value);
  return value !== null && Number.isInteger(n) && n >= 0 ? Math.min(n, max) : fallback;
}

// GET /api/v1/admin/norms — every norm across every organization (super_admin only),
// annotated with the owning org's name (or null = "Plattformweit") and, when the
// norm was promoted, the org it was originally uploaded by.
export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "super_admin") return forbidden();

  const { searchParams } = new URL(request.url);
  const domain = searchParams.get("domain") ?? "bau";
  const jurisdictionType = searchParams.get("jurisdiction_type");
  const jurisdictionName = searchParams.get("jurisdiction_name");
  const orgId = searchParams.get("org_id");
  const platformOnly = searchParams.get("platform_only") === "true";

  const admin = createAdminClient();
  let query = admin.from("norms").select(LIST_COLUMNS).eq("domain", domain);
  if (jurisdictionType) query = query.eq("jurisdiction_type", jurisdictionType);
  if (jurisdictionName) query = query.eq("jurisdiction_name", jurisdictionName);
  if (platformOnly) {
    query = query.is("org_id", null);
  } else if (orgId) {
    query = query.eq("org_id", orgId);
  }

  const limit = Math.max(1, intParam(searchParams.get("limit"), DEFAULT_LIMIT, MAX_LIMIT));
  const offset = intParam(searchParams.get("offset"), 0, Number.MAX_SAFE_INTEGER);
  const { data: norms, error } = await query
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) return err(error.message, 500);

  const orgIds = new Set<string>();
  for (const n of norms ?? []) {
    if (n.org_id) orgIds.add(n.org_id as string);
    if (n.promoted_from_org_id) orgIds.add(n.promoted_from_org_id as string);
  }

  let orgNameById = new Map<string, string>();
  if (orgIds.size > 0) {
    const { data: orgs } = await admin
      .from("organizations")
      .select("id, name")
      .in("id", Array.from(orgIds));
    orgNameById = new Map((orgs ?? []).map((o) => [o.id as string, o.name as string]));
  }

  const enriched = (norms ?? []).map((n) => ({
    ...n,
    org_name: n.org_id ? orgNameById.get(n.org_id as string) ?? null : null,
    promoted_from_org_name: n.promoted_from_org_id
      ? orgNameById.get(n.promoted_from_org_id as string) ?? null
      : null,
  }));

  return ok(enriched);
}
