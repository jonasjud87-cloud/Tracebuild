import { getAuthUser, ok, unauthorized, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { assignNorms } from "@/lib/norm-assignment";
import { fetchAndPersistExtract, type FetchExtractResult } from "@/lib/oereb/fetch";
import { isSupported } from "@/lib/oereb/registry";
import { logAudit } from "@/lib/auditLog";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("projects")
    .select("*")
    .eq("org_id", user.org_id)
    .order("created_at", { ascending: false });

  if (error) return err(error.message, 500);
  return ok(data);
}

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const body = await request.json();
  const { name, domain = "bau", location = {}, parcel_number, bauzone: bInput } = body;
  if (!name) return err("Name fehlt");

  // Die Bauzone kommt aus dem ÖREB-Auszug (unten). Eine im Formular eingegebene Zone
  // wird übernommen, aber nicht als 'manual' markiert, damit ÖREB sie füllen darf;
  // erst wenn ÖREB nichts liefert, gilt sie als manuelle Angabe (Entscheidung 1).
  const inputZone: string | null = typeof bInput === "string" && bInput.trim() ? bInput.trim() : null;

  const admin = createAdminClient();

  // Try full insert (with bauzone/parcel_number if migration 20240004 applied)
  let { data: project, error: insertErr } = await admin
    .from("projects")
    .insert({ name, domain, location, org_id: user.org_id, status: "active",
              parcel_number: parcel_number ?? null, bauzone: inputZone })
    .select()
    .single();

  // Fallback: columns don't exist yet (migration not run) — insert without them
  if (insertErr?.message?.includes("bauzone") || insertErr?.message?.includes("parcel_number")) {
    ({ data: project, error: insertErr } = await admin
      .from("projects")
      .insert({ name, domain, location, org_id: user.org_id, status: "active" })
      .select()
      .single());
  }

  if (insertErr) return err(insertErr.message, 500);

  // ÖREB-Auszug einmalig bei Projekt-Erstellung (Entscheidung 4) — nur wenn eine
  // Parzelle angegeben ist und der Kanton einen Adapter hat. Andere Kantone behalten
  // das bisherige Verhalten (manuelle Zone). Wirft nie.
  let oereb: FetchExtractResult | null = null;
  if (parcel_number && isSupported(location.canton)) {
    oereb = await fetchAndPersistExtract(
      project.id,
      location.canton ?? "",
      location.municipality ?? "",
      String(parcel_number)
    );
  }

  // Keine ÖREB-Zone, aber eine aus dem Formular → Herkunft 'manual' festhalten.
  const zoneFromOereb = oereb?.status === "ok" && oereb.zone?.zone && oereb.zone.confidence !== "none";
  if (!zoneFromOereb && inputZone) {
    const { error: zsErr } = await admin
      .from("projects")
      .update({ zone_source: "manual" })
      .eq("id", project.id);
    // Spalte fehlt (ÖREB-Migration nicht eingespielt) → still wie bisher weiter.
    if (zsErr && !zsErr.message.includes("zone_source")) console.error("zone_source konnte nicht gesetzt werden:", zsErr.message);
  }
  await logAudit(admin, {
    orgId: user.org_id,
    actorId: user.id,
    actorEmail: user.email,
    action: "project_create",
    targetId: project.id,
    targetEmail: undefined,
    meta: { name: project.name },
  });

  // Assign norms synchronously so the count is in the response
  const assignment = await assignNorms(
    project.id,
    user.org_id,
    location.canton ?? "",
    location.municipality ?? "",
    domain
  ).catch((e) => {
    console.error("Normzuweisung bei Projekt-Erstellung fehlgeschlagen:", e);
    return null;
  });

  const zone = zoneFromOereb ? oereb!.zone!.zone : inputZone;

  return ok(
    {
      project: { ...project, bauzone: zone },
      assigned_norms_count: assignment?.total ?? 0,
      oereb_assigned: assignment?.oerebAssigned ?? 0,
      gaps: assignment?.gaps ?? [],
      zone,
      oereb: oereb
        ? { status: oereb.status, status_detail: oereb.statusDetail, egrid: oereb.egrid, zone: oereb.zone }
        : null,
    },
    201
  );
}
