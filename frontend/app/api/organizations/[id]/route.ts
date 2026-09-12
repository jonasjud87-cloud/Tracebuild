import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthUser, ok, err, unauthorized, forbidden } from "@/lib/auth";
import { validateUpdate } from "@/lib/validations/organization";
import { slugify, uniqueSlug, formatOrg } from "@/lib/organizations";
import { logAudit } from "@/lib/auditLog";

type RouteContext = { params: { id: string } };

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { id } = params;
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "super_admin") return forbidden();

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("organizations")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (error || !data) return err("Organisation nicht gefunden", 404);
  return ok(formatOrg(data));
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { id } = params;
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "super_admin") return forbidden();

  let body: unknown;
  try { body = await req.json(); } catch { return err("Ungültiger JSON-Body"); }

  const validation = validateUpdate(body);
  if ("error" in validation) return err(validation.error);
  const input = validation.data;

  const admin = createAdminClient();

  const { data: existing, error: fetchErr } = await admin
    .from("organizations")
    .select("id")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (fetchErr || !existing) return err("Organisation nicht gefunden", 404);

  interface OrgPatch {
    name?: string; slug?: string; description?: string | null;
    plan?: string; status?: string;
    owner_name?: string | null; owner_email?: string | null;
    user_limit?: number | null; project_limit?: number | null;
    storage_limit_gb?: number | null; monthly_budget?: number | null;
  }
  const patch: OrgPatch = {};
  if (input.name !== undefined) {
    patch.name = input.name;
    patch.slug = await uniqueSlug(admin, slugify(input.name), id);
  }
  if ("description"    in input) patch.description      = input.description;
  if (input.plan       !== undefined) patch.plan         = input.plan;
  if (input.status     !== undefined) patch.status       = input.status;
  if ("ownerName"      in input) patch.owner_name        = input.ownerName;
  if ("ownerEmail"     in input) patch.owner_email       = input.ownerEmail;
  if ("userLimit"      in input) patch.user_limit        = input.userLimit;
  if ("projectLimit"   in input) patch.project_limit     = input.projectLimit;
  if ("storageLimitGb" in input) patch.storage_limit_gb  = input.storageLimitGb;
  if ("monthlyBudget"  in input) patch.monthly_budget    = input.monthlyBudget;

  if (Object.keys(patch).length === 0) {
    const { data: fresh } = await admin.from("organizations").select("*").eq("id", id).single();
    return ok(fresh ? formatOrg(fresh) : null);
  }

  const { data, error } = await admin
    .from("organizations")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) return err(error.message, 500);

  await logAudit(admin, {
    orgId: id,
    actorId: user.id,
    actorEmail: user.email,
    action: "org_update",
    targetId: id,
    meta: { fields: Object.keys(patch) },
  });

  return ok(formatOrg(data));
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const { id } = params;
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "super_admin") return forbidden();

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("organizations")
    .select("is_default")
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (!existing) return err("Organisation nicht gefunden", 404);
  if (existing.is_default) {
    return err("Die Standard-Organisation kann nicht gelöscht werden", 403);
  }

  const { error } = await admin
    .from("organizations")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return err(error.message, 500);

  await logAudit(admin, {
    orgId: id,
    actorId: user.id,
    actorEmail: user.email,
    action: "org_delete",
  });

  return ok(null);
}
