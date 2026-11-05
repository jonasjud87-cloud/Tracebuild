import { getAuthUser, ok, unauthorized, forbidden, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { assignNorms } from "@/lib/norm-assignment";
import { logAudit } from "@/lib/auditLog";
import { invalidateExtract, reapplyZoneFromStoredExtract } from "@/lib/oereb/fetch";
import { refreshProjectOereb, type RefreshResult } from "@/lib/oereb/refresh";
import { countPendingDocuments } from "@/lib/oereb/documents-pending";
import { mentionsParcelIdentityColumn, PARCEL_IDENTITY_COLUMNS, parseParcelIdentity, parseProjectLocation } from "@/lib/geoadmin/validate";
import { isMissingSchema } from "@/lib/supabase/schema-errors";

export const maxDuration = 60;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("projects")
    .select("*")
    .eq("id", params.id)
    .eq("org_id", user.org_id)
    .single();

  if (error || !data) return err("Projekt nicht gefunden", 404);
  return ok(data);
}

export async function PATCH(request: Request, ctx: { params: { id: string } }) {
  try {
    return await updateProject(request, ctx);
  } catch (e) {
    console.error("Projekt-Änderung fehlgeschlagen:", e);
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

async function updateProject(request: Request, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "org_admin" && user.role !== "super_admin") return forbidden();

  const admin = createAdminClient();

  const { data: project } = await admin
    .from("projects")
    .select("*")
    .eq("id", params.id)
    .eq("org_id", user.org_id)
    .single();

  if (!project) return err("Projekt nicht gefunden", 404);

  const body = await request.json();
  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.location !== undefined) {
    const parsedLocation = parseProjectLocation(body.location);
    if ("error" in parsedLocation) return err(parsedLocation.error);
    updates.location = parsedLocation.location;
  }
  if (body.domain !== undefined) updates.domain = body.domain;
  if (body.status !== undefined) updates.status = body.status;
  // Eine über die UI gesetzte Bauzone ist eine manuelle Angabe: sie gilt vor der
  // ÖREB-Zone (Entscheidung 1) und wird von späteren Abrufen nicht überschrieben.
  // Wird die Zone geleert, darf ÖREB wieder füllen.
  if (body.bauzone !== undefined) {
    updates.bauzone = body.bauzone;
    updates.zone_source = body.bauzone ? "manual" : null;
    updates.zone_confidence = null;
  }
  if (body.parcel_number !== undefined) updates.parcel_number = body.parcel_number;

  // Parzelle oder Standort gewechselt ohne neue EGRID: Die alte Grundstücks-Identität gilt nicht mehr.
  const identity = parseParcelIdentity(body);
  const prevLoc = (project.location ?? {}) as { canton?: string; municipality?: string };
  const nextLoc = (updates.location ?? project.location ?? {}) as { canton?: string; municipality?: string };
  const placeChanged =
    prevLoc.canton !== nextLoc.canton ||
    prevLoc.municipality !== nextLoc.municipality ||
    (body.parcel_number !== undefined && (project.parcel_number ?? null) !== (body.parcel_number ?? null));
  const egridChanged = !!identity.egrid && identity.egrid !== (project.egrid ?? null);
  Object.assign(updates, identity);
  // "egrid" in project: Spalten existieren (Migration eingespielt), sonst nichts zurückzusetzen.
  const clearIdentity = placeChanged && !identity.egrid && "egrid" in project;
  if (clearIdentity) {
    for (const column of PARCEL_IDENTITY_COLUMNS) updates[column] = null;
  } else if (egridChanged && "bfs_number" in project) {
    // Das neue Grundstück kann in einer anderen Gemeinde liegen; der Auszug trägt die BFS neu ein.
    updates.bfs_number = null;
  }

  let { data, error } = await admin
    .from("projects")
    .update(updates)
    .eq("id", params.id)
    .select()
    .single();

  // Fallback: Geoportal-Migration noch nicht eingespielt → nur diese Spalten weglassen.
  if (error && mentionsParcelIdentityColumn(error.message)) {
    for (const column of PARCEL_IDENTITY_COLUMNS) delete updates[column];
    ({ data, error } = await admin
      .from("projects")
      .update(updates)
      .eq("id", params.id)
      .select()
      .single());
  }

  // Fallback: ÖREB-Migration noch nicht eingespielt → ohne Herkunftsspalten schreiben.
  if (error && "zone_source" in updates && error.message.includes("zone_")) {
    delete updates.zone_source;
    delete updates.zone_confidence;
    ({ data, error } = await admin
      .from("projects")
      .update(updates)
      .eq("id", params.id)
      .select()
      .single());
  }

  if (error) return err(error.message, 500);

  await logAudit(admin, {
    orgId: user.org_id,
    actorId: user.id,
    actorEmail: user.email,
    action: "project_update",
    targetId: params.id,
    meta: { fields: Object.keys(updates) },
  });

  // Canton or municipality changed → the set of applicable norms changed with it.
  const oldLoc = (project.location ?? {}) as { canton?: string; municipality?: string };
  const newLoc = (data.location ?? {}) as { canton?: string; municipality?: string };
  const jurisdictionChanged =
    oldLoc.canton !== newLoc.canton || oldLoc.municipality !== newLoc.municipality;
  const parcelChanged =
    body.parcel_number !== undefined && (project.parcel_number ?? null) !== (data.parcel_number ?? null);

  // Parzelle, Standort oder EGRID gewechselt → der gespeicherte ÖREB-Auszug und die Geodaten
  // gehören zu einem anderen Grundstück. Verwerfen und sofort neu holen (Budget 25 s, wirft
  // nie); applyZone im Abruf respektiert eine manuelle Zone.
  let refresh: RefreshResult | null = null;
  if (jurisdictionChanged || parcelChanged || egridChanged) {
    await invalidateExtract(params.id);
    const { error: geoErr } = await admin.from("project_geodata").delete().eq("project_id", params.id);
    if (geoErr && !isMissingSchema(geoErr.message)) {
      console.error(`Geodaten für Projekt ${params.id} nicht entfernt:`, geoErr.message);
    }
    refresh = await refreshProjectOereb(admin, { ...data, ...identity });
  } else if (body.bauzone !== undefined && !body.bauzone) {
    // Zone geleert, Auszug unverändert gültig → Zone aus dem gespeicherten Auszug
    // nachfüllen statt einen neuen Abruf zu erzwingen.
    await reapplyZoneFromStoredExtract(params.id);
  }

  if (jurisdictionChanged || parcelChanged || egridChanged || body.domain !== undefined) {
    try {
      await assignNorms(
        params.id,
        user.org_id,
        newLoc.canton ?? "",
        newLoc.municipality ?? "",
        data.domain ?? "bau"
      );
    } catch (e) {
      // The project update itself succeeded — don't fail the request over the sync.
      console.error("Normzuweisung nach Projektänderung fehlgeschlagen:", e);
    }
  }

  // Zone/Herkunft können sich durch Abruf oder Nachfüllen geändert haben → frisch lesen.
  const { data: fresh } = await admin
    .from("projects")
    .select("*")
    .eq("id", params.id)
    .single();

  const oereb = refresh?.result ?? null;
  return ok({
    ...(fresh ?? data),
    documents_pending: refresh ? refresh.documents_pending : await countPendingDocuments(admin, params.id).catch(() => 0),
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
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "org_admin" && user.role !== "super_admin") return forbidden();

  const admin = createAdminClient();

  // Zugehörigkeit prüfen
  const { data: project } = await admin
    .from("projects")
    .select("id, name")
    .eq("id", params.id)
    .eq("org_id", user.org_id)
    .single();

  if (!project) return err("Projekt nicht gefunden", 404);

  const { error } = await admin.from("projects").delete().eq("id", params.id);
  if (error) return err(error.message, 500);

  await logAudit(admin, {
    orgId: user.org_id,
    actorId: user.id,
    actorEmail: user.email,
    action: "project_delete",
    targetId: params.id,
    meta: { name: project.name },
  });

  return ok({ id: params.id });
}
