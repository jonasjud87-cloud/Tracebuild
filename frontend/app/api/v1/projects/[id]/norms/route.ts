import { getAuthUser, ok, unauthorized, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/auditLog";

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

  const { data, error } = await admin
    .from("project_norms")
    .select("*, norms(*)")
    .eq("project_id", params.id)
    .order("added_at", { ascending: true });

  if (error) return err(error.message, 500);
  return ok(data);
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
