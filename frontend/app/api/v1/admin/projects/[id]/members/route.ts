import { getAuthUser, ok, unauthorized, forbidden, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/auditLog";

async function guardOrgProject(userOrgId: string, projectId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("org_id", userOrgId)
    .single();
  return data;
}

// GET /api/v1/admin/projects/[id]/members
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (!["super_admin", "org_admin"].includes(user.role)) return forbidden();

  const project = await guardOrgProject(user.org_id, params.id);
  if (!project) return err("Projekt nicht gefunden", 404);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("project_members")
    .select("user_id, added_at, users(id, email, role)")
    .eq("project_id", params.id);

  if (error) return err(error.message, 500);
  return ok(data);
}

// POST /api/v1/admin/projects/[id]/members  { user_id }
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (!["super_admin", "org_admin"].includes(user.role)) return forbidden();

  const project = await guardOrgProject(user.org_id, params.id);
  if (!project) return err("Projekt nicht gefunden", 404);

  const body = await request.json() as { user_id?: string };
  if (!body.user_id) return err("user_id fehlt");

  const admin = createAdminClient();

  // Verify target user is in same org
  const { data: targetUser } = await admin
    .from("users")
    .select("id")
    .eq("id", body.user_id)
    .eq("org_id", user.org_id)
    .single();

  if (!targetUser) return err("Benutzer nicht gefunden", 404);

  const { error } = await admin
    .from("project_members")
    .upsert({ project_id: params.id, user_id: body.user_id }, { onConflict: "project_id,user_id" });

  if (error) return err(error.message, 500);

  await logAudit(admin, {
    orgId: user.org_id,
    actorId: user.id,
    actorEmail: user.email,
    action: "project_member_add",
    targetId: body.user_id,
    meta: { projectId: params.id },
  });

  return ok({ project_id: params.id, user_id: body.user_id }, 201);
}

// DELETE /api/v1/admin/projects/[id]/members  { user_id }
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (!["super_admin", "org_admin"].includes(user.role)) return forbidden();

  const project = await guardOrgProject(user.org_id, params.id);
  if (!project) return err("Projekt nicht gefunden", 404);

  const body = await request.json() as { user_id?: string };
  if (!body.user_id) return err("user_id fehlt");

  const admin = createAdminClient();
  const { error } = await admin
    .from("project_members")
    .delete()
    .eq("project_id", params.id)
    .eq("user_id", body.user_id);

  if (error) return err(error.message, 500);

  await logAudit(admin, {
    orgId: user.org_id,
    actorId: user.id,
    actorEmail: user.email,
    action: "project_member_remove",
    targetId: body.user_id,
    meta: { projectId: params.id },
  });

  return ok({ project_id: params.id, user_id: body.user_id });
}
