import { getAuthUser, ok, unauthorized, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncProjectDocuments } from "@/lib/oereb/documents";
import type { DocumentsResponse, OerebDocumentItem } from "@/lib/geoadmin/contract";

export const dynamic = "force-dynamic";

/** Dokumente aus dem aktuellen Auszug des Projekts, mit Status und Ablehnungsgrund. Nur Anzeige. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
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

    const state = await syncProjectDocuments(admin, params.id);
    if (!state.available) return ok<DocumentsResponse>({ available: false, items: [], pending: 0 });

    return ok<DocumentsResponse>({
      available: true,
      pending: state.pending,
      items: state.own.map((d) => ({
        id: d.id,
        title: d.title,
        url: d.url,
        kind: d.doc_type,
        scope: d.scope as OerebDocumentItem["scope"],
        status: d.status as OerebDocumentItem["status"],
        reject_reason: d.reject_reason,
        reject_detail: d.reject_detail,
        norm_id: d.norm_id,
        last_checked_at: d.last_checked_at,
        last_update_status: d.last_update_status,
        version_note: d.version_note ?? null,
      })),
    });
  } catch (e) {
    console.error(`ÖREB-Dokumente von Projekt ${params.id} nicht lesbar:`, e);
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}
