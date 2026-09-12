import { getAuthUser, ok, unauthorized, forbidden, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/auditLog";

// POST /api/v1/admin/norms/[id]/promote — super_admin only. Makes an org-owned norm
// platform-wide (org_id -> null) while recording provenance (promoted_from_org_id/at).
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "super_admin") return forbidden();

  const admin = createAdminClient();
  const { data: norm, error: fetchError } = await admin
    .from("norms")
    .select("id, org_id")
    .eq("id", params.id)
    .maybeSingle();
  if (fetchError) return err(fetchError.message, 500);
  if (!norm) return err("Norm nicht gefunden", 404);
  if (!norm.org_id) return err("Norm ist bereits plattformweit", 400);

  const { data, error } = await admin
    .from("norms")
    .update({
      promoted_from_org_id: norm.org_id,
      promoted_at: new Date().toISOString(),
      org_id: null,
    })
    .eq("id", params.id)
    .select()
    .single();

  if (error) return err(error.message, 500);

  await logAudit(admin, {
    orgId: norm.org_id,
    actorId: user.id,
    actorEmail: user.email,
    action: "norm_promote",
    targetId: params.id,
  });

  return ok(data);
}
