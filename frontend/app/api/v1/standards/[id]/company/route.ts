import { getAuthUser, ok, unauthorized, forbidden, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/auditLog";
import { assignNormsToOrgProjects } from "@/lib/norm-assignment";
import { loadCompanyNorm } from "@/lib/company-norm-store";
import { canApproveCompanyNorms, isPriority, parseScope } from "@/lib/company-norms";
import { projectsBelongToOrg } from "@/lib/norm-upload-file";

export const maxDuration = 60;

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (!canApproveCompanyNorms(user.role)) return forbidden();

  const body = (await request.json().catch(() => null)) as {
    priority?: unknown;
    scope?: { mode?: unknown; cantons?: unknown; projectIds?: unknown };
  } | null;
  if (!body) return err("Ungültige Anfrage");

  const admin = createAdminClient();
  const { norm, error } = await loadCompanyNorm(admin, user.org_id, params.id);
  if (error) return err(error, 500);
  if (!norm) return err("Unternehmensnorm nicht gefunden", 404);
  if (norm.archived_at) return err("Frühere Versionen lassen sich nicht mehr ändern", 409);

  const update: Record<string, unknown> = {};
  if (body.priority !== undefined) {
    if (!isPriority(body.priority)) return err("Unbekannte Verbindlichkeit");
    update.priority = body.priority;
  }
  if (body.scope !== undefined) {
    const scope = parseScope(body.scope);
    if ("error" in scope) return err(scope.error);
    if (!(await projectsBelongToOrg(admin, user.org_id, scope.value.projectIds))) return err("Ungültiges Projekt");
    update.scope_mode = scope.value.mode;
    update.scope_cantons = scope.value.cantons;
    update.scope_project_ids = scope.value.projectIds;
  }
  if (!Object.keys(update).length) return err("Nichts zu ändern");

  const { data, error: updateError } = await admin
    .from("norms")
    .update(update)
    .eq("id", norm.id)
    .eq("org_id", user.org_id)
    .is("archived_at", null)
    .select("id, priority, scope_mode, scope_cantons, scope_project_ids")
    .maybeSingle();
  if (updateError) return err(updateError.message, 500);
  if (!data) return err("Unternehmensnorm nicht gefunden", 404);

  await logAudit(admin, {
    orgId: user.org_id,
    actorId: user.id,
    actorEmail: user.email,
    action: "norm_company_update",
    targetId: norm.id,
    meta: update,
  });

  const projects_updated = norm.approval_status === "approved" ? await assignNormsToOrgProjects(user.org_id) : 0;
  return ok({ ...data, projects_updated });
}
