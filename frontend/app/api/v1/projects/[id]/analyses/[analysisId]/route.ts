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

  // Hängt keine andere Analyse mehr am Dokument, gehen Dokument und Storage-Datei mit —
  // sonst sammeln sich Plan-PDFs an, die nirgends mehr sichtbar sind.
  // Bei einem Zählfehler lieber nichts löschen: ein falsches "0" würde per CASCADE
  // alle anderen Analysen desselben Dokuments mitreissen.
  const { count, error: countErr } = await admin
    .from("analyses")
    .select("id", { count: "exact", head: true })
    .eq("document_id", analysis.document_id);
  if (!countErr && count === 0) {
    const { data: docRow } = await admin.from("documents").select("file_url").eq("id", analysis.document_id).maybeSingle();
    const marker = "/storage/v1/object/public/documents/";
    const idx = docRow?.file_url?.indexOf(marker) ?? -1;
    if (idx >= 0) {
      // file_url wird beim Schreiben nicht URL-kodiert (roher Storage-Pfad); ein
      // decodeURIComponent könnte bei "%" im Dateinamen werfen — deshalb roh verwenden.
      const storagePath = docRow!.file_url.slice(idx + marker.length);
      const { error: rmErr } = await admin.storage.from("documents").remove([storagePath]);
      if (rmErr) console.warn(`Storage-Datei ${storagePath} konnte nicht entfernt werden:`, rmErr.message);
    }
    const { error: docErr } = await admin.from("documents").delete().eq("id", analysis.document_id);
    if (docErr) console.warn(`Dokument ${analysis.document_id} konnte nicht entfernt werden:`, docErr.message);
  }

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
