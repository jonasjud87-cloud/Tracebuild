import { getAuthUser, ok, unauthorized, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingSchema } from "@/lib/supabase/schema-errors";

/**
 * Bricht eine laufende Analyse ab, über die Analyse-ID oder, solange die Antwort des Starts
 * noch aussteht, über die selbst vergebene run_id. Die laufende Etappe sieht den Status
 * 'cancelled' beim nächsten Poll und stoppt die Modell-Calls.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  let runId = "";
  let analysisId = "";
  try {
    const body = await request.json();
    runId = typeof body?.run_id === "string" ? body.run_id.trim() : "";
    analysisId = typeof body?.analysis_id === "string" ? body.analysis_id.trim() : "";
  } catch {
    // leerer Body → unten als fehlend gemeldet
  }
  if (!runId && !analysisId) return err("run_id oder analysis_id fehlt");

  const admin = createAdminClient();
  const { data: project } = await admin
    .from("projects")
    .select("id")
    .eq("id", params.id)
    .eq("org_id", user.org_id)
    .single();
  if (!project) return err("Projekt nicht gefunden", 404);

  const runningQuery = admin
    .from("analyses")
    .select("id, documents!inner(project_id)")
    .eq("documents.project_id", params.id)
    .eq("status", "running");
  const { data: running, error: findErr } = await (analysisId
    ? runningQuery.eq("id", analysisId)
    : runningQuery.eq("result_json->>run_id", runId));
  if (findErr) return err(findErr.message, 500);

  const ids = (running ?? []).map((a) => a.id);
  if (ids.length === 0) return ok({ cancelled: 0 });

  const { error } = await admin.from("analyses").update({ status: "cancelled" }).in("id", ids).eq("status", "running");
  if (error) return err(error.message, 500);

  // Rechnet gerade niemand, gibt es keine Etappe, die aufräumt. Die Kosten stehen schon auf der Analyse.
  // Ohne diesen Schritt würde der Job ohne Wächter das Projekt für neue Analysen blockieren.
  const { error: jobErr } = await admin
    .from("analysis_jobs")
    .delete()
    .in("analysis_id", ids)
    .or(`lease_until.is.null,lease_until.lt."${new Date().toISOString()}"`);
  if (jobErr && !isMissingSchema(jobErr.message)) console.warn("Job nach Abbruch nicht entfernt:", jobErr.message);
  return ok({ cancelled: ids.length });
}
