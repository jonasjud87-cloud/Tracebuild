import { getAuthUser, ok, unauthorized, forbidden, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/auditLog";

// GET /api/v1/admin/norms/[id] — Volltext einer Norm, super_admin only.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "super_admin") return forbidden();

  const { data, error } = await createAdminClient().from("norms").select("id, text").eq("id", params.id).maybeSingle();
  if (error) return err(error.message, 500);
  if (!data) return err("Norm nicht gefunden", 404);
  return ok(data);
}

// DELETE /api/v1/admin/norms/[id] — super_admin only. Unlike the org-scoped
// /api/v1/standards/[id] delete, this can remove any norm regardless of owning org.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "super_admin") return forbidden();

  const admin = createAdminClient();

  const { data: norm } = await admin.from("norms").select("id, org_id, title").eq("id", params.id).maybeSingle();
  if (!norm) return err("Norm nicht gefunden", 404);

  const { error } = await admin.from("norms").delete().eq("id", params.id);
  if (error) return err(error.message, 500);

  await logAudit(admin, {
    orgId: norm.org_id,
    actorId: user.id,
    actorEmail: user.email,
    action: "norm_delete",
    targetId: params.id,
    meta: { title: norm.title },
  });

  return ok({ id: params.id });
}
