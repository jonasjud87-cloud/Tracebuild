import { getAuthUser, ok, unauthorized, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/auditLog";
import { assignNormsToOrgProjects } from "@/lib/norm-assignment";
import { loadOfficialNorms, supersessionOf, type SupersessionRow } from "@/lib/norm-supersession";

const COLUMNS = "id, org_id, jurisdiction_type, superseded_by_norm_id, superseded_similarity, superseded_at, org_authoritative";

/**
 * Die Org legt ihre Fassung als massgebend fest, oder nimmt das zurück. Nur eigene Gemeinde-Normen.
 * Vertrag: NormSupersession in lib/geoadmin/contract.ts.
 */
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const body = await request.json().catch(() => null);
  if (typeof body?.authoritative !== "boolean") return err("authoritative muss true oder false sein");
  const authoritative: boolean = body.authoritative;

  const admin = createAdminClient();
  const { data: norm, error } = await admin.from("norms").select(COLUMNS).eq("id", params.id).eq("org_id", user.org_id).maybeSingle();
  if (error) return err(error.message, 500);
  if (!norm) return err("Norm nicht gefunden", 404);
  if ((norm as { jurisdiction_type: string }).jurisdiction_type !== "municipal") return err("Nur Gemeinde-Normen der Organisation", 409);

  const nowIso = new Date().toISOString();
  const { data: updated, error: updateError } = await admin
    .from("norms")
    .update({
      org_authoritative: authoritative,
      org_authoritative_at: authoritative ? nowIso : null,
      org_authoritative_by: authoritative ? user.id : null,
    })
    .eq("id", params.id)
    .eq("org_id", user.org_id)
    .select(COLUMNS)
    .single();
  if (updateError) return err(updateError.message, 500);
  const row = updated as unknown as SupersessionRow;

  await logAudit(admin, {
    orgId: user.org_id,
    actorId: user.id,
    actorEmail: user.email,
    action: "norm_org_authoritative",
    targetId: params.id,
    meta: { authoritative },
  });

  // Upload und amtliche Norm tauschen ihre Rolle in den Projekten der Org.
  await assignNormsToOrgProjects(user.org_id);

  const officials = await loadOfficialNorms(admin, row.superseded_by_norm_id ? [row.superseded_by_norm_id] : []);
  return ok({ id: params.id, ...supersessionOf(row, officials.get(row.superseded_by_norm_id ?? "")) });
}
