import { getAuthUser, ok, unauthorized, forbidden, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isBanned } from "@/lib/admin-user-access";
import type { User as AuthUser } from "@supabase/supabase-js";

export interface OrgUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  createdAt: string;
  lastSignInAt: string | null;
  lastActivityAt: string | null;
  blocked: boolean;
  status: "pending" | "active" | "blocked";
}

const AUTH_PAGE_SIZE = 1000;
const AUTH_MAX_PAGES = 100;
const AUDIT_PAGE_SIZE = 1000;
const AUDIT_MAX_PAGES = 10;

type AdminClient = ReturnType<typeof createAdminClient>;

async function listAllAuthUsers(admin: AdminClient): Promise<{ users: AuthUser[]; error: string | null }> {
  const all: AuthUser[] = [];
  for (let page = 1; page <= AUTH_MAX_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: AUTH_PAGE_SIZE });
    if (error) return { users: all, error: "auth_list" };
    const batch = data?.users ?? [];
    all.push(...batch);
    if (batch.length < AUTH_PAGE_SIZE) break;
  }
  return { users: all, error: null };
}

async function loadLastAuditActivity(admin: AdminClient): Promise<Map<string, string>> {
  const latest = new Map<string, string>();
  for (let page = 0; page < AUDIT_MAX_PAGES; page++) {
    const { data, error } = await admin
      .from("audit_log")
      .select("actor_id, created_at")
      .not("actor_id", "is", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(page * AUDIT_PAGE_SIZE, (page + 1) * AUDIT_PAGE_SIZE - 1);
    if (error) {
      console.error("all_users_audit", error.code);
      break;
    }
    const batch = (data ?? []) as { actor_id: string; created_at: string }[];
    for (const r of batch) {
      if (!latest.has(r.actor_id)) latest.set(r.actor_id, r.created_at);
    }
    if (batch.length < AUDIT_PAGE_SIZE) break;
  }
  return latest;
}

function latestIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

interface UserRow {
  id: string;
  email: string;
  role: string;
  org_id: string;
  created_at: string;
  name?: string | null;
}

export interface OrgUsersGroup {
  orgId: string;
  orgName: string;
  users: OrgUser[];
}

// GET /api/v1/admin/all-users — every user across every organization, grouped by org
export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "super_admin") return forbidden();

  const admin = createAdminClient();

  const [{ data: orgs, error: orgsError }, { data: users, error: usersError }, authResult, activity] = await Promise.all([
    admin.from("organizations").select("id, name").is("deleted_at", null),
    // select("*") statt fester Spaltenliste: bleibt lauffähig, auch wenn die
    // Migration für users.name noch nicht eingespielt ist.
    admin.from("users").select("*"),
    listAllAuthUsers(admin),
    loadLastAuditActivity(admin),
  ]);

  if (orgsError || usersError || authResult.error) {
    console.error("all_users", orgsError?.code ?? usersError?.code ?? "auth_list");
    return err("Benutzer konnten nicht geladen werden", 500);
  }

  const authById = new Map(authResult.users.map(u => [u.id, u]));

  const rows = (users ?? []) as UserRow[];

  const groups: OrgUsersGroup[] = (orgs ?? [])
    .map(org => ({
      orgId: org.id as string,
      orgName: org.name as string,
      users: rows
        .filter(u => u.org_id === org.id)
        .map((u): OrgUser => {
          const au = authById.get(u.id);
          const lastSignInAt = au?.last_sign_in_at ?? null;
          const blocked = isBanned(au?.banned_until);
          return {
            id: u.id,
            email: u.email,
            name: (u.name ?? "").trim() || null,
            role: u.role,
            createdAt: u.created_at,
            lastSignInAt,
            lastActivityAt: latestIso(lastSignInAt, activity.get(u.id) ?? null),
            blocked,
            status: blocked ? "blocked" : lastSignInAt ? "active" : "pending",
          };
        })
        .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email)),
    }))
    .sort((a, b) => a.orgName.localeCompare(b.orgName));

  return ok(groups);
}
