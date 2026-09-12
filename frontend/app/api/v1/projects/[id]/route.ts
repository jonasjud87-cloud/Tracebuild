import { getAuthUser, ok, unauthorized, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { assignNorms } from "@/lib/norm-assignment";

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

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const admin = createAdminClient();

  const { data: project } = await admin
    .from("projects")
    .select("id, domain, location")
    .eq("id", params.id)
    .eq("org_id", user.org_id)
    .single();

  if (!project) return err("Projekt nicht gefunden", 404);

  const body = await request.json();
  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.location !== undefined) updates.location = body.location;
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

  let { data, error } = await admin
    .from("projects")
    .update(updates)
    .eq("id", params.id)
    .select()
    .single();

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

  // Canton or municipality changed → the set of applicable norms changed with it.
  const oldLoc = (project.location ?? {}) as { canton?: string; municipality?: string };
  const newLoc = (data.location ?? {}) as { canton?: string; municipality?: string };
  const jurisdictionChanged =
    oldLoc.canton !== newLoc.canton || oldLoc.municipality !== newLoc.municipality;

  if (jurisdictionChanged || body.domain !== undefined) {
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

  return ok(data);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const admin = createAdminClient();

  // Zugehörigkeit prüfen
  const { data: project } = await admin
    .from("projects")
    .select("id")
    .eq("id", params.id)
    .eq("org_id", user.org_id)
    .single();

  if (!project) return err("Projekt nicht gefunden", 404);

  const { error } = await admin.from("projects").delete().eq("id", params.id);
  if (error) return err(error.message, 500);
  return ok({ id: params.id });
}
