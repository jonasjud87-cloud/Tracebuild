import { NextRequest } from "next/server";
import { getAuthUser, unauthorized, forbidden, ok, err } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/auditLog";
import {
  ANNOUNCEMENT_COLUMNS,
  AnnouncementRow,
  rowToAnnouncement,
  validateInput,
} from "@/lib/announcements";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "super_admin") return forbidden();

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("announcements")
    .select(ANNOUNCEMENT_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) {
    console.error("announcements", error.code);
    return err("Ankündigungen konnten nicht geladen werden.", 500);
  }

  const rows = (data ?? []) as AnnouncementRow[];
  const orgIds = Array.from(new Set(rows.map((r) => r.org_id).filter((v): v is string => !!v)));
  const names = new Map<string, string>();
  if (orgIds.length > 0) {
    const { data: orgs } = await admin.from("organizations").select("id, name").in("id", orgIds);
    for (const o of orgs ?? []) names.set(o.id, o.name);
  }

  const now = new Date();
  return ok(rows.map((r) => rowToAnnouncement(r, r.org_id ? names.get(r.org_id) ?? null : null, now)));
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  if (user.role !== "super_admin") return forbidden();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err("Ungültiger JSON-Body.", 400);
  }

  const parsed = validateInput(body);
  if ("error" in parsed) return err(parsed.error, 400);
  const input = parsed.value;

  const admin = createAdminClient();
  let orgName: string | null = null;
  if (input.orgId) {
    const { data: org } = await admin
      .from("organizations")
      .select("id, name")
      .eq("id", input.orgId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!org) return err("Organisation nicht gefunden.", 404);
    orgName = org.name;
  }

  const { data, error } = await admin
    .from("announcements")
    .insert({
      org_id: input.orgId ?? null,
      title: input.title,
      message: input.message,
      type: input.type,
      starts_at: input.startsAt ?? new Date().toISOString(),
      ends_at: input.endsAt ?? null,
      dismissible: input.dismissible ?? true,
      active: input.active ?? true,
      created_by: user.id,
      created_by_email: user.email,
    })
    .select(ANNOUNCEMENT_COLUMNS)
    .single();
  if (error || !data) {
    console.error("announcements", error?.code);
    return err("Speichern fehlgeschlagen.", 500);
  }

  await logAudit(admin, {
    orgId: input.orgId ?? null,
    actorId: user.id,
    actorEmail: user.email,
    action: "announcement_create",
    targetId: data.id,
    meta: { title: input.title, type: input.type },
  });

  return ok(rowToAnnouncement(data as AnnouncementRow, orgName));
}
