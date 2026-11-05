import { getAuthUser, ok, unauthorized, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingSchema } from "@/lib/supabase/schema-errors";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

// Ohne Volltext: Globale Reglemente sprengten sonst das Antwortlimit von Vercel (4.5 MB).
// Den Text liefert GET /standards/{id}.
const LIST_COLUMNS =
  "id, title, domain, layer, jurisdiction_type, jurisdiction_name, org_id, category, source_url, source_doc, zone, pdf_url, created_at";

function intParam(value: string | null, fallback: number, max: number): number {
  const n = Number(value);
  return value !== null && Number.isInteger(n) && n >= 0 ? Math.min(n, max) : fallback;
}

/**
 * Normenliste, seitenweise (`limit`, `offset`). Automatische Importe sind ausgeblendet, sie sind pro
 * Gemeinde und Grundstück relevant und gehören nicht in den Katalog; `include_imports=1` zeigt die
 * Gemeinde-Reglemente unter ihnen, objektbezogene Vorschriften (auto_scope='parcel') nie.
 */
export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const { searchParams } = new URL(request.url);
  const domain = searchParams.get("domain") ?? "bau";
  const jurisdictionType = searchParams.get("jurisdiction_type");
  const jurisdictionName = searchParams.get("jurisdiction_name");
  const includeImports = searchParams.get("include_imports") === "1";
  const limit = Math.max(1, intParam(searchParams.get("limit"), DEFAULT_LIMIT, MAX_LIMIT));
  const offset = intParam(searchParams.get("offset"), 0, Number.MAX_SAFE_INTEGER);

  const admin = createAdminClient();
  // Eigene Normen der Organisation plus die plattformweiten (org_id null), die
  // TraceBuild für alle Organisationen hinterlegt. Löschen bleibt auf eigene
  // beschränkt (standards/[id]).
  const build = (hideImports: boolean) => {
    let query = admin
      .from("norms")
      .select(LIST_COLUMNS)
      .eq("domain", domain)
      .or(`org_id.eq.${user.org_id},org_id.is.null`);
    if (jurisdictionType) query = query.eq("jurisdiction_type", jurisdictionType);
    if (jurisdictionName) query = query.eq("jurisdiction_name", jurisdictionName);
    if (hideImports) {
      query = includeImports ? query.or("auto_scope.is.null,auto_scope.eq.municipal") : query.is("source_kind", null);
    }
    return query.order("created_at", { ascending: false }).range(offset, offset + limit - 1);
  };

  let { data, error } = await build(true);
  // Ohne Geoportal-Migration fehlen die Spalten, dann gibt es auch keine Importe.
  if (error && isMissingSchema(error.message)) ({ data, error } = await build(false));
  if (error) return err(error.message, 500);
  return ok(data);
}
