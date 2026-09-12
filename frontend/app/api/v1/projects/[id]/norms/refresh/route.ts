import { getAuthUser, ok, unauthorized, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { lookupParcel } from "@/lib/geoportal";
import { assignNorms } from "@/lib/norm-assignment";
import { logAudit } from "@/lib/auditLog";

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

  const loc = project.location ?? {};

  // Geoportal is only consulted for the Bauzone — norms come from the catalog.
  let zone: string | null = project.bauzone ?? null;
  if (project.parcel_number && loc.municipality) {
    const geo = await lookupParcel(project.parcel_number, loc.municipality, loc.canton).catch(() => null);
    if (geo?.bauzone) {
      zone = geo.bauzone;
      await admin.from("projects").update({ bauzone: zone }).eq("id", params.id);
    }
  }

  const assigned_norms_count = await assignNorms(
    params.id,
    user.org_id,
    loc.canton ?? "",
    loc.municipality ?? "",
    project.domain ?? "bau"
  ).catch(() => 0);

  await logAudit(admin, {
    orgId: user.org_id,
    actorId: user.id,
    actorEmail: user.email,
    action: "norm_refresh",
    targetId: params.id,
    meta: { assigned_norms_count },
  });

  return ok({ zone, assigned_norms_count });
}
