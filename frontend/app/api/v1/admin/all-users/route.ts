import { getAuthUser, ok, unauthorized, forbidden, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isBanned } from "@/lib/admin-user-access";
import { loadLastActivity, withTimeout, TimeoutError, type ActivitySource } from "@/lib/admin-user-activity";
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

// Kern-Zeitlimit 20 s plus Reserve; sonst bricht der Hoster je nach Plan früher ab.
export const maxDuration = 30;

const AUTH_PAGE_SIZE = 1000;
const AUTH_MAX_PAGES = 100;
/** Obergrenze für Organisationen, Nutzer und Auth-Konten zusammen; danach Fehler statt Hängen. */
const CORE_TIMEOUT_MS = 20_000;

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

function activitySource(admin: AdminClient): ActivitySource {
  return {
    rpc: signal => admin.rpc("admin_last_activity").abortSignal(signal),
    scanPage: (from, to, signal) =>
      admin
        .from("audit_log")
        .select("actor_id, created_at")
        .not("actor_id", "is", null)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to)
        .abortSignal(signal),
  };
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

  // Aktivität läuft mit eigenem, kurzem Budget und blockiert die Liste nie.
  const activityPromise = loadLastActivity(activitySource(admin));

  let core;
  try {
    core = await withTimeout(
      Promise.all([
        admin.from("organizations").select("id, name").is("deleted_at", null),
        // select("*") statt fester Spaltenliste: bleibt lauffähig, auch wenn die
        // Migration für users.name noch nicht eingespielt ist.
        admin.from("users").select("*"),
        listAllAuthUsers(admin),
      ]),
      CORE_TIMEOUT_MS,
    );
  } catch (e) {
    if (e instanceof TimeoutError) {
      console.error("all_users", "timeout");
      return err("Benutzer konnten nicht rechtzeitig geladen werden. Bitte erneut versuchen.", 504);
    }
    console.error("all_users", "exception");
    return err("Benutzer konnten nicht geladen werden", 500);
  }
  const [{ data: orgs, error: orgsError }, { data: users, error: usersError }, authResult] = core;
  const { latest: activity, source: activitySourceKind, rpcErrorCode } = await activityPromise;
  // Nur Quelle und Fehlercode, keine Meldung mit Daten.
  if (activitySourceKind !== "rpc") console.warn("all_users_activity", activitySourceKind, rpcErrorCode ?? "-");

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
