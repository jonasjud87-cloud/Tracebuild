import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, unauthorized, forbidden } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const LIMIT = 5;

interface OrgHit { id: string; name: string; subtitle: string; href: string }
interface UserHit { id: string; name: string; email: string; role: string; orgId: string; orgName: string; href: string }
interface ProjectHit { id: string; name: string; orgId: string; orgName: string; href: string }

function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, c => "\\" + c);
}

function empty() {
  return NextResponse.json({ orgs: [], users: [], projects: [] });
}

type Row = Record<string, unknown>;

function mergeById(lists: Row[][]): Row[] {
  const seen = new Set<string>();
  const out: Row[] = [];
  for (const list of lists) {
    for (const r of list) {
      const id = String(r.id);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(r);
    }
  }
  return out.slice(0, LIMIT);
}

export async function GET(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "super_admin" && user.role !== "org_admin") return forbidden();

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2 || q.length > 80) return empty();

  const isSuper = user.role === "super_admin";
  const scopeOrgId = user.org_id;
  const pattern = `%${escapeLike(q)}%`;
  const admin = createAdminClient();

  async function searchColumns(table: string, columns: string[], select: string, scoped: "id" | "org_id"): Promise<Row[]> {
    const lists = await Promise.all(
      columns.map(async col => {
        try {
          let query = admin.from(table).select(select).ilike(col, pattern).limit(LIMIT * 2);
          if (table === "organizations") query = query.is("deleted_at", null);
          if (!isSuper) query = query.eq(scoped, scopeOrgId);
          const { data, error } = await query;
          if (error) {
            if (table !== "users" || col !== "email") return [];
            let retry = admin.from(table).select("id, email, role, org_id").ilike(col, pattern).limit(LIMIT * 2);
            if (!isSuper) retry = retry.eq(scoped, scopeOrgId);
            const second = await retry;
            return second.error ? [] : ((second.data ?? []) as unknown as Row[]);
          }
          return (data ?? []) as unknown as Row[];
        } catch {
          return [];
        }
      }),
    );
    return mergeById(lists);
  }

  const [orgRows, userRows, projectRows] = await Promise.all([
    searchColumns("organizations", ["name", "slug", "owner_email"], "id, name, slug, owner_email", "id").catch(() => []),
    searchColumns("users", ["email", "name"], "id, email, name, role, org_id", "org_id").catch(() => []),
    searchColumns("projects", ["name"], "id, name, org_id", "org_id").catch(() => []),
  ]);

  const orgNames = new Map<string, string>();
  const ids = Array.from(new Set([
    ...userRows.map(r => String(r.org_id)),
    ...projectRows.map(r => String(r.org_id)),
  ].filter(Boolean)));
  if (ids.length > 0) {
    try {
      let query = admin.from("organizations").select("id, name").in("id", ids).is("deleted_at", null);
      if (!isSuper) query = query.eq("id", scopeOrgId);
      const { data } = await query;
      for (const o of (data ?? []) as Row[]) orgNames.set(String(o.id), String(o.name ?? ""));
    } catch {}
  }

  const orgHref = (id: string) => (isSuper ? `/admin?org=${encodeURIComponent(id)}&tab=uebersicht` : "/admin/org");
  const userHref = (id: string) => (isSuper ? `/admin?org=${encodeURIComponent(id)}&tab=mitglieder` : "/admin/org");
  const projectHref = (id: string) => (isSuper ? `/admin?org=${encodeURIComponent(id)}&tab=projekte` : "/admin/org");

  const orgs: OrgHit[] = orgRows.map(r => ({
    id: String(r.id),
    name: String(r.name ?? ""),
    subtitle: [r.slug, r.owner_email].filter(Boolean).join(" · "),
    href: orgHref(String(r.id)),
  }));

  const users: UserHit[] = userRows
    .filter(r => orgNames.has(String(r.org_id)))
    .map(r => ({
      id: String(r.id),
      name: String(r.name ?? "").trim(),
      email: String(r.email ?? ""),
      role: String(r.role ?? "member"),
      orgId: String(r.org_id),
      orgName: orgNames.get(String(r.org_id)) ?? "",
      href: userHref(String(r.org_id)),
    }));

  const projects: ProjectHit[] = projectRows
    .filter(r => orgNames.has(String(r.org_id)))
    .map(r => ({
      id: String(r.id),
      name: String(r.name ?? ""),
      orgId: String(r.org_id),
      orgName: orgNames.get(String(r.org_id)) ?? "",
      href: projectHref(String(r.org_id)),
    }));

  return NextResponse.json({ orgs, users, projects });
}
