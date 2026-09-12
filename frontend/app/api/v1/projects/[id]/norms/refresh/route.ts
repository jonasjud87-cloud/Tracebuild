import { getAuthUser, ok, unauthorized, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { assignNorms } from "@/lib/norm-assignment";
import { fetchAndPersistExtract, invalidateExtract, type FetchExtractResult } from "@/lib/oereb/fetch";
import { isSupported } from "@/lib/oereb/registry";
import { logAudit } from "@/lib/auditLog";

/**
 * "Normen neu laden": holt für Bestandsprojekte ohne ÖREB-Auszug den Auszug nach
 * (einmalig, Entscheidung 4) und synchronisiert danach beide Zuweisungs-Durchgänge.
 */
export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const admin = createAdminClient();
  const { data: project } = await admin
    .from("projects")
    .select("id, location, domain, parcel_number, bauzone")
    .eq("id", params.id)
    .eq("org_id", user.org_id)
    .single();
  if (!project) return err("Projekt nicht gefunden", 404);

  const loc = (project.location ?? {}) as { canton?: string; municipality?: string };

  // ÖREB nur nachholen, wenn noch kein gültiger Auszug existiert (ein Fehlerdatensatz
  // ist kein Auszug — gleiches Verhalten wie POST …/oereb). Fehlt die Tabelle (Migration
  // nicht eingespielt), wird der Abruf übersprungen — der Sync läuft trotzdem.
  let oereb: FetchExtractResult | null = null;
  if (project.parcel_number && isSupported(loc.canton)) {
    const { data: existing, error: exErr } = await admin
      .from("oereb_extracts")
      .select("id, status, canton, parcel_number")
      .eq("project_id", params.id)
      .maybeSingle();
    const stale =
      !!existing &&
      ((existing.parcel_number ?? null) !== (project.parcel_number ?? null) ||
        (existing.canton ?? "").toUpperCase() !== (loc.canton ?? "").toUpperCase());
    if (!exErr && (!existing || existing.status !== "ok" || stale)) {
      if (stale) await invalidateExtract(params.id);
      oereb = await fetchAndPersistExtract(
        params.id,
        loc.canton ?? "",
        loc.municipality ?? "",
        String(project.parcel_number)
      );
    }
  }

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
    oereb: oereb
      ? { status: oereb.status, status_detail: oereb.statusDetail, egrid: oereb.egrid, zone: oereb.zone }
      : null,
  });
}
