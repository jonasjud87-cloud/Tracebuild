import { getAuthUser, ok, unauthorized, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/auditLog";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const admin = createAdminClient();
  const { data: project } = await admin
    .from("projects")
    .select("id, domain")
    .eq("id", params.id)
    .eq("org_id", user.org_id)
    .single();
  if (!project) return err("Projekt nicht gefunden", 404);

  const body = await request.json();
  const { title, text, category, zone } = body;
  if (!title?.trim()) return err("Titel fehlt");
  if (!text?.trim()) return err("Inhalt fehlt");
  if (!category?.trim()) return err("Kategorie fehlt");

  // Create the norm scoped to the org (layer 5, jurisdiction_type='org')
  const { data: norm, error: normErr } = await admin
    .from("norms")
    .insert({
      title: title.trim(),
      text: text.trim(),
      category: category.trim(),
      domain: project.domain ?? "bau",
      layer: 5,
      jurisdiction_type: "org",
      org_id: user.org_id,
      zone: typeof zone === "string" && zone.trim() ? zone.trim() : null,
    })
    .select()
    .single();

  if (normErr) return err(normErr.message, 500);

  // Link to project
  const { data: pn, error: pnErr } = await admin
    .from("project_norms")
    .insert({ project_id: params.id, norm_id: norm.id, added_by: "user" })
    .select("*, norms(*)")
    .single();

  if (pnErr) return err(pnErr.message, 500);

  await logAudit(admin, {
    orgId: user.org_id,
    actorId: user.id,
    actorEmail: user.email,
    action: "norm_custom_create",
    targetId: norm.id,
    meta: { projectId: params.id, title: norm.title },
  });

  return ok(pn, 201);
}
