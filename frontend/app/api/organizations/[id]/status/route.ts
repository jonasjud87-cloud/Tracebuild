import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthUser, ok, err, unauthorized, forbidden } from "@/lib/auth";
import { validateChangeStatus } from "@/lib/validations/organization";
import { formatOrg } from "@/lib/organizations";
import { logAudit } from "@/lib/auditLog";

type RouteContext = { params: { id: string } };

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { id } = params;
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "super_admin") return forbidden();

  let body: unknown;
  try { body = await req.json(); } catch { return err("Ungültiger JSON-Body"); }

  const validation = validateChangeStatus(body);
  if ("error" in validation) return err(validation.error);
  const { status } = validation.data;

  const admin = createAdminClient();

  interface StatusPatch { status: string; closed_at: string | null; archived_at: string | null; }
  const patch: StatusPatch = { status, closed_at: null, archived_at: null };

  if (status === "closed") {
    patch.closed_at   = new Date().toISOString();
    patch.archived_at = null;
  } else if (status === "archived") {
    patch.archived_at = new Date().toISOString();
    patch.closed_at   = null;
  } else {
    patch.closed_at   = null;
    patch.archived_at = null;
  }

  const { data, error } = await admin
    .from("organizations")
    .update(patch)
    .eq("id", id)
    .is("deleted_at", null)
    .select()
    .single();

  if (error || !data) return err(error?.message ?? "Organisation nicht gefunden", 404);

  await logAudit(admin, {
    orgId: id,
    actorId: user.id,
    actorEmail: user.email,
    action: "org_status_change",
    targetId: id,
    meta: { status },
  });

  return ok(formatOrg(data));
}
