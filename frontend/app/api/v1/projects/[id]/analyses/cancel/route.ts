import { getAuthUser, ok, unauthorized, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Bricht eine laufende Analyse ab. Der Client kennt nur seine selbst vergebene run_id
 * (die Analyse-ID kommt erst mit der Antwort) — deshalb wird über result_json->>run_id
 * gesucht. Die POST-Route der Analyse sieht den Status 'cancelled' beim nächsten Poll
 * und stoppt die Modell-Calls.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  let runId = "";
  try {
    const body = await request.json();
    runId = typeof body?.run_id === "string" ? body.run_id.trim() : "";
  } catch {
    // leerer Body → unten als fehlend gemeldet
  }
  if (!runId) return err("run_id fehlt");

  const admin = createAdminClient();
  const { data: project } = await admin
    .from("projects")
    .select("id")
    .eq("id", params.id)
    .eq("org_id", user.org_id)
    .single();
  if (!project) return err("Projekt nicht gefunden", 404);

  const { data: running, error: findErr } = await admin
    .from("analyses")
    .select("id, documents!inner(project_id)")
    .eq("documents.project_id", params.id)
    .eq("status", "running")
    .eq("result_json->>run_id", runId);
  if (findErr) return err(findErr.message, 500);

  const ids = (running ?? []).map((a) => a.id);
  if (ids.length === 0) return ok({ cancelled: 0 });

  const { error } = await admin.from("analyses").update({ status: "cancelled" }).in("id", ids);
  if (error) return err(error.message, 500);
  return ok({ cancelled: ids.length });
}
