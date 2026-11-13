import { getAuthUser, ok, unauthorized, forbidden, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/auditLog";
import { canApproveCompanyNorms } from "@/lib/company-norms";
import { assignNormsToOrgProjects } from "@/lib/norm-assignment";

export const maxDuration = 60;

/** Volltext einer Norm, die die Organisation sehen darf: eigene oder plattformweite. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const { data, error } = await createAdminClient()
    .from("norms")
    .select("id, text")
    .eq("id", params.id)
    .or(`org_id.eq.${user.org_id},org_id.is.null`)
    .maybeSingle();
  if (error) return err(error.message, 500);
  if (!data) return err("Norm nicht gefunden", 404);
  return ok(data);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const admin = createAdminClient();
  const { data: current } = await admin
    .from("norms")
    .select("jurisdiction_type, approval_status")
    .eq("id", params.id)
    .eq("org_id", user.org_id)
    .maybeSingle();
  const isCompany = current?.jurisdiction_type === "org";
  const wasApproved = isCompany && current?.approval_status !== "draft";
  if (wasApproved && !canApproveCompanyNorms(user.role)) return forbidden();

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

  if (wasApproved) await assignNormsToOrgProjects(user.org_id);

  return ok({ id: params.id });
}
