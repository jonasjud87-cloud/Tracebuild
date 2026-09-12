import { getAuthUser, ok, unauthorized, forbidden, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// Pflege der Tabelle oereb_theme_mappings (Bundes-Pflichtthema → norms.category-Muster).
// Nur super_admin. Angelegt werden ausschliesslich plattformweite Mappings (org_id = NULL);
// gelistet werden alle, damit org-spezifische Einträge sichtbar bleiben.

interface MappingRow {
  id: string;
  theme_code: string;
  category_pattern: string;
  org_id: string | null;
  active: boolean;
}

// GET /api/v1/admin/oereb-mappings
export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "super_admin") return forbidden();

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("oereb_theme_mappings")
    .select("id, theme_code, category_pattern, org_id, active")
    .order("theme_code", { ascending: true })
    .order("category_pattern", { ascending: true });
  if (error) return err(error.message, 500);
  return ok((data ?? []) as MappingRow[]);
}

// POST /api/v1/admin/oereb-mappings  { theme_code, category_pattern, active? }
export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "super_admin") return forbidden();

  const body = await request.json().catch(() => ({}));
  const themeCode = typeof body.theme_code === "string" ? body.theme_code.trim() : "";
  const pattern = typeof body.category_pattern === "string" ? body.category_pattern.trim().toLowerCase() : "";
  const active = body.active === undefined ? true : Boolean(body.active);

  if (!themeCode) return err("theme_code fehlt");
  if (!/^ch\.[A-Za-z0-9_.]+$/.test(themeCode)) return err("theme_code muss die Form ch.<Thema> haben");
  if (!pattern) return err("category_pattern fehlt");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("oereb_theme_mappings")
    .insert({ theme_code: themeCode, category_pattern: pattern, org_id: null, active })
    .select("id, theme_code, category_pattern, org_id, active")
    .single();
  if (error) {
    if (error.code === "23505") return err("Dieses Mapping existiert bereits", 409);
    return err(error.message, 500);
  }
  return ok(data as MappingRow, 201);
}

// PATCH /api/v1/admin/oereb-mappings  { id, active }
export async function PATCH(request: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "super_admin") return forbidden();

  const body = await request.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return err("id fehlt");
  if (typeof body.active !== "boolean") return err("active fehlt");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("oereb_theme_mappings")
    .update({ active: body.active })
    .eq("id", id)
    .select("id, theme_code, category_pattern, org_id, active")
    .single();
  if (error) return err(error.message, 500);
  if (!data) return err("Mapping nicht gefunden", 404);
  return ok(data as MappingRow);
}

// DELETE /api/v1/admin/oereb-mappings  { id }
export async function DELETE(request: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "super_admin") return forbidden();

  const body = await request.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return err("id fehlt");

  const admin = createAdminClient();
  const { data, error } = await admin.from("oereb_theme_mappings").delete().eq("id", id).select("id");
  if (error) return err(error.message, 500);
  if (!data?.length) return err("Mapping nicht gefunden", 404);
  return ok({ id });
}
