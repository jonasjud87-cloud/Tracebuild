import { getAuthUser, ok, unauthorized, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/auditLog";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("norms")
    .delete()
    .eq("id", params.id)
    .eq("org_id", user.org_id)
    .select("id");
  if (error) return err(error.message, 500);
  if (!data?.length) return err("Norm nicht gefunden", 404);

  await logAudit(admin, {
    orgId: user.org_id,
    actorId: user.id,
    actorEmail: user.email,
    action: "norm_remove",
    targetId: params.id,
  });

  return ok({ id: params.id });
}
