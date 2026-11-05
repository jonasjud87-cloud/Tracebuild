import type { createAdminClient } from "@/lib/supabase/admin";
import type { UserRole } from "@/lib/auth";
import { ADMIN_EMAILS } from "@/lib/auth";

type AdminClient = ReturnType<typeof createAdminClient>;

export type UserAccessAction = "block" | "unblock" | "password_reset";

export interface AccessActor {
  id: string;
  role: UserRole;
  org_id: string;
}

export interface AccessTarget {
  id: string;
  org_id: string;
  email: string;
  role: string;
}

export type AccessDecision =
  | { allowed: true }
  | { allowed: false; status: 400 | 403; message: string };

export function isSuperAdminAccount(email: string, role: string): boolean {
  if (role === "super_admin") return true;
  const e = email.toLowerCase();
  return Array.from(ADMIN_EMAILS).some(a => a.toLowerCase() === e);
}

export function checkUserAccess(input: {
  actor: AccessActor;
  target: AccessTarget;
  action: UserAccessAction;
  otherActiveSuperAdmins: number;
}): AccessDecision {
  const { actor, target, action, otherActiveSuperAdmins } = input;

  if (actor.role !== "super_admin" && actor.role !== "org_admin") {
    return { allowed: false, status: 403, message: "Zugriff verweigert" };
  }

  const targetIsSuper = isSuperAdminAccount(target.email, target.role);

  if (actor.role === "org_admin") {
    if (target.org_id !== actor.org_id) {
      return { allowed: false, status: 403, message: "Zugriff verweigert" };
    }
    if (targetIsSuper) {
      return { allowed: false, status: 403, message: "Super-Admin-Konten können nicht verwaltet werden" };
    }
  }

  if (action === "block") {
    if (target.id === actor.id) {
      return { allowed: false, status: 400, message: "Du kannst dich nicht selbst sperren" };
    }
    if (targetIsSuper && otherActiveSuperAdmins < 1) {
      return { allowed: false, status: 400, message: "Der letzte aktive Super-Admin kann nicht gesperrt werden" };
    }
  }

  return { allowed: true };
}

export function isBanned(bannedUntil: string | null | undefined, now = Date.now()): boolean {
  if (!bannedUntil) return false;
  const t = Date.parse(bannedUntil);
  return Number.isFinite(t) && t > now;
}

export async function countOtherActiveSuperAdmins(admin: AdminClient, excludeId: string): Promise<number | null> {
  const { data, error } = await admin.from("users").select("id, email, role");
  if (error) return null;
  const candidates = (data ?? []).filter(
    (u: { id: string; email: string; role: string }) =>
      u.id !== excludeId && isSuperAdminAccount(u.email, u.role),
  );
  let count = 0;
  for (const c of candidates) {
    const { data: au, error: auError } = await admin.auth.admin.getUserById(c.id);
    if (auError) return null;
    if (au?.user && !isBanned(au.user.banned_until)) count++;
  }
  return count;
}
