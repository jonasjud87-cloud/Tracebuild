import { getAuthUser, ok, unauthorized, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/auditLog";
import { isMissingSchema } from "@/lib/supabase/schema-errors";
import { isExpiredRun, progressFromJob, type JobProgressRow } from "@/lib/analysis-stages/progress";
import type { AnalysisRunProgress, AnalysisStatusResponse } from "@/lib/analysis-stages/contract";

/** Nur diese Spalten: Die Antwort entsteht Feld für Feld in progressFromJob. */
const JOB_PROGRESS_COLUMNS = "phase, parts_total, parts_done, lease_until, waiting_since, dispatch_url, last_progress_at, created_at";

/** Schlanker Status fürs Polling. Nur benannte Spalten, Org-Prüfung über das Projekt. */
export async function GET(
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
    .maybeSingle();
  if (!project) return err("Projekt nicht gefunden", 404);

  const { data, error } = await admin
    .from("analyses")
    .select("id, status, error_message:result_json->>error, documents!inner(project_id)")
    .eq("id", params.analysisId)
    .eq("documents.project_id", params.id)
    .maybeSingle();
  if (error) return err(error.message, 500);
  if (!data) return err("Analyse nicht gefunden", 404);

  const row = data as unknown as { id: string; status: AnalysisStatusResponse["status"]; error_message: string | null };
  let status = row.status;
  let errorMessage = row.error_message ?? null;
  let progress: AnalysisRunProgress | null = null;

  if (status === "running") {
    const { data: job, error: jobError } = await admin
      .from("analysis_jobs")
      .select(JOB_PROGRESS_COLUMNS)
      .eq("analysis_id", params.analysisId)
      .maybeSingle();
    // Ohne Migration gibt es keinen Job: Altlauf, kein Fortschritt.
    if (jobError && !isMissingSchema(jobError.message)) return err(jobError.message, 500);
    if (job) {
      const now = Date.now();
      const jobRow = job as unknown as JobProgressRow;
      if (isExpiredRun(jobRow, now)) {
        // Ohne Wächter schliesst die Statusroute: Eine Analyse bleibt nie endlos «läuft».
        errorMessage = "Zeitüberschreitung";
        status = "error";
        const { data: current } = await admin.from("analyses").select("result_json").eq("id", params.analysisId).maybeSingle();
        const result = (current?.result_json ?? {}) as Record<string, unknown>;
        await admin
          .from("analyses")
          .update({ status: "error", finished_at: new Date(now).toISOString(), result_json: { ...result, error: errorMessage, timed_out: true } })
          .eq("id", params.analysisId)
          .eq("status", "running");
        await admin.from("analysis_jobs").delete().eq("analysis_id", params.analysisId);
      } else {
        progress = progressFromJob(jobRow, now);
      }
    }
  }

  const body: AnalysisStatusResponse = { id: row.id, status, progress, error_message: errorMessage };
  return ok(body);
}

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
    const { data: fileRows } = await admin.from("document_files").select("storage_path").eq("document_id", analysis.document_id);
    // Alle Dateien des Plansatzes; ältere Dokumente kennen nur file_url.
    const paths = new Set((fileRows ?? []).map((f: { storage_path: string }) => f.storage_path));
    const marker = "/storage/v1/object/public/documents/";
    const idx = docRow?.file_url?.indexOf(marker) ?? -1;
    if (idx >= 0) {
      // file_url wird beim Schreiben nicht URL-kodiert (roher Storage-Pfad); ein
      // decodeURIComponent könnte bei "%" im Dateinamen werfen — deshalb roh verwenden.
      paths.add(docRow!.file_url.slice(idx + marker.length));
    }
    if (paths.size > 0) {
      const { error: rmErr } = await admin.storage.from("documents").remove(Array.from(paths));
      if (rmErr) console.warn(`Storage-Dateien von Dokument ${analysis.document_id} konnten nicht entfernt werden:`, rmErr.message);
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
