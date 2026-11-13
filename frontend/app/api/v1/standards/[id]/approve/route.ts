import { getAuthUser, ok, unauthorized, forbidden, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/auditLog";
import { assignNormsToOrgProjects } from "@/lib/norm-assignment";
import { canApproveCompanyNorms } from "@/lib/company-norms";

export const maxDuration = 60;

interface ApproveResult {
  status: "ok" | "not_found" | "archived";
  title?: string;
  version?: number;
  archived_previous?: boolean;
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (!canApproveCompanyNorms(user.role)) return forbidden();

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("approve_company_norm", {
    p_norm_id: params.id,
    p_org_id: user.org_id,
    p_user_id: user.id,
    p_user_email: user.email,
  });
  if (error) {
    console.error("approve_company_norm", error.message);
    return err("Freigabe fehlgeschlagen. Ist die Migration 20261113000003 eingespielt?", 500);
  }

  const result = data as ApproveResult | null;
  if (!result || result.status === "not_found") return err("Unternehmensnorm nicht gefunden", 404);
  if (result.status === "archived") return err("Diese Version ist bereits archiviert", 409);

  await logAudit(admin, {
    orgId: user.org_id,
    actorId: user.id,
    actorEmail: user.email,
    action: "norm_company_approve",
    targetId: params.id,
    meta: { title: result.title, version: result.version, archivedPrevious: result.archived_previous === true },
  });

  const projects_updated = await assignNormsToOrgProjects(user.org_id);
  return ok({ id: params.id, approval_status: "approved", archived_previous: result.archived_previous === true, projects_updated });
}
