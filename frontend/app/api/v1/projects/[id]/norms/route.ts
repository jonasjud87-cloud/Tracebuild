import { getAuthUser, ok, unauthorized, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/auditLog";
import { isMissingSchema } from "@/lib/supabase/schema-errors";

const NORM_COLUMNS = "id, title, category, text, layer, zone, jurisdiction_type, jurisdiction_name, org_id, source_doc, source_url, pdf_url";
// Vercel begrenzt Antworten auf 4.5 MB, ein Projekt kann mehrere ganze Reglemente tragen. Den vollen Text
// liefert GET /standards/{id}, wenn jemand die Karte öffnet.
const TEXT_PREVIEW_CHARS = 2000;

function withTextPreview<T extends { norms: { text?: string | null } | null }>(rows: T[]): T[] {
  return rows.map((row) => {
    const text = row.norms?.text ?? "";
    if (!row.norms || text.length <= TEXT_PREVIEW_CHARS) return row;
    return { ...row, norms: { ...row.norms, text: `${text.slice(0, TEXT_PREVIEW_CHARS)} …`, text_truncated: true } };
  });
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const admin = createAdminClient();

  const { data: project } = await admin
    .from("projects")
    .select("id")
    .eq("id", params.id)
    .eq("org_id", user.org_id)
    .single();
  if (!project) return err("Projekt nicht gefunden", 404);

  const query = (columns: string) =>
    admin.from("project_norms").select(`*, norms(${columns})`).eq("project_id", params.id).order("added_at", { ascending: true });
  let { data, error } = await query(`${NORM_COLUMNS}, source_kind, auto_scope, source_checked_at, approval_status, archived_at`);
  if (error && isMissingSchema(error.message)) ({ data, error } = await query(`${NORM_COLUMNS}, source_kind, auto_scope, source_checked_at`));
  // Ohne Geoportal-Migration fehlen die Spalten.
  if (error && isMissingSchema(error.message)) ({ data, error } = await query(NORM_COLUMNS));
  if (error) return err(error.message, 500);
  return ok(withTextPreview((data ?? []) as unknown as { norms: { text?: string | null } | null }[]));
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const admin = createAdminClient();

  const { data: project } = await admin
    .from("projects")
    .select("id")
    .eq("id", params.id)
    .eq("org_id", user.org_id)
    .single();
  if (!project) return err("Projekt nicht gefunden", 404);

  const body = await request.json();
  if (!body.norm_id) return err("norm_id fehlt");

  // norm_id ist Client-Input: ohne diesen Check liesse sich eine fremde org-private Norm verknüpfen.
  const { data: norm } = await admin
    .from("norms")
    .select("id")
    .eq("id", body.norm_id)
    .or(`org_id.eq.${user.org_id},org_id.is.null`)
    .maybeSingle();
  if (!norm) return err("Norm nicht gefunden", 404);

  const { data, error } = await admin
    .from("project_norms")
    .upsert(
      { project_id: params.id, norm_id: body.norm_id, added_by: "user" },
      { onConflict: "project_id,norm_id", ignoreDuplicates: true }
    )
    .select()
    .single();

  if (error) return err(error.message, 500);

  await logAudit(admin, {
    orgId: user.org_id,
    actorId: user.id,
    actorEmail: user.email,
    action: "project_norm_add",
    targetId: params.id,
    meta: { normId: body.norm_id },
  });

  return ok(data, 201);
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const admin = createAdminClient();

  const { data: project } = await admin
    .from("projects")
    .select("id")
    .eq("id", params.id)
    .eq("org_id", user.org_id)
    .single();
  if (!project) return err("Projekt nicht gefunden", 404);

  const body = await request.json();
  if (!body.norm_id) return err("norm_id fehlt");

  const { error } = await admin
    .from("project_norms")
    .delete()
    .eq("project_id", params.id)
    .eq("norm_id", body.norm_id);

  if (error) return err(error.message, 500);

  await logAudit(admin, {
    orgId: user.org_id,
    actorId: user.id,
    actorEmail: user.email,
    action: "project_norm_remove",
    targetId: params.id,
    meta: { normId: body.norm_id },
  });

  return ok({ deleted: true });
}
