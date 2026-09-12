import { getAuthUser, ok, unauthorized, forbidden, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/auditLog";

// DELETE /api/v1/admin/projects/[id]
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (!["super_admin", "org_admin"].includes(user.role)) return forbidden();

  const admin = createAdminClient();

  const { data: project } = await admin
    .from("projects")
    .select("id, name")
    .eq("id", params.id)
    .eq("org_id", user.org_id)
    .single();

  if (!project) return err("Projekt nicht gefunden", 404);

  const { error } = await admin.from("projects").delete().eq("id", params.id);
  if (error) return err(error.message, 500);

  await logAudit(admin, {
    orgId: user.org_id,
    actorId: user.id,
    actorEmail: user.email,
    action: "project_delete",
    targetId: params.id,
    meta: { name: project.name },
  });

  return ok({ id: params.id });
}
