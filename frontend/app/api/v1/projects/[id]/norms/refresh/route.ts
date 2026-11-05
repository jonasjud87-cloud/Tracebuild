import { getAuthUser, ok, unauthorized, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { assignNorms } from "@/lib/norm-assignment";
import { refreshProjectOereb } from "@/lib/oereb/refresh";
import { logAudit } from "@/lib/auditLog";

export const maxDuration = 60;

/**
 * "Normen neu laden": holt den ÖREB-Auszug immer neu und synchronisiert danach beide
 * Zuweisungs-Durchgänge. Scheitert der Abruf, bleibt der alte Auszug als Rückfall stehen.
 */
export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const admin = createAdminClient();
    // select("*"): Auch ohne Geoportal-Migration lesbar.
    const { data: project } = await admin
      .from("projects")
      .select("*")
      .eq("id", params.id)
      .eq("org_id", user.org_id)
      .single();
    if (!project) return err("Projekt nicht gefunden", 404);

    const loc = (project.location ?? {}) as { canton?: string; municipality?: string };

    const refresh = await refreshProjectOereb(admin, project);
    const oereb = refresh.result;

    const assignment = await assignNorms(
      params.id,
      user.org_id,
      loc.canton ?? "",
      loc.municipality ?? "",
      project.domain ?? "bau"
    ).catch((e) => {
      console.error("Normzuweisung beim Neuladen fehlgeschlagen:", e);
      return null;
    });

    // Zone nach dem Abruf frisch lesen — ÖREB kann sie gesetzt haben.
    const { data: fresh } = await admin
      .from("projects")
      .select("bauzone")
      .eq("id", params.id)
      .single();

    await logAudit(admin, {
      orgId: user.org_id,
      actorId: user.id,
      actorEmail: user.email,
      action: "norm_refresh",
      targetId: params.id,
      meta: { assigned_norms_count: assignment?.total ?? 0 },
    });

    return ok({
      zone: fresh?.bauzone ?? project.bauzone ?? null,
      assigned_norms_count: assignment?.total ?? 0,
      oereb_assigned: assignment?.oerebAssigned ?? 0,
      gaps: assignment?.gaps ?? [],
      oereb_skipped: assignment?.oerebSkipped ?? null,
      documents_pending: refresh.documents_pending,
      oereb: oereb
        ? {
            status: oereb.status,
            status_detail: oereb.statusDetail,
            egrid: oereb.egrid,
            zone: oereb.zone,
            candidates: oereb.candidates,
          }
        : null,
    });
  } catch (e) {
    console.error("Normen neu laden fehlgeschlagen:", e);
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}
