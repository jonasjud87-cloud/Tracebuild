import { createClient } from "@supabase/supabase-js";
import { getAuthUser, ok, unauthorized, forbidden, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSiteOrigin } from "@/lib/site-url";
import { logAudit } from "@/lib/auditLog";
import { checkUserAccess, isBanned } from "@/lib/admin-user-access";
import { maskEmail } from "@/lib/mask-email";

const RESET_COOLDOWN_MS = 60_000;
const ACTOR_WINDOW_MS = 3_600_000;
const ACTOR_MAX_PER_WINDOW = 20;

// POST /api/v1/admin/users/[id]/password-reset — Recovery-Mail an den Nutzer senden
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (!["super_admin", "org_admin"].includes(user.role)) return forbidden();

  const admin = createAdminClient();

  const { data: target } = await admin
    .from("users")
    .select("id, org_id, email, role")
    .eq("id", params.id)
    .maybeSingle();
  if (!target) return err("Benutzer nicht gefunden", 404);

  const decision = checkUserAccess({
    actor: user,
    target,
    action: "password_reset",
    otherActiveSuperAdmins: 0,
  });
  if (!decision.allowed) return err(decision.message, decision.status);

  const { data: authData, error: authError } = await admin.auth.admin.getUserById(params.id);
  if (authError || !authData?.user) return err("Benutzer nicht gefunden", 404);
  if (isBanned(authData.user.banned_until)) {
    return err("Der Benutzer ist gesperrt. Bitte zuerst entsperren.", 409);
  }

  const recipient = authData.user.email;
  if (!recipient) return err("Für diesen Benutzer ist keine E-Mail-Adresse hinterlegt", 409);

  const now = Date.now();
  const { data: recent, error: recentError } = await admin
    .from("audit_log")
    .select("id")
    .eq("action", "password_reset")
    .eq("target_id", target.id)
    .gte("created_at", new Date(now - RESET_COOLDOWN_MS).toISOString())
    .limit(1);
  const { count: actorCount, error: actorError } = await admin
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("action", "password_reset")
    .eq("actor_id", user.id)
    .gte("created_at", new Date(now - ACTOR_WINDOW_MS).toISOString());
  if (recentError || actorError) {
    console.error("password_reset_limit", recentError?.code ?? actorError?.code);
    return err("Die Anfrage konnte nicht geprüft werden", 500);
  }
  if (recent && recent.length > 0) {
    return err("Für diesen Benutzer wurde gerade ein Reset ausgelöst. Bitte kurz warten.", 429);
  }
  if ((actorCount ?? 0) >= ACTOR_MAX_PER_WINDOW) {
    return err("Zu viele Passwort-Resets in kurzer Zeit. Bitte später erneut versuchen.", 429);
  }

  const redirectTo = `${getSiteOrigin(request)}/auth/callback?next=%2Fset-password`;
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await anon.auth.resetPasswordForEmail(recipient, { redirectTo });
  if (error) {
    console.error("password_reset_send", error.status ?? error.code);
    if (error.status === 429 || error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit") {
      return err("Der E-Mail-Versand ist vorübergehend limitiert. Bitte später erneut versuchen.", 429);
    }
    return err("Die E-Mail konnte nicht versendet werden", 500);
  }

  await logAudit(admin, {
    orgId: target.org_id,
    actorId: user.id,
    actorEmail: user.email,
    action: "password_reset",
    targetId: target.id,
    targetEmail: target.email,
  });

  return ok({ id: params.id, email: maskEmail(recipient) });
}
