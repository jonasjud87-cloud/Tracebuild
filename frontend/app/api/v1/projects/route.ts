import { getAuthUser, ok, unauthorized, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { assignNorms } from "@/lib/norm-assignment";
import { lookupParcel } from "@/lib/geoportal";
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

  // Geoportal is only used to determine the Bauzone — norms themselves are never
  // fetched from it, they come from the manually maintained norms catalog.
  let zone: string | null = bInput ?? null;
  if (!zone && parcel_number && location.municipality) {
    const geo = await lookupParcel(parcel_number, location.municipality, location.canton).catch(() => null);
    if (geo?.bauzone) zone = geo.bauzone;
  }

  const admin = createAdminClient();

  // Try full insert (with bauzone/parcel_number if migration 20240004 applied)
  let { data: project, error: insertErr } = await admin
    .from("projects")
    .insert({ name, domain, location, org_id: user.org_id, status: "active",
              parcel_number: parcel_number ?? null, bauzone: zone ?? null })
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
  const assigned_norms_count = await assignNorms(
    project.id,
    user.org_id,
    location.canton ?? "",
    location.municipality ?? "",
    domain
  ).catch(() => 0);

  return ok({ project, assigned_norms_count, zone }, 201);
}
