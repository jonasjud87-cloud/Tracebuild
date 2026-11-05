import { getAuthUser, ok, unauthorized, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { startStage } from "@/lib/analysis-stages/runtime";
import { isMissingSchema } from "@/lib/supabase/schema-errors";

export const maxDuration = 300;

/** Rückfall: Solange die Seite offen ist, trägt der Browser die Kette. Der Claim verhindert Doppelläufe. */
export async function POST(_req: Request, { params }: { params: { id: string; analysisId: string } }) {
  const startedAtMs = Date.now();
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

  const { data: analysis } = await admin
    .from("analyses")
    .select("id, documents!inner(project_id)")
    .eq("id", params.analysisId)
    .eq("documents.project_id", params.id)
    .maybeSingle();
  if (!analysis) return err("Analyse nicht gefunden", 404);

  try {
    const resumed = await startStage(admin, params.analysisId, null, "resume", startedAtMs);
    return ok({ resumed }, 202);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Wiederaufnahme fehlgeschlagen";
    if (isMissingSchema(message)) return ok({ resumed: false }, 202);
    console.error(`Wiederaufnahme von Analyse ${params.analysisId} fehlgeschlagen:`, message);
    return err("Wiederaufnahme fehlgeschlagen", 500);
  }
}
