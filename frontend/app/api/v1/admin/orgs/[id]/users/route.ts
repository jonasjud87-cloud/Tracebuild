import { NextRequest } from "next/server";
import { getAuthUser, unauthorized, forbidden, ok, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/auditLog";

const ADMIN_ROLES = ["super_admin"] as const;
const ALLOWED_ROLES = ["org_admin", "project_manager", "member"];

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (!ADMIN_ROLES.includes(user.role as "super_admin")) return forbidden();

  const admin = createAdminClient();
  // select("*") statt fester Spaltenliste: bleibt lauffähig, auch wenn die
  // Migration für users.name noch nicht eingespielt ist.
  const { data, error } = await admin
    .from("users")
    .select("*")
    .eq("org_id", params.id)
    .order("created_at", { ascending: true });

  if (error) return err(error.message, 500);
  return ok(data ?? []);
}

// Adding members is handled by POST /api/v1/admin/invite (shared invite flow).

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (!ADMIN_ROLES.includes(user.role as "super_admin")) return forbidden();

  const body = await req.json().catch(() => null);
  const userId: string | undefined = body?.userId;
  const role: string | undefined = body?.role;
  if (!userId) return err("userId fehlt.");
  if (!role || !ALLOWED_ROLES.includes(role)) return err("Ungültige Rolle");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("users")
    .update({ role })
    .eq("id", userId)
    .eq("org_id", params.id)
    .select("id, email, role")
    .single();

  if (error || !data) return err("Benutzer nicht gefunden", 404);

  await logAudit(admin, {
    orgId: params.id,
    actorId: user.id,
    actorEmail: user.email,
    action: "role_change",
    targetId: userId,
    targetEmail: data.email,
    meta: { newRole: role },
  });

  return ok(data);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (!ADMIN_ROLES.includes(user.role as "super_admin")) return forbidden();

  const body = await req.json().catch(() => null);
  const userId: string | undefined = body?.userId;
  if (!userId) return err("userId fehlt.");

  const admin = createAdminClient();

  const { data: target } = await admin
    .from("users")
    .select("email")
    .eq("id", userId)
    .eq("org_id", params.id)
    .maybeSingle();

  const { error } = await admin
    .from("users")
    .delete()
    .eq("id", userId)
    .eq("org_id", params.id);

  if (error) return err(error.message, 500);

  // Einladungs-Zuordnung mitlöschen. Sonst legt die Selbstheilung in
  // lib/auth.ts die gerade entfernte Zeile beim nächsten Login wieder an.
  try {
    await admin.auth.admin.updateUserById(userId, { app_metadata: { org_id: null, invited_role: null }, ban_duration: "876000h" });
  } catch { /* best effort — die users-Zeile ist bereits weg */ }

  await logAudit(admin, {
    orgId: params.id,
    actorId: user.id,
    actorEmail: user.email,
    action: "remove",
    targetId: userId,
    targetEmail: target?.email,
  });

  return ok({ message: "Benutzer entfernt." });
}
