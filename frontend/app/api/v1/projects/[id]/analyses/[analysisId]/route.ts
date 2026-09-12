import { getAuthUser, ok, unauthorized, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/auditLog";

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; analysisId: string } }
) {
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

  // Verify analysis belongs to this project via document
  const { data: analysis } = await admin
    .from("analyses")
    .select("id, document_id")
    .eq("id", params.analysisId)
    .single();
  if (!analysis) return err("Analyse nicht gefunden", 404);

  const { data: doc } = await admin
    .from("documents")
    .select("project_id")
    .eq("id", analysis.document_id)
    .single();
  if (!doc || doc.project_id !== params.id) return err("Zugriff verweigert", 403);

  await admin.from("analysis_items").delete().eq("analysis_id", params.analysisId);

  const { error } = await admin.from("analyses").delete().eq("id", params.analysisId);
  if (error) return err(error.message, 500);

  await logAudit(admin, {
    orgId: user.org_id,
    actorId: user.id,
    actorEmail: user.email,
    action: "analysis_delete",
    targetId: params.analysisId,
    meta: { projectId: params.id },
  });

  return ok({ deleted: true });
}
