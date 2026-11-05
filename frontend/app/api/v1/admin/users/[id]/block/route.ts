import { getAuthUser, ok, unauthorized, forbidden, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/auditLog";
import { checkUserAccess, countOtherActiveSuperAdmins, isSuperAdminAccount } from "@/lib/admin-user-access";

// POST /api/v1/admin/users/[id]/block — Nutzer sperren oder entsperren
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (!["super_admin", "org_admin"].includes(user.role)) return forbidden();

  let body: { blocked?: unknown } | null = null;
  try {
    body = await request.json();
  } catch {
    return err("Ungültige Anfrage");
  }
  if (!body || typeof body.blocked !== "boolean") return err("Feld 'blocked' (boolean) fehlt");
  const blocked = body.blocked;

  const admin = createAdminClient();

  const { data: target } = await admin
    .from("users")
    .select("id, org_id, email, role")
    .eq("id", params.id)
    .maybeSingle();
  if (!target) return err("Benutzer nicht gefunden", 404);

  const guardSuper = blocked && isSuperAdminAccount(target.email, target.role);
  let otherActiveSuperAdmins = 0;
  if (guardSuper) {
    const counted = await countOtherActiveSuperAdmins(admin, target.id);
    if (counted === null) return err("Die Sperre konnte nicht geprüft werden", 500);
    otherActiveSuperAdmins = counted;
  }

  const decision = checkUserAccess({
    actor: user,
    target,
    action: blocked ? "block" : "unblock",
    otherActiveSuperAdmins,
  });
  if (!decision.allowed) return err(decision.message, decision.status);

  const { error } = await admin.auth.admin.updateUserById(params.id, {
    ban_duration: blocked ? "876000h" : "none",
  });
  if (error) {
    console.error("user_block", error.status ?? error.code);
    return err("Der Benutzer konnte nicht aktualisiert werden", 500);
  }

  if (guardSuper) {
    const remaining = await countOtherActiveSuperAdmins(admin, target.id);
    if (remaining === null || remaining < 1) {
      const { error: rollbackError } = await admin.auth.admin.updateUserById(params.id, { ban_duration: "none" });
      if (rollbackError) console.error("user_block_rollback", rollbackError.status ?? rollbackError.code);
      return remaining === null
        ? err("Die Sperre konnte nicht geprüft werden und wurde zurückgenommen", 500)
        : err("Sperre zurückgenommen: Es muss mindestens ein weiterer aktiver Super-Admin existieren", 409);
    }
  }

  await logAudit(admin, {
    orgId: target.org_id,
    actorId: user.id,
    actorEmail: user.email,
    action: blocked ? "block" : "unblock",
    targetId: target.id,
    targetEmail: target.email,
  });

  return ok({ id: params.id, blocked });
}
