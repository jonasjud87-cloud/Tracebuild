import { getAuthUser, ok, unauthorized, forbidden, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/auditLog";

const ALLOWED_ROLES = ["super_admin", "org_admin", "project_manager", "member"];

// PATCH /api/v1/admin/users/[id] — update role
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (!["super_admin", "org_admin"].includes(user.role)) return forbidden();

  const body = await request.json() as { role?: string };
  if (!body.role || !ALLOWED_ROLES.includes(body.role)) {
    return err("Ungültige Rolle");
  }

  // org_admin cannot elevate to super_admin
  if (user.role === "org_admin" && body.role === "super_admin") return forbidden();

  const admin = createAdminClient();

  // Verify target user is in same org
  const { data: target } = await admin
    .from("users")
    .select("id, org_id")
    .eq("id", params.id)
    .single();

  if (!target || target.org_id !== user.org_id) return err("Benutzer nicht gefunden", 404);

  const { data, error } = await admin
    .from("users")
    .update({ role: body.role })
    .eq("id", params.id)
    .select("id, email, role")
    .single();

  if (error) return err(error.message, 500);

  await logAudit(admin, {
    orgId: target.org_id,
    actorId: user.id,
    actorEmail: user.email,
    action: "role_change",
    targetId: params.id,
    targetEmail: data.email,
    meta: { newRole: body.role },
  });

  return ok(data);
}

// DELETE /api/v1/admin/users/[id] — remove user from org (soft: set role to member and clear org?)
// Here we simply delete the user row — auth.users remains intact
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (!["super_admin", "org_admin"].includes(user.role)) return forbidden();
  if (params.id === user.id) return err("Du kannst dich nicht selbst entfernen");

  const admin = createAdminClient();

  const { data: target } = await admin
    .from("users")
    .select("id, org_id, email")
    .eq("id", params.id)
    .single();

  if (!target || target.org_id !== user.org_id) return err("Benutzer nicht gefunden", 404);

  const { error } = await admin.from("users").delete().eq("id", params.id);
  if (error) return err(error.message, 500);

  // Einladungs-Zuordnung mitlöschen. Sonst legt die Selbstheilung in
  // lib/auth.ts die gerade entfernte Zeile beim nächsten Login wieder an.
  try {
    await admin.auth.admin.updateUserById(params.id, { app_metadata: { org_id: null, invited_role: null }, ban_duration: "876000h" });
  } catch { /* best effort — die users-Zeile ist bereits weg */ }

  await logAudit(admin, {
    orgId: target.org_id,
    actorId: user.id,
    actorEmail: user.email,
    action: "remove",
    targetId: params.id,
    targetEmail: target.email,
  });

  return ok({ id: params.id });
}
