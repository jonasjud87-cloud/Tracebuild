import { getAuthUser, ok, unauthorized, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncNextDocument } from "@/lib/oereb/document-import";
import { assignNormToMatchingProjects } from "@/lib/norm-assignment";
import type { DocumentSyncResponse } from "@/lib/geoadmin/contract";

export const dynamic = "force-dynamic";
// Ein Dokument pro Request, eigene Laufzeit: Ein grosses PDF konkurriert so nicht mit der Analyse.
export const maxDuration = 300;

/**
 * Bearbeitet das nächste fällige Dokument aus dem Auszug dieses Projekts. Der Body bleibt leer:
 * Der Client sendet nie eine URL. Berechtigt ist jedes Mitglied der Org des Projekts; geschützt
 * durch eigenen Auszug, Sperre, recheck_hours und den Deckel pro Gemeinde.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  try {
    const admin = createAdminClient();
    const { data: project, error } = await admin
      .from("projects")
      .select("id")
      .eq("id", params.id)
      .eq("org_id", user.org_id)
      .maybeSingle();
    if (error) return err(error.message, 500);
    if (!project) return err("Projekt nicht gefunden", 404);

    const result = await syncNextDocument(admin, params.id, { id: user.id, email: user.email }, {
      assignNew: async (normId) => {
        await assignNormToMatchingProjects(normId);
      },
    });
    return ok<DocumentSyncResponse>(result);
  } catch (e) {
    console.error(`ÖREB-Dokumentimport für Projekt ${params.id} fehlgeschlagen:`, e);
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}
