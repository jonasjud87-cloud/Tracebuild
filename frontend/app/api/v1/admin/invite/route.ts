import { getAuthUser, ok, unauthorized, forbidden, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSiteOrigin } from "@/lib/site-url";
import { logAudit } from "@/lib/auditLog";
import type { User } from "@supabase/supabase-js";

type AdminClient = ReturnType<typeof createAdminClient>;

const ALLOWED_ROLES = ["org_admin", "project_manager", "member"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** PostgREST/Postgres meldet eine unbekannte Spalte so — Migration noch nicht eingespielt. */
function isUnknownColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "PGRST204" || error.code === "42703" || /column .*name.* does not exist/i.test(error.message ?? "");
}

/**
 * Auth-User anhand der E-Mail suchen. listUsers kennt keinen E-Mail-Filter,
 * darum seitenweise durchgehen. Das ist entscheidend: existiert in auth.users
 * bereits ein Konto, läuft inviteUserByEmail in einen 422 ("A user with this
 * email address has already been registered") — eine Sackgasse, aus der der
 * Admin ohne diesen Zweig nicht mehr herauskommt.
 */
async function findAuthUserByEmail(admin: AdminClient, email: string): Promise<User | null> {
  const needle = email.toLowerCase();
  const perPage = 200;
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);
    const users = data?.users ?? [];
    const hit = users.find(u => (u.email ?? "").toLowerCase() === needle);
    if (hit) return hit;
    if (users.length < perPage) return null;
  }
  return null;
}

// POST /api/v1/admin/invite — Person mit Name + E-Mail + Rolle einladen
export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (!["super_admin", "org_admin"].includes(user.role)) return forbidden();

  const body = await request.json().catch(() => null) as
    { email?: string; name?: string; role?: string; org_id?: string } | null;
  if (!body) return err("Ungültige Anfrage.");

  const email = (body.email ?? "").trim().toLowerCase();
  if (!email) return err("E-Mail fehlt.");
  if (!EMAIL_RE.test(email)) return err("Ungültige E-Mail-Adresse.");

  const name = (body.name ?? "").trim().replace(/\s+/g, " ").slice(0, 120);

  const role = body.role ?? "member";
  if (!ALLOWED_ROLES.includes(role)) return err("Ungültige Rolle");

  const admin = createAdminClient();
  const origin = getSiteOrigin(request);
  const redirectTo = `${origin}/auth/callback?next=%2Fset-password`;

  // ── Ziel-Organisation ──────────────────────────────────────────────────────
  // Nur super_admin darf in eine fremde Organisation einladen.
  let targetOrgId = user.org_id;
  if (body.org_id && body.org_id !== user.org_id) {
    if (user.role !== "super_admin") return forbidden();
    const { data: org, error: orgError } = await admin
      .from("organizations")
      .select("id")
      .eq("id", body.org_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (orgError) return err(`Organisation konnte nicht geprüft werden: ${orgError.message}`, 500);
    if (!org) return err("Organisation nicht gefunden", 404);
    targetOrgId = body.org_id;
  }
  if (!targetOrgId) return err("Keine Organisation zugeordnet.");

  // ── Bestehendes Auth-Konto + users-Zeile ermitteln ─────────────────────────
  let authUser: User | null = null;
  try {
    authUser = await findAuthUserByEmail(admin, email);
  } catch (e) {
    return err(`Benutzerverzeichnis nicht erreichbar: ${e instanceof Error ? e.message : "unbekannter Fehler"}`, 500);
  }

  const existingQuery = authUser
    ? admin.from("users").select("*").eq("id", authUser.id).limit(1)
    : admin.from("users").select("*").eq("email", email).limit(1);

  const { data: existingRows, error: existingError } = await existingQuery;
  if (existingError) return err(`Bestehende Benutzer konnten nicht geprüft werden: ${existingError.message}`, 500);
  const existing = (existingRows?.[0] ?? null) as { id: string; org_id: string; name?: string | null } | null;

  if (existing && existing.org_id !== targetOrgId) {
    return err("Diese E-Mail-Adresse gehört bereits zu einer anderen Organisation.");
  }
  if (existing && authUser?.last_sign_in_at) {
    return err("Diese Person ist bereits aktives Mitglied dieser Organisation.");
  }

  // user_metadata ist vom Konto selbst beschreibbar — hier steht deshalb nur
  // Anzeige-Information (full_name für das Mail-Template). org_id/invited_role
  // stehen zusätzlich in app_metadata (siehe unten), das ausschliesslich mit
  // dem Service-Key gesetzt werden kann; nur das ist für lib/auth.ts massgebend.
  const metadata = {
    ...(authUser?.user_metadata ?? {}),
    org_id: targetOrgId,
    invited_role: role,
    ...(name ? { full_name: name } : {}),
  };

  /** Verbindliche Zuordnung — nur Service-Key darf app_metadata schreiben. */
  const claim = { org_id: targetOrgId, invited_role: role };

  // ── Mail verschicken ───────────────────────────────────────────────────────
  // Drei Fälle, weil inviteUserByEmail nur für neue bzw. unbestätigte Konten
  // funktioniert.
  let targetId: string;
  let createdNewAuthUser = false;
  let mode: "invite" | "reset";

  if (!authUser || !authUser.email_confirmed_at) {
    // Neu, oder Einladung wurde nie angenommen → (erneut) einladen.
    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: metadata,
    });
    if (inviteError || !invited?.user) {
      return err(`Einladung konnte nicht versendet werden: ${inviteError?.message ?? "unbekannter Fehler"}`, 500);
    }
    targetId = invited.user.id;
    createdNewAuthUser = !authUser;
    mode = "invite";
    // inviteUserByEmail kann nur user_metadata setzen — die verbindliche
    // Zuordnung wird direkt danach in app_metadata nachgezogen.
    const { error: claimError } = await admin.auth.admin.updateUserById(targetId, { app_metadata: claim, ban_duration: "none" });
    if (claimError) {
      if (createdNewAuthUser) {
        try { await admin.auth.admin.deleteUser(targetId); } catch { /* best effort */ }
      }
      return err(`Zuordnung konnte nicht gesetzt werden: ${claimError.message}`, 500);
    }
  } else {
    // Auth-Konto existiert bereits und ist bestätigt (z.B. früher entfernt oder
    // selbst registriert). inviteUserByEmail würde hier hart mit 422 abbrechen.
    // Stattdessen: Metadaten aktualisieren und eine "Passwort setzen"-Mail.
    const { error: metaError } = await admin.auth.admin.updateUserById(authUser.id, {
      user_metadata: metadata,
      app_metadata: claim,
      ban_duration: "none",
    });
    if (metaError) return err(`Konto konnte nicht aktualisiert werden: ${metaError.message}`, 500);
    targetId = authUser.id;
    mode = "reset";
  }

  // ── users-Zeile schreiben (Org + Rolle + Name) ─────────────────────────────
  const baseRow = { id: targetId, org_id: targetOrgId, email, role };
  const nameValue = name || existing?.name || null;

  let rowError = (await admin.from("users").upsert({ ...baseRow, name: nameValue }, { onConflict: "id" })).error;
  if (isUnknownColumn(rowError)) {
    // Migration 20260901000001_users_name.sql noch nicht eingespielt —
    // dann wenigstens Org/Rolle korrekt setzen statt komplett zu scheitern.
    rowError = (await admin.from("users").upsert(baseRow, { onConflict: "id" })).error;
  }

  if (rowError) {
    // Kompensation: nur das gerade neu erzeugte Auth-Konto wieder entfernen,
    // damit keine Karteileiche zurückbleibt, die jeden weiteren Versuch
    // blockieren würde.
    if (createdNewAuthUser) {
      try { await admin.auth.admin.deleteUser(targetId); } catch { /* best effort */ }
    }
    return err(`Benutzer konnte nicht angelegt werden: ${rowError.message}`, 500);
  }

  // Erst nachdem die Zuordnung sicher steht, die Passwort-Mail auslösen.
  if (mode === "reset") {
    const { error: resetError } = await admin.auth.resetPasswordForEmail(email, { redirectTo });
    if (resetError) {
      return err(
        `Die Person wurde der Organisation zugeordnet, aber die E-Mail konnte nicht versendet werden: ${resetError.message}`,
        500
      );
    }
  }

  await logAudit(admin, {
    orgId: targetOrgId,
    actorId: user.id,
    actorEmail: user.email,
    action: mode === "invite" ? "invite" : "reinvite",
    targetId,
    targetEmail: email,
    meta: { role },
  });

  return ok({
    id: targetId,
    email,
    name: nameValue,
    role,
    org_id: targetOrgId,
    mode,
    resent: !!existing || !!authUser,
  }, 201);
}
