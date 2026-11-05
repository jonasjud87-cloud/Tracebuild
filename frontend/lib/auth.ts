import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export type UserRole = "super_admin" | "org_admin" | "project_manager" | "member";

export interface AuthUser {
  id:     string;
  email:  string;
  org_id: string;
  role:   UserRole;
}

export const ADMIN_EMAILS = new Set([
  "tracebuild.info@gmail.com",
  "livio.thoma07@gmail.com",
  "jonasjud87@gmail.com",
  "liviocyrill.thomamanser@gmail.com",
]);

export const ACTIVE_ORG_COOKIE = "tb_active_org_id";

export async function getAuthUser(): Promise<AuthUser | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  if (user.banned_until && Date.parse(user.banned_until) > Date.now()) return null;

  const email = user.email ?? "";
  const admin = createAdminClient();

  if (ADMIN_EMAILS.has(email)) {
    const cookieStore = await cookies();
    const activeOrgId = cookieStore.get(ACTIVE_ORG_COOKIE)?.value;

    if (activeOrgId) {
      const { data: org } = await admin
        .from("organizations")
        .select("id")
        .eq("id", activeOrgId)
        .is("deleted_at", null)
        .maybeSingle();
      if (org) {
        return { id: user.id, email, org_id: org.id, role: "super_admin" };
      }
    }

    // Fallback: use default org, then any org
    const { data: defaultOrg } = await admin
      .from("organizations")
      .select("id")
      .eq("is_default", true)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    if (defaultOrg) {
      return { id: user.id, email, org_id: defaultOrg.id, role: "super_admin" };
    }

    const { data: anyOrg } = await admin
      .from("organizations")
      .select("id")
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    if (anyOrg) {
      return { id: user.id, email, org_id: anyOrg.id, role: "super_admin" };
    }

    return null;
  }

  // Regular user
  const { data: rows } = await admin
    .from("users")
    .select("org_id, role")
    .eq("id", user.id)
    .limit(1);

  let row = rows?.[0] ?? null;

  // Selbstheilung: Eine eingeladene Person hat ein Auth-Konto, aber (noch)
  // keine users-Zeile — etwa weil der Upsert beim Einladen fehlschlug. Ohne
  // Zeile bekommt sie überall "Nicht eingeloggt".
  //
  // WICHTIG: Die Zuordnung wird aus `app_metadata` gelesen, NICHT aus
  // `user_metadata`. `user_metadata` kann jede angemeldete Person selbst
  // beschreiben (supabase.auth.updateUser({ data })) bzw. beim Registrieren
  // frei mitgeben (signUp({ options: { data } })) — daraus Organisation und
  // Rolle abzuleiten wäre eine Rechteausweitung: eine beliebige Person könnte
  // sich als org_admin einer fremden Organisation eintragen lassen.
  // `app_metadata` ist nur mit dem Service-Key beschreibbar und wird
  // ausschliesslich von POST /api/v1/admin/invite gesetzt.
  if (!row) {
    row = await healMissingUserRow(admin, user.id, email, {
      ...(user.app_metadata ?? {}),
      // Der Name ist kein Recht — der darf aus den User-Metadaten kommen.
      full_name: (user.user_metadata ?? {}).full_name,
    });
  }

  if (!row) return null;

  return {
    id:     user.id,
    email,
    org_id: row.org_id,
    role:   (row.role as UserRole) ?? "member",
  };
}

const INVITE_ROLES: UserRole[] = ["org_admin", "project_manager", "member"];

/**
 * Legt die fehlende users-Zeile aus der Einladung an (`org_id` +
 * `invited_role` in `app_metadata`, gesetzt von POST /api/v1/admin/invite —
 * nur mit Service-Key beschreibbar).
 * Gibt null zurück, wenn keine verwertbare Einladung vorhanden ist — dann
 * bleibt es beim bisherigen Verhalten ("Nicht eingeloggt").
 */
async function healMissingUserRow(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  email: string,
  metadata: Record<string, unknown>,
): Promise<{ org_id: string; role: string } | null> {
  const orgId = typeof metadata.org_id === "string" ? metadata.org_id : null;
  if (!orgId) return null;

  const invitedRole = typeof metadata.invited_role === "string" ? metadata.invited_role : "member";
  const role: UserRole = INVITE_ROLES.includes(invitedRole as UserRole) ? (invitedRole as UserRole) : "member";
  const name = typeof metadata.full_name === "string" ? metadata.full_name.trim() : "";

  const { data: org } = await admin
    .from("organizations")
    .select("id")
    .eq("id", orgId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!org) return null;

  const baseRow = { id: userId, org_id: orgId, email, role };
  let error = (await admin.from("users").upsert({ ...baseRow, name: name || null }, { onConflict: "id" })).error;
  if (error && (error.code === "PGRST204" || error.code === "42703")) {
    // Migration 20260901000001_users_name.sql noch nicht eingespielt.
    error = (await admin.from("users").upsert(baseRow, { onConflict: "id" })).error;
  }
  if (error) return null;

  return { org_id: orgId, role };
}

export function requireRole(user: AuthUser | null, ...roles: UserRole[]): boolean {
  if (!user) return false;
  return roles.includes(user.role);
}

export function unauthorized() {
  return NextResponse.json({ data: null, error: "Nicht eingeloggt" }, { status: 401 });
}

export function forbidden() {
  return NextResponse.json({ data: null, error: "Zugriff verweigert" }, { status: 403 });
}

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ data, error: null }, { status });
}

export function err(message: string, status = 400) {
  return NextResponse.json({ data: null, error: message }, { status });
}
