import { getAuthUser, ok, unauthorized, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { assignNorms } from "@/lib/norm-assignment";
import { mentionsParcelIdentityColumn, parseParcelIdentity, parseProjectLocation } from "@/lib/geoadmin/validate";
import { refreshProjectOereb } from "@/lib/oereb/refresh";
import { logAudit } from "@/lib/auditLog";

export const maxDuration = 60;

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
  try {
    return await createProject(request);
  } catch (e) {
    console.error("Projekt-Erstellung fehlgeschlagen:", e);
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

async function createProject(request: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const body = await request.json();
  const { name, domain = "bau", location: rawLocation = {}, parcel_number, bauzone: bInput } = body;
  if (!name) return err("Name fehlt");
  const parsedLocation = parseProjectLocation(rawLocation);
  if ("error" in parsedLocation) return err(parsedLocation.error);
  const { location } = parsedLocation;

  // Die Bauzone kommt aus dem ÖREB-Auszug (unten). Eine im Formular eingegebene Zone
  // wird übernommen, aber nicht als 'manual' markiert, damit ÖREB sie füllen darf;
  // erst wenn ÖREB nichts Sicheres liefert, gilt sie als manuelle Angabe (Entscheidung 1).
  const inputZone: string | null = typeof bInput === "string" && bInput.trim() ? bInput.trim() : null;
  const identity = parseParcelIdentity(body);

  const admin = createAdminClient();

  const baseRow = { name, domain, location, org_id: user.org_id, status: "active" };
  const zoneRow = { parcel_number: parcel_number ?? null, bauzone: inputZone };

  // Try full insert (with parcel identity if migration 20261106000001 applied)
  let { data: project, error: insertErr } = await admin
    .from("projects")
    .insert({ ...baseRow, ...zoneRow, ...identity })
    .select()
    .single();

  // Fallback: Geoportal-Migration noch nicht eingespielt — nur diese Spalten weglassen.
  if (insertErr && mentionsParcelIdentityColumn(insertErr.message)) {
    ({ data: project, error: insertErr } = await admin
      .from("projects")
      .insert({ ...baseRow, ...zoneRow })
      .select()
      .single());
  }

  // Fallback: columns don't exist yet (migration not run) — insert without them
  if (insertErr?.message?.includes("bauzone") || insertErr?.message?.includes("parcel_number")) {
    ({ data: project, error: insertErr } = await admin
      .from("projects")
      .insert(baseRow)
      .select()
      .single());
  }

  if (insertErr) return err(insertErr.message, 500);

  // ÖREB-Auszug bei Projekt-Erstellung, sobald ein Grundstück bekannt ist (Parzelle oder
  // EGRID). Budget 25 s; wirft nie. Der Import der Reglemente läuft danach vom Client aus.
  const refresh = await refreshProjectOereb(admin, { ...project, ...identity });
  const oereb = refresh.result;

  // Keine sichere ÖREB-Zone, aber eine aus dem Formular → Angabe gilt, Herkunft 'manual'.
  const oerebZone = oereb?.status === "ok" ? oereb.zone : null;
  const zoneFromOereb = !!oerebZone?.zone && oerebZone.confidence !== "none";
  const zoneIsSure = zoneFromOereb && oerebZone?.confidence !== "low";
  if (!zoneIsSure && inputZone) {
    const { error: zsErr } = await admin
      .from("projects")
      .update(zoneFromOereb
        ? { bauzone: inputZone, zone_source: "manual", zone_confidence: null }
        : { zone_source: "manual" })
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
    String(location.canton ?? ""),
    String(location.municipality ?? ""),
    domain
  ).catch((e) => {
    console.error("Normzuweisung bei Projekt-Erstellung fehlgeschlagen:", e);
    return null;
  });

  const zone = zoneIsSure || (zoneFromOereb && !inputZone) ? oerebZone!.zone : inputZone;

  return ok(
    {
      project: { ...project, bauzone: zone },
      assigned_norms_count: assignment?.total ?? 0,
      oereb_assigned: assignment?.oerebAssigned ?? 0,
      gaps: assignment?.gaps ?? [],
      zone,
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
    },
    201
  );
}
